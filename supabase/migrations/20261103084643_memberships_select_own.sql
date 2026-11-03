-- A signed-in user can see their own memberships, so the proxy can tell
-- "has a business" (→ /app) from "needs onboarding" (→ /onboarding).
-- Read-only: memberships are created by onboarding and invites through
-- server code, never written directly by a user. The rest of the tenant
-- policies land in Phase 1, step 6.
create policy memberships_select_own on public.memberships
  for select
  to authenticated
  using (user_id = (select auth.uid()));
