# 0003 · Slot rules: buffers, "anyone available", DST

- Status: accepted
- Date: 2026-11-12
- Code: `src/server/booking/slots.ts` · Spec: `tests/unit/slots.test.ts`

## Context

The slot engine decides which start times a customer may book. It feeds the public page,
the embed, the AI receptionist's `checkAvailability`, and the server-side re-check in
`booking/service.ts`, so every channel has to agree on the same rules. The rules below
aren't obvious from the data model alone, so we record them here.

## Decision

**The engine is pure.** `getAvailableSlots(query)` takes the business rules, the service,
every staff member (hours, time off, bookings), a `[from, to)` window and `now`. There's
no database, no clock and no env, so the unit tests can cover every case.

**Appointments fit the hours; buffers keep bookings apart.**

- The appointment itself (start to start + duration) must sit inside one of the staff
  member's working ranges for that day and must not overlap their time off.
- Buffers (`buffer_before_min`, `buffer_after_min`) exist to separate one booking from
  the next. The _buffered_ range must not overlap another pending or confirmed booking's
  buffered range. That is exactly what the `no_double_booking` exclusion constraint checks,
  so the engine never offers a slot the database would refuse.
- Buffers may fall outside working hours and inside time off. With hours 09:00–17:00, a
  60-minute service with 15-minute buffers is bookable at 09:00 and at 16:00.

We rejected requiring the whole buffered range to fit the hours. On a 30-minute grid, a
10-minute setup buffer would push the first slot of every day from 09:00 to 09:30, which
owners would read as a bug. Setup before opening and cleanup after closing are normal.

**"Anyone available" assignment.** When the customer picks "Anyone", each start time
appears once. The engine gives it to the free, eligible staff member who has:

1. the fewest pending or confirmed bookings on that business-local date, then
2. the lowest `sort_order` (the order the owner arranged the team in), then
3. the earliest position in the input list.

This spreads work across the team without randomness, so the same inputs always give the
same staff member. The customer sees who they got before confirming. Cancelled,
completed and no-show bookings don't count towards the load. Bookings on other dates
don't count either, so one busy day doesn't starve someone of work all week.

**Who is bookable.** Only active staff (`staff.active`) who offer the service
(`staff_services`). If a specific staff member is requested and they don't qualify, the
result is empty rather than an error.

**Time.**

- Hours are business-local wall-clock times, converted to instants per date. A DST change
  never moves a 09:00 opening.
- Starts sit on the business's local clock grid (`slot_interval_min`, 15 or 30).
- Duration and minimum notice are real elapsed time. Across the spring change, 01:30 + 60
  minutes is 03:30.
- Wall times the clocks skip don't exist. Wall times they repeat exist twice, as two
  different instants. A range that starts in a repeated hour starts at its first reading.
- `max_days_ahead` counts business-local dates from today's date there, inclusive, and the
  whole last day is bookable.
- Every range is half-open `[start, end)`, so back-to-back bookings fit.

**Labels for the customer.** Each slot carries `local` in the viewer's timezone
(`displayTimezone`, defaulting to the business's): date, time, UTC offset, short zone name
("EDT", "GMT+8"), and `repeated: "first" | "second" | null`. On the night the clocks go
back, the UI can then show "01:30 EDT" and "01:30 EST" (or "first"/"second") instead of two
identical "01:30" chips. Zone names use the `en-US` locale on both server and browser, so
they render the same everywhere and don't cause hydration mismatches.

**Performance.** Timezone conversion goes through `zoneClock()` (`src/lib/zone-clock.ts`):
one `Intl` formatter per zone, with offsets memoised per quarter hour. A week for six busy
staff takes about 10 ms, and a 60-day window about 200 ms.

## Consequences

- The booking service re-runs the engine for the requested start before inserting.
  Hours, time off, notice and the date limit are enforced on the server, not only in the
  UI. The exclusion constraint still decides races between two customers.
- Owners who want buffers to stay inside working hours must shorten the hours instead.
  If that turns out to matter, we can add a per-service "buffers inside hours" option
  without changing the default.
- "Fewest bookings that day" ignores how long those bookings are. Balancing by minutes is
  a possible later refinement, and it would only change rule 1.
