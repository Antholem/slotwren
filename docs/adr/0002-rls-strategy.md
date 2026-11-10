# 0002 · Row level security strategy

- Status: accepted
- Date: 2026-11-03
- Migration: `supabase/migrations/20261103094624_rls_policies.sql`

## Context

Slotwren is multi-tenant: every tenant row carries `business_id`. Isolation must not
depend on every query remembering a filter. Drizzle connects as `postgres`, which bypasses
RLS, so RLS only protects queries that run through `withRls()` (the `authenticated` role
with the user's JWT claims). Paths with no signed-in user (public booking page, manage
links, AI chat, webhooks, jobs) use `adminDb`.

## Decision

**Two layers for the dashboard.** Dashboard queries run in `withRls` and also filter by
`business_id` explicitly. Either layer alone would stop a cross-tenant read.

**Policies by role**, for the `authenticated` role only (no `anon` policies at all):

| Table                                 | Members (owner or staff)          | Owners only                  | Staff extra                |
| ------------------------------------- | --------------------------------- | ---------------------------- | -------------------------- |
| businesses                            | read                              | update settings, delete      |                            |
| memberships                           | read team                         | change role, remove          |                            |
| profiles                              | read self + teammates, update own |                              |                            |
| staff, services, staff_services, faqs | read                              | write                        |                            |
| staff_invites                         |                                   | all (token hashes stay here) |                            |
| availability_rules, time_off          | read                              | write anyone's               | write own                  |
| customers                             | read, insert, update              | delete                       |                            |
| bookings                              | read                              | insert, update any           | insert, update own         |
| booking_events                        | read, insert                      |                              | (append-only for everyone) |
| ai_conversations, ai_messages         | read                              |                              |                            |
| handoff_requests                      | read, update                      |                              |                            |
| subscriptions                         |                                   | read                         |                            |
| stripe_events                         | no access                         | no access                    |                            |

Anyone signed in can create a business. A trigger makes them its owner.

**Helpers.** `private.member_business_ids()`, `private.owner_business_ids()` and
`private.my_staff_ids()` are `SECURITY DEFINER`, `STABLE` set-returning functions in a
schema PostgREST doesn't expose. Policies use `business_id in (select private.…())`, which
Postgres evaluates once per query, and the definer rights avoid recursing into the RLS on
`memberships`.

**Privileges beyond policies.**

- `TRUNCATE`, `TRIGGER` and `REFERENCES` are revoked from `anon` and `authenticated`.
  RLS doesn't apply to `TRUNCATE`.
- Column grants stop owners updating `plan`, `stripe_customer_id`,
  `ai_monthly_token_budget` and `is_demo`.
- Column-level INSERT grants don't work with Drizzle, which lists every column in an
  INSERT. So the `businesses` insert policy's `WITH CHECK` pins those columns to
  free-plan values instead.
- Tables written only by the server (AI, subscriptions, `stripe_events`) have their write
  grants revoked.
- `bookings` UPDATE is limited by column grants: nobody signed in changes a booking's
  business, code, source, manage-token hash, creator or AI conversation. Column grants
  can't tell owners from staff, so a trigger (`bookings_guard_price`, SQLSTATE 42501)
  lets only owners change `price_cents` (migration `20261110130331_booking_guards.sql`).
- `businesses.ai_enabled` is an owner **preference**, granted like the other settings. It
  is not an entitlement: an owner on the Free plan can switch it on. Before the AI runs
  (Phase 4) and wherever plans are enforced (Phase 5), the server checks the plan and
  subscription itself; it never treats `ai_enabled` as proof of Pro.

**Audit trail from the session.** `booking_events` rows written by a signed-in member get
`actor = 'staff'` and `actor_user_id = auth.uid()` from a trigger
(`booking_events_stamp_actor`), whatever the insert says, so nobody can record an action
as the customer or as a colleague. Paths without a user (public page, AI, jobs) write as
`adminDb` and set the actor themselves.

**Links stay inside a tenant.** Every reference between tenant tables is a composite
`(id, business_id)` foreign key: bookings to service, staff, customer and AI conversation;
staff_services, availability_rules, time_off, staff_invites to their staff and services;
booking_events to bookings; ai_messages and handoff_requests to conversations;
ai_conversations and handoff_requests to customers. Optional links use
`ON DELETE SET NULL (column)` so only the link is cleared, never `business_id`
(migration `20261110124827_tenant_links.sql`).

**Invariants in triggers.** A business always keeps one owner (`memberships_keep_an_owner`,
SQLSTATE 23514). This only applies to signed-in users, so cascading deletes of a business
or an auth user still work.

**adminDb is fenced in code.** `adminDb` is reachable only through `adminQuery()` (whose
type requires `businessId`) and `tenantLookup()` (a closed list: by slug, manage-token
hash, Stripe customer ID) in `src/server/db/admin.ts`. ESLint allows importing those only
from `src/server/db/queries/public/` and `queries/system/`.

## Consequences

- `tests/integration/rls.test.ts` proves it: an owner of A reads 0 rows of B from every
  tenant table and can't insert, update or delete them; it also covers the owner/staff rules.
- Inserting a business with `RETURNING` fails: the select policy is checked before the
  owner trigger runs. Onboarding generates the id in the app.
- Accepting a staff invite needs to create a membership, and users can't insert
  memberships. `private.accept_staff_invite(token)` (migration
  `20261106132152_accept_staff_invite.sql`) is the only way in: `SECURITY DEFINER`,
  executable by `authenticated` only. It hashes the token in SQL, locks the invite row,
  checks expiry, single use and that the signed-in email matches, then creates a
  **staff** membership, links and switches on the staff row, and marks the invite used.
  Invites never make owners.
- Realtime (dashboard live bookings) uses these same policies when it's added.
- Staff can read `businesses.stripe_customer_id`: column grants can't vary by
  role-in-business. It's an identifier, not a secret, and it never reaches public pages.
