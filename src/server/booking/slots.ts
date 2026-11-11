/**
 * The slot engine: which start times a customer may book. PURE: no database,
 * no clock, no env. Callers load the rows and pass `now`.
 *
 * Rules (tests/unit/slots.test.ts is the full specification):
 * - Working hours are wall-clock ranges in the business timezone, converted
 *   to instants per date, so a DST change never moves them. Local times the
 *   clocks skip don't exist; local times they repeat exist twice.
 * - Starts sit on the business's local clock grid (`slotIntervalMin`, 15 or 30).
 * - The appointment (start to start + duration) fits inside one working range
 *   and doesn't overlap time off.
 * - Buffers separate bookings: the buffered range (start - bufferBefore to
 *   end + bufferAfter) mustn't overlap another pending or confirmed booking's
 *   buffered range, which is what `no_double_booking` checks. Buffers may fall
 *   outside working hours and inside time off.
 * - Starts are at least `minNoticeMin` after `now`, and no later than the
 *   business-local date `maxDaysAhead` days after today's (inclusive).
 * - Ranges are half-open `[start, end)`: back-to-back bookings fit.
 * - Only active staff who offer the service are bookable.
 * - "any": one slot per start instant, given to the staff member with the
 *   fewest pending or confirmed bookings on that business-local date, then the
 *   lowest `sortOrder`, then the earliest in `staff`.
 */

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

export type SlotBusiness = {
  /** IANA zone the hours are written in. */
  timezone: string;
  minNoticeMin: number;
  maxDaysAhead: number;
  slotIntervalMin: number;
};

export type SlotService = {
  id: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
};

export type SlotStaff = {
  id: string;
  active: boolean;
  sortOrder: number;
  /** Services this person performs (staff_services). */
  serviceIds: string[];
  /** availability_rules rows: weekday 0 = Sunday; times "09:00" or "09:00:00". */
  hours: { weekday: number; startTime: string; endTime: string }[];
  timeOff: { startsAt: Date; endsAt: Date }[];
  bookings: { bufferedStart: Date; bufferedEnd: Date; status: BookingStatus }[];
};

export type SlotQuery = {
  business: SlotBusiness;
  service: SlotService;
  staff: SlotStaff[];
  staffId: string | "any";
  /** Starts in `[from, to)`, typically a day or week in the customer's timezone. */
  from: Date;
  to: Date;
  now: Date;
};

export type Slot = {
  start: Date;
  /** start + durationMin (without buffers). */
  end: Date;
  staffId: string;
};

/** Available slots, sorted by start, at most one per start instant. */
export function getAvailableSlots(_query: SlotQuery): Slot[] {
  throw new Error("getAvailableSlots is not implemented yet (step 2.2).");
}
