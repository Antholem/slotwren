-- Live dashboard (step 3.8): Supabase Realtime broadcasts booking changes.
--
-- Realtime's postgres_changes authorises every change against the subscriber's
-- RLS SELECT policy (bookings_select: members of the booking's business), so
-- a member only ever receives their own business's bookings, whatever filter
-- they ask for. Tested in tests/integration/realtime.test.ts.
--
-- Only bookings are published: the dashboard refetches through the server on
-- each change, so the payload is a signal, not the data the page renders.
alter publication supabase_realtime add table public.bookings;
