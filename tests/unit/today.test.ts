import { describe, expect, it } from "vitest";

import { zonedInstant } from "@/lib/time-off";
import {
  addDays,
  appointmentState,
  greetingAt,
  noShowRate,
  todayRanges,
  weekChange,
  weekdayOf,
} from "@/lib/today";

const HOUR = 3_600_000;

describe("todayRanges", () => {
  it("uses local midnights, not UTC ones", () => {
    // Wed 4 Nov 2026 23:30 in New York is already the 5th in UTC.
    const now = zonedInstant("2026-11-04", "23:30", "America/New_York");
    const r = todayRanges(now, "America/New_York");
    expect(r.date).toBe("2026-11-04");
    expect(r.weekday).toBe(3);
    expect(r.dayStart.toISOString()).toBe("2026-11-04T05:00:00.000Z");
    expect(r.dayEnd.toISOString()).toBe("2026-11-05T05:00:00.000Z");
    expect(r.weekStart.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // Monday, EST
    expect(r.weekEnd.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(r.lastWeekStart.toISOString()).toBe("2026-10-26T04:00:00.000Z"); // Monday, EDT
    expect(r.last30Start.getTime()).toBe(now.getTime() - 30 * 24 * HOUR);
  });

  it("gives the fall-back Sunday 25 hours and the spring-forward Sunday 23", () => {
    const fall = todayRanges(
      zonedInstant("2026-11-01", "12:00", "America/New_York"),
      "America/New_York",
    );
    expect(fall.dayEnd.getTime() - fall.dayStart.getTime()).toBe(25 * HOUR);
    const spring = todayRanges(
      zonedInstant("2026-03-08", "12:00", "America/New_York"),
      "America/New_York",
    );
    expect(spring.dayEnd.getTime() - spring.dayStart.getTime()).toBe(23 * HOUR);
    // A Sunday belongs to the week that started the Monday before.
    expect(spring.weekStart.toISOString()).toBe("2026-03-02T05:00:00.000Z");
  });

  it("starts Manila's day 8 hours before UTC's", () => {
    const r = todayRanges(new Date("2026-11-03T20:00:00Z"), "Asia/Manila"); // Wed 04:00 local
    expect(r.date).toBe("2026-11-04");
    expect(r.dayStart.toISOString()).toBe("2026-11-03T16:00:00.000Z");
  });

  it("does calendar arithmetic across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-11-01")).toBe(0);
  });
});

describe("greetingAt", () => {
  const zone = "Europe/London";
  it.each([
    ["08:00", "Good morning"],
    ["11:59", "Good morning"],
    ["12:00", "Good afternoon"],
    ["17:59", "Good afternoon"],
    ["18:00", "Good evening"],
    ["00:30", "Good morning"],
  ])("%s → %s", (time, greeting) => {
    expect(greetingAt(zonedInstant("2026-11-04", time, zone), zone)).toBe(greeting);
  });
});

describe("appointmentState", () => {
  const startsAt = new Date("2026-11-04T10:00:00Z");
  const endsAt = new Date("2026-11-04T11:00:00Z");
  const appt = (status: "confirmed" | "pending" | "completed" | "no_show" | "cancelled") => ({
    status,
    startsAt,
    endsAt,
  });

  it("follows the clock for active bookings", () => {
    expect(appointmentState(appt("confirmed"), new Date("2026-11-04T09:59:59Z"))).toBe("upcoming");
    expect(appointmentState(appt("confirmed"), startsAt)).toBe("in_progress");
    expect(appointmentState(appt("pending"), new Date("2026-11-04T10:59:59Z"))).toBe("in_progress");
    expect(appointmentState(appt("confirmed"), endsAt)).toBe("unmarked");
  });

  it("keeps settled bookings settled", () => {
    expect(appointmentState(appt("completed"), startsAt)).toBe("done");
    expect(appointmentState(appt("no_show"), startsAt)).toBe("no_show");
    expect(appointmentState(appt("cancelled"), startsAt)).toBe("cancelled");
  });
});

describe("stat formatting", () => {
  it("compares weeks in whole percent", () => {
    expect(weekChange(58, 51)).toBe(14);
    expect(weekChange(40, 50)).toBe(-20);
    expect(weekChange(5, 0)).toBeNull();
  });

  it("formats the no-show rate", () => {
    expect(noShowRate(1, 32)).toBe("3.1%");
    expect(noShowRate(0, 10)).toBe("0%");
    expect(noShowRate(1, 4)).toBe("25%");
    expect(noShowRate(0, 0)).toBeNull();
  });
});
