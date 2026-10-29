import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";

import { generateLumenData } from "../../scripts/seed/generate";
import {
  BUSINESS,
  CUSTOMERS,
  HOURS,
  PAST_BOOKING_TARGET,
  SERVICES,
  UPCOMING_BOOKING_TARGET,
} from "../../scripts/seed/lumen-studio";
import { BOOKING_CODE_PATTERN } from "@/server/booking/codes";

const tz = BUSINESS.timezone;
const minutesOfDay = (d: Date) => {
  const local = new TZDate(d, tz);
  return local.getHours() * 60 + local.getMinutes();
};
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// A Thursday, a Monday (studio closed), and New Year's Eve (Christmas time off already past).
const NOWS = [
  new Date("2026-10-29T03:00:00Z"),
  new Date("2026-11-02T01:30:00Z"),
  new Date("2026-12-31T10:00:00Z"),
];

describe.each(NOWS)("generateLumenData (now = %s)", (now) => {
  const data = generateLumenData({ now });
  const { bookings, timeOff } = data;

  it("hits the past and upcoming targets", () => {
    expect(bookings.filter((b) => b.endsAt <= now)).toHaveLength(PAST_BOOKING_TARGET);
    expect(bookings.filter((b) => b.startsAt >= now)).toHaveLength(UPCOMING_BOOKING_TARGET);
  });

  it("never overlaps bookings for the same staff member, buffers included", () => {
    const byStaff = Map.groupBy(bookings, (b) => b.staff);
    for (const list of byStaff.values()) {
      const sorted = list.toSorted((a, b) => a.bufferedStart.getTime() - b.bufferedStart.getTime());
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.bufferedStart >= sorted[i - 1]!.bufferedEnd).toBe(true);
      }
    }
  });

  it("never books a customer into two overlapping appointments", () => {
    const byCustomer = Map.groupBy(bookings, (b) => b.customerIndex);
    for (const list of byCustomer.values()) {
      const sorted = list.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.startsAt >= sorted[i - 1]!.endsAt).toBe(true);
      }
    }
  });

  it("books only inside working hours, for services the staff member offers", () => {
    for (const b of bookings) {
      const weekday = new TZDate(b.startsAt, tz).getDay();
      const fitsHours = HOURS[b.staff].some(
        (h) =>
          h.weekday === weekday &&
          minutesOfDay(b.bufferedStart) >= toMinutes(h.start) &&
          minutesOfDay(b.bufferedEnd) <= toMinutes(h.end),
      );
      expect(fitsHours, `${b.code} ${b.staff} ${b.startsAt.toISOString()}`).toBe(true);
      expect(SERVICES.find((s) => s.key === b.service)!.staff).toContain(b.staff);
      expect(minutesOfDay(b.startsAt) % BUSINESS.slotIntervalMin).toBe(0);
    }
  });

  it("keeps bookings out of time off and upcoming ones outside minimum notice", () => {
    for (const b of bookings) {
      for (const off of timeOff.filter((o) => o.staff === b.staff)) {
        expect(b.bufferedStart >= off.endsAt || b.bufferedEnd <= off.startsAt).toBe(true);
      }
      if (b.startsAt >= now) {
        expect(b.startsAt.getTime() - now.getTime()).toBeGreaterThanOrEqual(
          BUSINESS.minNoticeMin * 60_000,
        );
        expect(["confirmed", "pending"]).toContain(b.status);
      }
    }
  });

  it("uses consistent timestamps and unique, well-formed codes", () => {
    for (const b of bookings) {
      expect(b.createdAt <= now).toBe(true);
      if (b.cancelledAt) expect(b.cancelledAt > b.createdAt).toBe(true);
      expect(b.code).toMatch(BOOKING_CODE_PATTERN);
    }
    expect(new Set(bookings.map((b) => b.code)).size).toBe(bookings.length);
  });

  it("gives Ana Santos two upcoming bookings and every customer a 'since' date", () => {
    expect(bookings.filter((b) => b.customerIndex === 0 && b.startsAt >= now)).toHaveLength(2);
    expect(data.customerSince).toHaveLength(CUSTOMERS.length);
  });

  it("keeps upcoming time off in the future", () => {
    const aiko = timeOff.filter((o) => o.staff === "aiko");
    expect(aiko).toHaveLength(2);
    for (const off of aiko) expect(off.endsAt > now).toBe(true);
  });

  it("never starts time off on a Monday, when the studio is closed", () => {
    for (const off of timeOff) expect(new TZDate(off.startsAt, tz).getDay()).not.toBe(1);
  });
});

it("is deterministic for the same date and seed", () => {
  const now = NOWS[0]!;
  const codes = (seed?: number) => generateLumenData({ now, seed }).bookings.map((b) => b.code);
  expect(codes()).toEqual(codes());
  expect(codes(7)).not.toEqual(codes());
});
