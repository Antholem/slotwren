-- Phase 1 review, batch 1 (docs/adr/0002-rls-strategy.md).

-- ── booking_events: the actor comes from the session ────────────────────
-- A signed-in member can't write "the customer cancelled this" or another
-- member's name into the audit trail: whatever they send, the row records
-- them as the actor. Server paths without a user (public page, AI, jobs) run
-- as adminDb, have no auth.uid(), and set the actor themselves.
create function private.stamp_booking_event_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.actor := 'staff';
    new.actor_user_id := (select auth.uid());
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger booking_events_stamp_actor
  before insert on public.booking_events
  for each row execute function private.stamp_booking_event_actor();
--> statement-breakpoint

-- ── bookings: what signed-in members may change ─────────────────────────
-- Nobody edits a booking's identity from the dashboard: its business, code,
-- source, manage-token hash, creator or AI conversation. Writes still go
-- through src/server/booking/service.ts; this is the floor under it.
revoke update on public.bookings from authenticated;
--> statement-breakpoint
grant update (
  service_id, staff_id, customer_id, starts_at, ends_at, buffered_start, buffered_end,
  status, price_cents, customer_notes, customer_timezone,
  cancelled_at, cancelled_by, cancel_reason, updated_at
) on public.bookings to authenticated;
--> statement-breakpoint

-- Column grants can't tell owners from staff, so the price is guarded here:
-- only owners change what a booking costs.
create function private.guard_booking_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
    and new.price_cents is distinct from old.price_cents
    and not exists (
      select 1 from private.owner_business_ids() as owned(id) where owned.id = new.business_id
    )
  then
    raise exception 'Only owners can change what a booking costs'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger bookings_guard_price
  before update on public.bookings
  for each row execute function private.guard_booking_price();
