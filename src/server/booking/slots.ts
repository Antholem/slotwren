import { nextDate } from "@/lib/time-off";

import { type ZoneClock, zoneClock } from "@/lib/zone-clock";

/**
 * The slot engine: which start times a customer may book. PURE: no database,
 * no clock, no env. Callers load the rows and pass `now`. The rules and why
 * are in docs/adr/0003-slot-rules.md; tests/unit/slots.test.ts is the full
 * specification.
 *
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
  /** Zone for each slot's `local` label (the customer's). Default: the business's. */
  displayTimezone?: string;
};

/** How a start reads on a clock in the display timezone. */
export type SlotLabel = {
  /** "2026-11-01" */
  date: string;
  /** "01:30" */
  time: string;
  /** UTC offset at that instant: "-04:00". */
  offset: string;
  /** Short zone name: "EDT", "EST", "GMT+8". */
  zone: string;
  /**
   * When the clocks go back, a wall time happens twice that night: "first" or
   * "second" tells them apart. Null for every other time.
   */
  repeated: "first" | "second" | null;
};

export type Slot = {
  start: Date;
  /** start + durationMin (without buffers). */
  end: Date;
  staffId: string;
  local: SlotLabel;
};

const MIN = 60_000;
const BLOCKING: ReadonlySet<BookingStatus> = new Set(["pending", "confirmed"]);

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

/** Weekday (0 = Sunday) of a "YYYY-MM-DD" calendar date. */
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Available slots, sorted by start, at most one per start instant. */
export function getAvailableSlots(query: SlotQuery): Slot[] {
  const { business, service, now } = query;
  const clock = zoneClock(business.timezone);
  const from = query.from.getTime();
  const to = query.to.getTime();

  const duration = service.durationMin * MIN;
  const step = business.slotIntervalMin * MIN;
  const earliest = Math.max(from, now.getTime() + business.minNoticeMin * MIN);
  const lastDate = nextDate(clock.parts(now.getTime()).date, business.maxDaysAhead);

  const eligible = query.staff
    .map((person, index) => ({ person, index }))
    .filter(
      ({ person }) =>
        person.active &&
        person.serviceIds.includes(service.id) &&
        (query.staffId === "any" || person.id === query.staffId),
    );
  if (eligible.length === 0 || earliest >= to) return [];

  // Local dates whose hours could produce a start in [earliest, to). Starting
  // a day early covers hours that begin before local midnight's instant moves.
  const firstDate = nextDate(clock.parts(earliest).date, -1);
  const endDate = clock.parts(to).date;
  const dates: { date: string; weekday: number }[] = [];
  for (let d = firstDate; d <= endDate && d <= lastDate; d = nextDate(d)) {
    dates.push({ date: d, weekday: weekdayOf(d) });
  }

  type Candidate = { staffId: string; load: number; sortOrder: number; index: number };
  const byStart = new Map<number, Candidate>();
  const better = (a: Candidate, b: Candidate) =>
    a.load - b.load || a.sortOrder - b.sortOrder || a.index - b.index;

  for (const { person, index } of eligible) {
    const blocking = person.bookings
      .filter((b) => BLOCKING.has(b.status))
      .map((b) => ({ start: b.bufferedStart.getTime(), end: b.bufferedEnd.getTime() }));
    const away = person.timeOff.map((t) => ({
      start: t.startsAt.getTime(),
      end: t.endsAt.getTime(),
    }));
    // Bookings per business-local date, for "any" assignment.
    const loadOn = new Map<string, number>();
    for (const b of blocking) {
      const date = clock.parts(b.start).date;
      loadOn.set(date, (loadOn.get(date) ?? 0) + 1);
    }

    for (const { date, weekday } of dates) {
      for (const rule of person.hours) {
        if (rule.weekday !== weekday) continue;
        const rangeStart = clock.instant(date, rule.startTime.slice(0, 5));
        const rangeEnd = clock.instant(date, rule.endTime.slice(0, 5));

        // First instant on the local clock grid at or after the range start.
        const offGrid = clock.parts(rangeStart).minutes % business.slotIntervalMin;
        let start =
          offGrid === 0 ? rangeStart : rangeStart + (business.slotIntervalMin - offGrid) * MIN;

        for (; start + duration <= rangeEnd && start < to; start += step) {
          if (start < earliest) continue;
          const end = start + duration;
          if (away.some((t) => overlaps(start, end, t.start, t.end))) continue;
          const blockedStart = start - service.bufferBeforeMin * MIN;
          const blockedEnd = end + service.bufferAfterMin * MIN;
          if (blocking.some((b) => overlaps(blockedStart, blockedEnd, b.start, b.end))) continue;

          const candidate = {
            staffId: person.id,
            load: loadOn.get(date) ?? 0,
            sortOrder: person.sortOrder,
            index,
          };
          const current = byStart.get(start);
          if (!current || better(candidate, current) < 0) byStart.set(start, candidate);
        }
      }
    }
  }

  const display = zoneClock(query.displayTimezone ?? business.timezone);
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, { staffId }]) => ({
      start: new Date(start),
      end: new Date(start + duration),
      staffId,
      local: labelFor(start, display),
    }));
}

/** How `instant` reads on `clock`, telling a repeated wall time's two readings apart. */
export function labelFor(instant: number, clock: ZoneClock): SlotLabel {
  const { date, time } = clock.parts(instant);
  // The wall time repeats if the same reading occurs a shift (30 or 60 min) away.
  const same = (other: number) => {
    const p = clock.parts(other);
    return p.date === date && p.time === time;
  };
  const shifts = [60 * MIN, 30 * MIN];
  const repeated = shifts.some((s) => same(instant + s))
    ? "first"
    : shifts.some((s) => same(instant - s))
      ? "second"
      : null;
  const offsetMin = clock.offsetMin(instant);
  return {
    date,
    time,
    offset: formatOffset(offsetMin),
    zone: zoneName(clock.zone, instant, offsetMin),
    repeated,
  };
}

function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${hh}:${String(abs % 60).padStart(2, "0")}`;
}

const zoneNames = new Map<string, string>();

/**
 * "EDT", "EST", "GMT+8": the short name, fixed to en-US so server and browser
 * agree. A zone's name only changes with its offset, so cache by both.
 */
function zoneName(zone: string, instant: number, offsetMin: number): string {
  const key = `${zone} ${offsetMin}`;
  let name = zoneNames.get(key);
  if (name === undefined) {
    name =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
        .formatToParts(instant)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    zoneNames.set(key, name);
  }
  return name;
}
