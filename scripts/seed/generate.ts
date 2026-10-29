import { TZDate } from "@date-fns/tz";
import { addDays, addMinutes, differenceInCalendarDays } from "date-fns";

import { generateBookingCode } from "../../src/server/booking/codes";

import {
  BUSINESS,
  CUSTOMERS,
  HOURS,
  PAST_BOOKING_TARGET,
  PAST_WINDOW_DAYS,
  SERVICES,
  STAFF,
  TIME_OFF,
  UPCOMING_BOOKING_TARGET,
  UPCOMING_WINDOW_DAYS,
  type ServiceKey,
  type ServiceSeed,
  type StaffKey,
} from "./lumen-studio";

/*
 * Pure generator for Lumen Studio's time off and bookings. Deterministic for a
 * given (now, seed), and it respects the same rules the real system enforces:
 * working hours, time off, buffers and no overlaps per staff member. The unit
 * test checks those invariants; the database's exclusion constraint checks
 * them again when the seed is written.
 */

export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let r = rng() * total;
  for (const item of items) {
    r -= weight(item);
    if (r < 0) return item;
  }
  return items[items.length - 1]!;
}

const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

type Interval = { start: Date; end: Date };
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end; // half-open

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

export type GeneratedTimeOff = {
  staff: StaffKey;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reason: string;
};

export type GeneratedBooking = {
  code: string;
  staff: StaffKey;
  service: ServiceKey;
  customerIndex: number;
  startsAt: Date;
  endsAt: Date;
  bufferedStart: Date;
  bufferedEnd: Date;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  source: "page" | "widget" | "ai" | "manual";
  priceCents: number;
  createdAt: Date;
  cancelledAt: Date | null;
  customerTimezone: string;
  customerNotes: string | null;
};

export type GeneratedData = {
  timeOff: GeneratedTimeOff[];
  bookings: GeneratedBooking[];
  /** Per customer index: when they became a customer. */
  customerSince: Date[];
};

const SOURCES = [
  { value: "page", weight: 45 },
  { value: "widget", weight: 20 },
  { value: "ai", weight: 15 },
  { value: "manual", weight: 20 },
] as const;

const BOOKING_NOTES = [
  "First visit",
  "Running from work, may be 5 min late",
  "Would like to keep the length",
  "Bringing a reference photo",
];

/** Start-time popularity by local hour: late morning and late afternoon peaks. */
function hourWeight(minutesOfDay: number): number {
  const hour = Math.floor(minutesOfDay / 60);
  if (hour >= 10 && hour < 12) return 3;
  if (hour >= 15 && hour < 17) return 3;
  if (hour === 9 || hour === 17) return 1;
  return 2;
}

export function generateLumenData({
  now,
  seed = 2026,
}: {
  now: Date;
  seed?: number;
}): GeneratedData {
  const rng = mulberry32(seed);
  const tz = BUSINESS.timezone;

  const nowLocal = new TZDate(now, tz);
  const today = new TZDate(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), tz);
  const localDay = (offset: number) => addDays(today, offset);
  const localTime = (day: TZDate, minutes: number) =>
    new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes, tz);

  // ── time off ─────────────────────────────────────────────────────────
  const timeOff: GeneratedTimeOff[] = TIME_OFF.map((rule) => {
    let start: TZDate;
    if (rule.when === "next-friday-after-a-week") {
      const weekOut = localDay(7);
      start = addDays(weekOut, (5 - weekOut.getDay() + 7) % 7);
    } else if (rule.when === "christmas") {
      let christmasEve = new TZDate(today.getFullYear(), 11, 24, tz);
      if (differenceInCalendarDays(addDays(christmasEve, rule.days - 1), today) < 0) {
        christmasEve = new TZDate(today.getFullYear() + 1, 11, 24, tz);
      }
      start = christmasEve;
    } else {
      start = localDay(rule.when);
      // Time off starting on a closed Monday wouldn't show anywhere; start Tuesday.
      if (start.getDay() === 1) start = addDays(start, 1);
    }
    return {
      staff: rule.staff,
      startsAt: start,
      endsAt: addDays(start, rule.days),
      allDay: true,
      reason: rule.reason,
    };
  });

  // ── bookings ─────────────────────────────────────────────────────────
  const occupied = new Map<StaffKey, Interval[]>(STAFF.map((s) => [s.key, []]));
  const customerBusy = new Map<number, Interval[]>();
  const codes = new Set<string>();
  const bookings: GeneratedBooking[] = [];
  const earliestBookable = addMinutes(now, BUSINESS.minNoticeMin);

  const isFree = (staff: StaffKey, interval: Interval) =>
    !occupied.get(staff)!.some((busy) => overlaps(busy, interval)) &&
    !timeOff.some(
      (off) => off.staff === staff && overlaps({ start: off.startsAt, end: off.endsAt }, interval),
    );

  function tryPlace(dayOffset: number, phase: "past" | "upcoming"): boolean {
    const day = localDay(dayOffset);
    const weekday = day.getDay();
    const working = STAFF.filter((s) => HOURS[s.key].some((h) => h.weekday === weekday));
    if (working.length === 0) return false; // studio closed (Mondays)

    const staff = working[Math.floor(rng() * working.length)]!.key;
    const service: ServiceSeed = pickWeighted(
      rng,
      SERVICES.filter((s) => s.staff.includes(staff)),
      (s) => s.weight,
    );
    const ranges = HOURS[staff].filter((h) => h.weekday === weekday);
    const range = ranges[Math.floor(rng() * ranges.length)]!;
    const open = toMinutes(range.start);
    const close = toMinutes(range.end);

    const candidates: number[] = [];
    for (
      let t = open;
      t + service.durationMin + service.bufferAfterMin <= close;
      t += BUSINESS.slotIntervalMin
    ) {
      if (t - service.bufferBeforeMin >= open) candidates.push(t);
    }
    if (candidates.length === 0) return false;

    const startMinutes = pickWeighted(rng, candidates, hourWeight);
    const startsAt = localTime(day, startMinutes);
    const endsAt = addMinutes(startsAt, service.durationMin);
    const buffered = {
      start: addMinutes(startsAt, -service.bufferBeforeMin),
      end: addMinutes(endsAt, service.bufferAfterMin),
    };

    if (phase === "past" && endsAt > now) return false;
    if (phase === "upcoming" && startsAt < earliestBookable) return false;
    if (!isFree(staff, buffered)) return false;

    let code = generateBookingCode(rng);
    while (codes.has(code)) code = generateBookingCode(rng);
    codes.add(code);
    occupied.get(staff)!.push(buffered);

    // A customer is never in two chairs at once. Ana's upcoming bookings are set below.
    const appointment = { start: startsAt, end: endsAt };
    const eligible = CUSTOMERS.map((customer, index) => ({ customer, index })).filter(
      ({ index }) =>
        !(phase === "upcoming" && index === 0) &&
        !(customerBusy.get(index) ?? []).some((busy) => overlaps(busy, appointment)),
    );
    const { customer, index: customerIndex } = pickWeighted(
      rng,
      eligible,
      ({ customer }) => customer.weight ?? 1,
    );
    customerBusy.set(customerIndex, [...(customerBusy.get(customerIndex) ?? []), appointment]);

    let status: GeneratedBooking["status"];
    const roll = rng();
    if (phase === "past")
      status = roll < 0.04 ? "no_show" : roll < 0.13 ? "cancelled" : "completed";
    else status = roll < 0.07 ? "pending" : "confirmed";

    // Booked 1–14 days ahead; never in the future.
    let createdAt = addMinutes(startsAt, -randInt(rng, 1 * 24 * 60, 14 * 24 * 60));
    if (createdAt > now) createdAt = addMinutes(now, -randInt(rng, 10, 600));

    let cancelledAt: Date | null = null;
    if (status === "cancelled") {
      cancelledAt = addMinutes(startsAt, -randInt(rng, 26 * 60, 72 * 60));
      if (cancelledAt <= createdAt) cancelledAt = addMinutes(createdAt, 60);
    }

    bookings.push({
      code,
      staff,
      service: service.key,
      customerIndex,
      startsAt,
      endsAt,
      bufferedStart: buffered.start,
      bufferedEnd: buffered.end,
      status,
      source: pickWeighted(rng, SOURCES, (s) => s.weight).value,
      priceCents: service.priceCents,
      createdAt,
      cancelledAt,
      customerTimezone: customer.timezone ?? tz,
      customerNotes: rng() < 0.1 ? BOOKING_NOTES[Math.floor(rng() * BOOKING_NOTES.length)]! : null,
    });
    return true;
  }

  // Past: busier at weekends. Includes earlier today.
  let placed = 0;
  for (let attempt = 0; placed < PAST_BOOKING_TARGET && attempt < 50_000; attempt++) {
    const offset = -randInt(rng, 0, PAST_WINDOW_DAYS);
    const weekday = localDay(offset).getDay();
    if (weekday !== 0 && weekday !== 6 && rng() < 0.35) continue;
    if (tryPlace(offset, "past")) placed++;
  }

  // Upcoming: denser in the next few days, thinning out.
  placed = 0;
  for (let attempt = 0; placed < UPCOMING_BOOKING_TARGET && attempt < 50_000; attempt++) {
    const offset = randInt(rng, 0, UPCOMING_WINDOW_DAYS - 1);
    if (rng() > 1 - offset / (UPCOMING_WINDOW_DAYS * 1.4)) continue;
    if (tryPlace(offset, "upcoming")) placed++;
  }

  bookings.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  // Ana Santos (customer profile mockup) always has two upcoming haircuts.
  const anaUpcoming = bookings
    .filter((b) => b.startsAt >= now && b.service === "haircut" && b.status === "confirmed")
    .filter((b, i, list) =>
      list
        .slice(0, i)
        .every(
          (prev) =>
            !overlaps(
              { start: prev.startsAt, end: prev.endsAt },
              { start: b.startsAt, end: b.endsAt },
            ),
        ),
    )
    .slice(0, 2);
  for (const booking of anaUpcoming) {
    booking.customerIndex = 0;
    booking.customerTimezone = CUSTOMERS[0]!.timezone ?? tz;
  }

  const customerSince = CUSTOMERS.map((_, index) => {
    const first = bookings
      .filter((b) => b.customerIndex === index)
      .reduce<Date | null>((min, b) => (!min || b.createdAt < min ? b.createdAt : min), null);
    return first ?? addDays(now, -randInt(rng, 5, 30));
  });

  return { timeOff, bookings, customerSince };
}
