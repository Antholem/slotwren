# 0001 · Data model

- Status: accepted
- Date: 2026-10-29 (recorded 2026-11-10)
- Schema: `src/server/db/schema.ts` · Migrations: `supabase/migrations/`
- Detail: `docs/proposal-foundation.md` §2 (the approved proposal, column by column)

## Context

Slotwren is a multi-tenant booking product: many small businesses, each with its own
services, staff, hours, customers and bookings, booked from a public page, an embed, the
dashboard and an AI receptionist. The model has to make three things hard to get wrong:
tenant isolation, time (businesses and customers in different timezones, DST), and double
booking.

## Decision

**One tenant root.** `businesses` is the tenant. Every tenant table carries a non-null
`business_id` with `ON DELETE CASCADE`, and links between tenant tables are composite
`(id, business_id)` foreign keys, so a row can never point at another business's data even
if application code is wrong. Row level security sits on top (ADR 0002).

**People.** `auth.users` (Supabase) holds logins; `profiles` adds a display name;
`memberships (business_id, user_id, role)` makes someone an owner or staff of a business.
`staff` is who can be booked. A staff row may have no login (`user_id` null), so a business
can list a part-timer who never signs in; an invite (`staff_invites`, token stored
SHA-256 hashed) links a login to a staff row later.

**Catalogue and availability.**

- `services`: integer `duration_min`, `price_cents` (0 means Free), buffers before and
  after, `active` (bookable online) and `archived_at` (soft delete, so booking history
  keeps its service).
- `staff_services`: who performs what.
- `availability_rules`: weekly hours as wall-clock `time` ranges per weekday in the
  business timezone; several per day.
- `time_off`: `timestamptz` ranges.

**Time.** Instants are `timestamptz` in UTC. Each business has an IANA `timezone`;
working hours are local wall-clock times in it; conversion happens at the edges with
`@date-fns/tz`. Business-wide booking rules are typed columns with CHECKs: `min_notice_min`,
`max_days_ahead` (1–365), `slot_interval_min` (15 or 30) and `cancellation_window_hours`.
`settings` (jsonb) holds UI preferences only (embed options, notifications, opening hours
for display); anything the slot engine or billing reads is a real column.

**Bookings.** `bookings` store `starts_at`/`ends_at` plus `buffered_start`/`buffered_end`
(the time the staff member is actually blocked), a status (`pending`, `confirmed`,
`cancelled`, `completed`, `no_show`), the source (page, widget, AI, manual), a price
snapshot, a code shown to customers (`SW-8K3D-27`, unique per business) and a hashed
manage-link token. Double booking is impossible in the database:

```sql
exclude using gist (
  staff_id with =,
  tstzrange(buffered_start, buffered_end, '[)') with &&
) where (status in ('pending', 'confirmed'))
```

The app doesn't pre-check and trust it; it maps SQLSTATE `23P01` to "That time was just
taken". `booking_events` is the append-only audit trail (who created, moved or cancelled).

**Customers and the AI.** `customers` are per business, unique on lower-cased email, with
private `notes` that never leave the dashboard. `faqs`, `ai_conversations`,
`ai_messages` and `handoff_requests` hold what the receptionist answers from and what it
said. **Billing:** `subscriptions` (synced from Stripe webhooks) and `stripe_events`
(webhook idempotency, no tenant data).

## Consequences

- Isolation doesn't depend on every query remembering a filter: composite FKs stop
  cross-tenant links, RLS stops cross-tenant reads and writes, and dashboard queries still
  filter by `business_id` (`tests/integration/rls.test.ts`, `tenant-integrity.test.ts`).
- Hours are stored as the owner thinks of them ("09:00"), so a DST change doesn't move
  them; the slot engine converts per date. Changing the business timezone keeps the clock
  times and leaves bookings at their exact instant.
- Integer cents rule out currencies without two decimals (JPY) until money gains a
  per-currency exponent; Settings offers two-decimal currencies only.
- Constraints Drizzle can't express (the exclusion constraint, `ON DELETE SET NULL (col)`
  composite FKs, triggers, RLS) live in hand-written SQL migrations next to the generated
  ones.
