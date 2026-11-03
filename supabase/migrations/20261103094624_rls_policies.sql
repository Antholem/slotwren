-- Row level security for every tenant table (docs/proposal-foundation.md §3–4).
--
-- Who can do what, as the `authenticated` role (dashboard queries via withRls):
--   members (owner or staff)  read their businesses' rows
--   owners                    write business settings, services, staff, invites,
--                             FAQs, memberships; read billing
--   staff                     manage their own schedule: availability, time off,
--                             and bookings assigned to them
--   anyone signed in          create a business (and becomes its owner)
-- No anon policies: the public booking page, manage links, AI chat, webhooks and
-- jobs go through adminDb, which connects as postgres and bypasses RLS.
--
-- Queries in src/server/db/queries also filter by business_id explicitly; these
-- policies are the second layer.

-- ── Helpers ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can read memberships/staff without recursing
-- into their own RLS. Kept in a schema PostgREST doesn't expose. Each returns
-- a set, so `business_id in (select …)` runs once per query, not per row.
create schema if not exists private;
--> statement-breakpoint
revoke all on schema private from public;
--> statement-breakpoint
grant usage on schema private to authenticated;
--> statement-breakpoint

create function private.member_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select business_id from public.memberships where user_id = (select auth.uid())
$$;
--> statement-breakpoint

create function private.owner_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select business_id from public.memberships
  where user_id = (select auth.uid()) and role = 'owner'
$$;
--> statement-breakpoint

-- Staff rows linked to the current user, in businesses they still belong to.
create function private.my_staff_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff s
  join public.memberships m on m.business_id = s.business_id and m.user_id = s.user_id
  where s.user_id = (select auth.uid())
$$;
--> statement-breakpoint

revoke all on all functions in schema private from public, anon;
--> statement-breakpoint
grant execute on function private.member_business_ids() to authenticated;
--> statement-breakpoint
grant execute on function private.owner_business_ids() to authenticated;
--> statement-breakpoint
grant execute on function private.my_staff_ids() to authenticated;
--> statement-breakpoint

-- ── Table privileges ────────────────────────────────────────────────────
-- RLS doesn't apply to TRUNCATE, and nothing in the app needs TRIGGER or
-- REFERENCES as a signed-in user.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
--> statement-breakpoint
-- Webhook idempotency keys: service only.
revoke all on public.stripe_events from anon, authenticated;
--> statement-breakpoint

-- ── businesses ──────────────────────────────────────────────────────────
-- Owners edit settings, but never plan, Stripe IDs, AI budget or the demo flag:
-- those are written by billing webhooks and the seed (adminDb). UPDATE is
-- limited by column grants. INSERT can't be: Drizzle lists every column (unset
-- ones as DEFAULT), which needs the privilege on all of them, so the insert
-- policy's WITH CHECK pins those columns to their free-plan values instead.
revoke update on public.businesses from authenticated;
--> statement-breakpoint
grant update (
  slug, name, timezone, currency, brand_color, logo_url, address, phone, contact_email,
  min_notice_min, max_days_ahead, slot_interval_min, cancellation_window_hours,
  ai_enabled, settings, onboarded_at, updated_at
) on public.businesses to authenticated;
--> statement-breakpoint

create policy businesses_select on public.businesses
  for select to authenticated
  using (id in (select private.member_business_ids()));
--> statement-breakpoint
create policy businesses_insert on public.businesses
  for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and plan = 'free'
    and stripe_customer_id is null
    and not is_demo
    and ai_monthly_token_budget <= 500000 -- the column default (schema.ts)
  );
--> statement-breakpoint
create policy businesses_update on public.businesses
  for update to authenticated
  using (id in (select private.owner_business_ids()))
  with check (id in (select private.owner_business_ids()));
--> statement-breakpoint
create policy businesses_delete on public.businesses
  for delete to authenticated
  using (id in (select private.owner_business_ids()));
--> statement-breakpoint

-- Whoever creates a business owns it. Skipped for adminDb/seed (no auth.uid()).
-- Generate the business id in the app and insert without RETURNING: Postgres
-- checks RETURNING rows against businesses_select before this AFTER trigger
-- has made the creator a member.
create function private.add_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    insert into public.memberships (business_id, user_id, role)
    values (new.id, (select auth.uid()), 'owner');
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger on_business_created
  after insert on public.businesses
  for each row execute function private.add_creator_as_owner();
--> statement-breakpoint

-- ── memberships ─────────────────────────────────────────────────────────
-- Members see their team. Owners change roles and remove people. Nobody
-- inserts directly: memberships come from creating a business (trigger above)
-- and, later, from accepting an invite (server side, Phase 1 staff step).
drop policy memberships_select_own on public.memberships;
--> statement-breakpoint
-- No insert policy, so inserts are denied; the grant is revoked too.
revoke insert, update on public.memberships from authenticated;
--> statement-breakpoint
grant update (role) on public.memberships to authenticated;
--> statement-breakpoint

create policy memberships_select on public.memberships
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy memberships_update on public.memberships
  for update to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));
--> statement-breakpoint
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (business_id in (select private.owner_business_ids()));
--> statement-breakpoint

-- A business always keeps at least one owner. Only enforced for signed-in
-- users, so deleting a business or an auth user (cascades) still works.
create function private.keep_an_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return coalesce(new, old);
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') and not exists (
    select 1 from public.memberships
    where business_id = old.business_id and role = 'owner' and user_id <> old.user_id
  ) then
    raise exception 'A business needs at least one owner'
      using errcode = '23514', hint = 'Make someone else an owner first.';
  end if;
  return coalesce(new, old);
end;
$$;
--> statement-breakpoint
create trigger memberships_keep_an_owner
  before update or delete on public.memberships
  for each row execute function private.keep_an_owner();
--> statement-breakpoint

-- ── profiles ────────────────────────────────────────────────────────────
-- Your own profile, plus teammates' ("Edited by Mia"). Created by trigger only.
revoke insert, update, delete on public.profiles from authenticated;
--> statement-breakpoint
grant update (full_name, avatar_url, updated_at) on public.profiles to authenticated;
--> statement-breakpoint
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (
      select m.user_id from public.memberships m
      where m.business_id in (select private.member_business_ids())
    )
  );
--> statement-breakpoint
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
--> statement-breakpoint

-- ── Owner-managed catalogue: read by members, written by owners ─────────
create policy staff_select on public.staff
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy staff_owner_write on public.staff
  for all to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));
--> statement-breakpoint

create policy services_select on public.services
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy services_owner_write on public.services
  for all to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));
--> statement-breakpoint

create policy staff_services_select on public.staff_services
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy staff_services_owner_write on public.staff_services
  for all to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));
--> statement-breakpoint

create policy faqs_select on public.faqs
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy faqs_owner_write on public.faqs
  for all to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));
--> statement-breakpoint

-- ── staff_invites: owners only (token hashes never reach staff) ─────────
create policy staff_invites_owner_all on public.staff_invites
  for all to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));
--> statement-breakpoint

-- ── Schedules: owners manage anyone's, staff manage their own ───────────
create policy availability_rules_select on public.availability_rules
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy availability_rules_write on public.availability_rules
  for all to authenticated
  using (
    business_id in (select private.owner_business_ids())
    or staff_id in (select private.my_staff_ids())
  )
  with check (
    business_id in (select private.owner_business_ids())
    or staff_id in (select private.my_staff_ids())
  );
--> statement-breakpoint

create policy time_off_select on public.time_off
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy time_off_write on public.time_off
  for all to authenticated
  using (
    business_id in (select private.owner_business_ids())
    or staff_id in (select private.my_staff_ids())
  )
  with check (
    business_id in (select private.owner_business_ids())
    or staff_id in (select private.my_staff_ids())
  );
--> statement-breakpoint

-- ── customers: the whole team works with customers; owners delete ───────
create policy customers_select on public.customers
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy customers_insert on public.customers
  for insert to authenticated
  with check (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy customers_update on public.customers
  for update to authenticated
  using (business_id in (select private.member_business_ids()))
  with check (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy customers_delete on public.customers
  for delete to authenticated
  using (business_id in (select private.owner_business_ids()));
--> statement-breakpoint

-- ── bookings ────────────────────────────────────────────────────────────
-- Everyone sees the team calendar. Owners write any booking; staff write the
-- ones assigned to them (and can't hand one to someone else). Never deleted:
-- cancelling is a status. Writes still go through src/server/booking/service.ts.
create policy bookings_select on public.bookings
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (
    business_id in (select private.owner_business_ids())
    or staff_id in (select private.my_staff_ids())
  );
--> statement-breakpoint
create policy bookings_update on public.bookings
  for update to authenticated
  using (
    business_id in (select private.owner_business_ids())
    or staff_id in (select private.my_staff_ids())
  )
  with check (
    business_id in (select private.owner_business_ids())
    or staff_id in (select private.my_staff_ids())
  );
--> statement-breakpoint

-- Audit trail: append-only.
revoke update, delete on public.booking_events from authenticated;
--> statement-breakpoint
create policy booking_events_select on public.booking_events
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy booking_events_insert on public.booking_events
  for insert to authenticated
  with check (business_id in (select private.member_business_ids()));
--> statement-breakpoint

-- ── AI receptionist: written by the chat (adminDb), read by the team ────
revoke insert, update, delete on public.ai_conversations, public.ai_messages from authenticated;
--> statement-breakpoint
create policy ai_conversations_select on public.ai_conversations
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy ai_messages_select on public.ai_messages
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint

-- "Question for the team": created by the chat, answered by any member.
revoke insert, delete on public.handoff_requests from authenticated;
--> statement-breakpoint
create policy handoff_requests_select on public.handoff_requests
  for select to authenticated
  using (business_id in (select private.member_business_ids()));
--> statement-breakpoint
create policy handoff_requests_update on public.handoff_requests
  for update to authenticated
  using (business_id in (select private.member_business_ids()))
  with check (business_id in (select private.member_business_ids()));
--> statement-breakpoint

-- ── Billing: owners read; Stripe webhooks write (adminDb) ───────────────
revoke insert, update, delete on public.subscriptions from authenticated;
--> statement-breakpoint
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (business_id in (select private.owner_business_ids()));
