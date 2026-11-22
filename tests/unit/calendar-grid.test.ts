import { describe, expect, it } from "vitest";

import {
  dayLengthMin,
  layoutOverlaps,
  place,
  realTimeColumn,
  rowIndexAt,
  wallClockColumn,
  weekDates,
} from "@/lib/calendar-grid";
import { zonedInstant } from "@/lib/time-off";

const NY = "America/New_York";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const at = (date: string, time: string, zone = NY) => zonedInstant(date, time, zone);

describe("weekDates", () => {
  it("runs Monday to Sunday around any day", () => {
    expect(weekDates("2026-11-01")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(weekDates("2026-11-02")[0]).toBe("2026-11-02");
    expect(weekDates("2026-12-31").at(-1)).toBe("2027-01-03");
  });
});

describe("DST day heights", () => {
  it("a day is 1440 minutes, 1500 when clocks go back, 1380 when they go forward", () => {
    expect(dayLengthMin("2026-11-04", NY)).toBe(1440);
    expect(dayLengthMin("2026-11-01", NY)).toBe(1500);
    expect(dayLengthMin("2026-03-08", NY)).toBe(1380);
    expect(dayLengthMin("2026-11-01", "Asia/Manila")).toBe(1440);
  });

  it("day view: the whole fall-back day has 50 half-hour rows, 01:00 twice", () => {
    const column = realTimeColumn("2026-11-01", NY, { start: 0, end: h(24) }, 30);
    expect(column.rows).toHaveLength(50);
    expect(column.lengthMin).toBe(1500);
    const times = column.rows.map((r) => r.time);
    expect(times.slice(0, 7)).toEqual([
      "00:00",
      "00:30",
      "01:00",
      "01:30",
      "01:00",
      "01:30",
      "02:00",
    ]);
    expect(column.rows[4]).toMatchObject({ time: "01:00", repeated: true });
    expect(column.rows[4]!.start!.toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });

  it("day view: the spring-forward day has 46 rows and no 02:xx", () => {
    const column = realTimeColumn("2026-03-08", NY, { start: 0, end: h(24) }, 30);
    expect(column.rows).toHaveLength(46);
    expect(column.rows.map((r) => r.time)).not.toContain("02:00");
    expect(column.rows.map((r) => r.time).slice(2, 5)).toEqual(["01:00", "01:30", "03:00"]);
  });

  it("day view: a business-hours window on a DST day is unaffected", () => {
    const column = realTimeColumn("2026-11-01", NY, { start: h(9), end: h(18) }, 30);
    expect(column.rows).toHaveLength(18);
    expect(column.lengthMin).toBe(540);
    expect(column.offsetOf(at("2026-11-01", "10:15"))).toBe(75);
  });

  it("week view: a skipped wall time has a row that doesn't exist", () => {
    const column = wallClockColumn("2026-03-08", NY, { start: h(1), end: h(4) }, 30);
    expect(column.rows.map((r) => [r.time, r.start !== null])).toEqual([
      ["01:00", true],
      ["01:30", true],
      ["02:00", false],
      ["02:30", false],
      ["03:00", true],
      ["03:30", true],
    ]);
    expect(column.lengthMin).toBe(180);
  });

  it("week view: both passes through a repeated hour land on the same rows", () => {
    const column = wallClockColumn("2026-11-01", NY, { start: 0, end: h(4) }, 30);
    expect(column.rows).toHaveLength(8);
    const first = new Date("2026-11-01T05:15:00Z"); // 01:15 EDT
    const second = new Date("2026-11-01T06:15:00Z"); // 01:15 EST
    expect(column.offsetOf(first)).toBe(h(1, 15));
    expect(column.offsetOf(second)).toBe(h(1, 15));
    expect(rowIndexAt(column, column.offsetOf(second))).toBe(2);
  });
});

describe("place", () => {
  const column = wallClockColumn("2026-11-04", NY, { start: h(9), end: h(18) }, 30);

  it("positions by local time and clips to the column", () => {
    expect(
      place({ startsAt: at("2026-11-04", "10:00"), endsAt: at("2026-11-04", "10:45") }, column),
    ).toEqual({
      top: 60,
      height: 45,
    });
    expect(
      place({ startsAt: at("2026-11-04", "08:30"), endsAt: at("2026-11-04", "09:30") }, column),
    ).toEqual({
      top: 0,
      height: 30,
    });
    expect(
      place({ startsAt: at("2026-11-04", "17:30"), endsAt: at("2026-11-05", "01:00") }, column),
    ).toEqual({
      top: 510,
      height: 30,
    });
  });

  it("leaves out events outside the window or on other days", () => {
    expect(
      place({ startsAt: at("2026-11-04", "07:00"), endsAt: at("2026-11-04", "08:00") }, column),
    ).toBeNull();
    expect(
      place({ startsAt: at("2026-11-05", "10:00"), endsAt: at("2026-11-05", "11:00") }, column),
    ).toBeNull();
    expect(
      place({ startsAt: at("2026-11-03", "10:00"), endsAt: at("2026-11-03", "11:00") }, column),
    ).toBeNull();
  });
});

describe("layoutOverlaps", () => {
  const ev = (id: string, top: number, height: number) => ({ id, top, height });

  it("gives events that don't overlap the full width", () => {
    const laid = layoutOverlaps([ev("a", 0, 30), ev("b", 30, 30)]);
    expect(laid.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(laid.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("puts overlapping events side by side", () => {
    const laid = layoutOverlaps([ev("a", 0, 60), ev("b", 30, 60)]);
    expect(laid.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(laid.get("b")).toEqual({ lane: 1, lanes: 2 });
  });

  it("shares a chain's width and reuses lanes that free up", () => {
    // a overlaps b, b overlaps c, a and c don't: two lanes, c back in lane 0.
    const laid = layoutOverlaps([
      ev("a", 0, 60),
      ev("b", 30, 60),
      ev("c", 60, 60),
      ev("d", 200, 30),
    ]);
    expect(laid.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(laid.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(laid.get("c")).toEqual({ lane: 0, lanes: 2 });
    expect(laid.get("d")).toEqual({ lane: 0, lanes: 1 });
  });

  it("handles three at once", () => {
    const laid = layoutOverlaps([ev("a", 0, 90), ev("b", 0, 30), ev("c", 10, 30)]);
    expect([...laid.values()].every((l) => l.lanes === 3)).toBe(true);
    expect(new Set([...laid.values()].map((l) => l.lane))).toEqual(new Set([0, 1, 2]));
  });
});
