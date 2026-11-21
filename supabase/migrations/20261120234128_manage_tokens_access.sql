-- Manage links move to their own table (docs/adr/0002-rls-strategy.md):
-- several valid tokens per booking, each expiring when the appointment ends,
-- all revoked when it's cancelled. Tokens are issued only through
-- private.mint_manage_token(), so jobs (adminDb) and dashboard reschedules
-- (withRls) can issue one without anyone reading the hashes.

-- ── Access: server only ────────────────────────────────────────────────
-- RLS on, no policies and no privileges for anon or authenticated (like
-- stripe_events): only the server and the functions below touch it.
alter table public.manage_tokens enable row level security;
--> statement-breakpoint
revoke all on public.manage_tokens from anon, authenticated;
--> statement-breakpoint

-- ── Minting ────────────────────────────────────────────────────────────
-- The app makes the random token and passes its SHA-256; the function stores
-- it against the booking, expiring when the appointment ends. Without a
-- signed-in user (adminDb: the booking page, manage links, jobs) the server
-- has already decided. A signed-in member may mint only for a booking they
-- may change: owners any in their business, staff their own (as RLS on
-- bookings). Cancelled and finished bookings get no new links.
create function private.mint_manage_token(
  p_booking_id uuid,
  p_token_hash text,
  p_purpose public.manage_token_purpose
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_staff uuid;
  v_ends timestamptz;
  v_status public.booking_status;
begin
  select business_id, staff_id, ends_at, status
    into v_business, v_staff, v_ends, v_status
  from public.bookings
  where id = p_booking_id;

  if not found then
    raise exception 'No such booking' using errcode = 'P0002';
  end if;

  if (select auth.uid()) is not null
    and v_business not in (select private.owner_business_ids())
    and v_staff not in (select private.my_staff_ids())
  then
    raise exception 'Not allowed to issue a link for this booking' using errcode = '42501';
  end if;

  if v_status not in ('pending', 'confirmed') then
    raise exception 'Only active bookings get manage links' using errcode = '22023';
  end if;

  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Expected a SHA-256 hex digest' using errcode = '22023';
  end if;

  insert into public.manage_tokens (business_id, booking_id, token_hash, purpose, expires_at)
  values (v_business, p_booking_id, p_token_hash, p_purpose, v_ends);
end;
$$;
--> statement-breakpoint
revoke all on function private.mint_manage_token(uuid, text, public.manage_token_purpose) from public;
--> statement-breakpoint
grant execute on function private.mint_manage_token(uuid, text, public.manage_token_purpose) to authenticated;
--> statement-breakpoint

-- ── Keeping tokens in step with their booking ──────────────────────────
-- Moving a booking moves its links' expiry; cancelling it revokes them all.
-- SECURITY DEFINER: it runs for dashboard changes too, where members can't
-- touch manage_tokens themselves.
create function private.sync_manage_tokens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.manage_tokens
      set revoked_at = coalesce(new.cancelled_at, now())
      where booking_id = new.id and revoked_at is null;
  elsif new.ends_at is distinct from old.ends_at then
    update public.manage_tokens
      set expires_at = new.ends_at
      where booking_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger bookings_sync_manage_tokens
  after update of status, ends_at on public.bookings
  for each row execute function private.sync_manage_tokens();
--> statement-breakpoint

-- ── Existing links keep working ────────────────────────────────────────
insert into public.manage_tokens (business_id, booking_id, token_hash, purpose, expires_at, revoked_at)
select
  business_id,
  id,
  manage_token_hash,
  'created',
  ends_at,
  case when status = 'cancelled' then coalesce(cancelled_at, now()) end
from public.bookings;
