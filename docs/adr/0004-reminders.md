# 0004 · Booking reminders

- Status: accepted
- Date: 2026-11-21
- Code: `src/lib/reminders.ts` (timing), `src/server/booking/reminders.ts` (plan and send),
  `src/server/jobs/` (Inngest) · Tests: `tests/unit/reminders.test.ts`,
  `tests/integration/reminders.test.ts`

## Context

Customers forget appointments, and a no-show costs a small business a whole slot. A reminder
is most useful while the customer can still cancel for free, so a business with a 24-hour
window gets a reminder before that window closes, not an hour before the appointment.

## Decision

**When.** Two hours before the free-cancellation deadline: the appointment minus the
business's `cancellation_window_hours`, minus 2 h, counted in real hours. If that lands
between 21:00 and 08:00 in the business's timezone, send at 20:00 the evening before
instead: the same local date for 21:00–23:59, the previous date for 00:00–07:59. 20:00 is
built from the local date (`zoneClock`), so it's right across DST changes.

**Bookings made inside the window: skip.** If the moment has already passed when the
booking is made or moved, there is no reminder. The confirmation (or reschedule) email went
out moments earlier with the same details and the policy, so a second email would be
noise. We chose skipping over sending immediately for that reason. This also covers the
evening-before shift landing in the past.

**How it runs.**

- After every change commits, `booking/service.ts` sends one event,
  `booking/reminder.schedule` `{ bookingId, businessId, startsAt, sendAt | null, revision }`:
  - created or moved: a plan (`sendAt` null when there's nothing to send);
  - cancelled: a clear (`sendAt` null).
- The `booking-reminder` function sleeps until `sendAt`. Its `cancelOn` matches a later
  event for the same booking with a different `revision`, so each new plan cancels the old
  one while it waits.
- At send time, `sendReminder()` checks again, so a missed cancellation can't send a wrong
  reminder:
  - the booking is still pending or confirmed;
  - its start equals the plan's `startsAt`, so it hasn't moved since;
  - it hasn't started yet.
- The reminder carries a freshly minted manage link (`purpose = 'reminder'`, ADR 0002). The
  confirmation's link keeps working too.
- Like email, events never fail a booking: without Inngest keys (and in tests) they're
  skipped, and errors are logged.

## Consequences

- Locally: `INNGEST_DEV=1` and `pnpm jobs:dev` (the Inngest dev server on :8288, pointed at
  `/api/inngest`). Production needs the Inngest Vercel integration (event and signing keys).
- Changing a business's cancellation window doesn't re-plan existing reminders. They go out
  at the old time, and the email's policy line uses the current window. A re-plan job can
  come with the settings page if that matters.
- Only one reminder per booking. A second "day of" reminder would be a new event and rule.
