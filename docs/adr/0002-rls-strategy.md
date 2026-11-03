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
  memberships. The invites step will add a `SECURITY DEFINER` function that checks the
  invite token.
- Realtime (dashboard live bookings) uses these same policies when it's added.
- Staff can read `businesses.stripe_customer_id`: column grants can't vary by
  role-in-business. It's an identifier, not a secret, and it never reaches public pages.
