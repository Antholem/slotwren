-- Custom SQL that Drizzle's schema DSL can't express.
-- Tenant RLS *policies* are added in Phase 1; this migration turns RLS on for
-- every table so the default is deny.

-- ── No double booking ───────────────────────────────────────────────────
-- btree_gist lets a GiST index combine "staff_id =" with "range &&".
create extension if not exists btree_gist with schema extensions;
--> statement-breakpoint

-- Two pending/confirmed bookings for the same staff member can never overlap,
-- buffers included. Half-open ranges: a booking ending at 10:00 doesn't clash
-- with one starting at 10:00. Violations raise SQLSTATE 23P01, which
-- src/server/booking/errors.ts maps to "That time was just taken".
alter table public.bookings add constraint no_double_booking
  exclude using gist (
    staff_id with =,
    tstzrange(buffered_start, buffered_end, '[)') with &&
  ) where (status in ('pending', 'confirmed'));
--> statement-breakpoint

-- ── Row level security: deny by default ─────────────────────────────────
alter table public.businesses enable row level security;
--> statement-breakpoint
alter table public.profiles enable row level security;
--> statement-breakpoint
alter table public.memberships enable row level security;
--> statement-breakpoint
alter table public.staff enable row level security;
--> statement-breakpoint
alter table public.staff_invites enable row level security;
--> statement-breakpoint
alter table public.services enable row level security;
--> statement-breakpoint
alter table public.staff_services enable row level security;
--> statement-breakpoint
alter table public.availability_rules enable row level security;
--> statement-breakpoint
alter table public.time_off enable row level security;
--> statement-breakpoint
alter table public.customers enable row level security;
--> statement-breakpoint
alter table public.bookings enable row level security;
--> statement-breakpoint
alter table public.booking_events enable row level security;
--> statement-breakpoint
alter table public.faqs enable row level security;
--> statement-breakpoint
alter table public.ai_conversations enable row level security;
--> statement-breakpoint
alter table public.ai_messages enable row level security;
--> statement-breakpoint
alter table public.handoff_requests enable row level security;
--> statement-breakpoint
alter table public.subscriptions enable row level security;
--> statement-breakpoint
alter table public.stripe_events enable row level security;
--> statement-breakpoint

-- ── Profiles for new auth users ─────────────────────────────────────────
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;
--> statement-breakpoint

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
