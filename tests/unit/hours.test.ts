import { describe, expect, it } from "vitest";

import {
  type DayHours,
  defaultWeek,
  describeOpenDays,
  fromAvailabilityRows,
  openingSummary,
  sharedHours,
  summarizeWeek,
  toAvailabilityRows,
  WEEK_ORDER,
  weekSchema,
} from "@/lib/hours";

/** A week from "weekday: ranges" pairs; days not listed are closed. */
function week(open: Record<number, [string, string][]>): DayHours[] {
  return WEEK_ORDER.map((weekday) => ({
    weekday,
    open: weekday in open,
    ranges: (open[weekday] ?? [["09:00", "17:00"]]).map(([start, end]) => ({ start, end })),
  }));
}

const nineToSix: [string, string][] = [["09:00", "18:00"]];
const tueToSun = week({
  0: nineToSix,
  2: nineToSix,
  3: nineToSix,
  4: nineToSix,
  5: nineToSix,
  6: nineToSix,
});

describe("weekSchema", () => {
  it("accepts the default week", () => {
    expect(weekSchema.safeParse(defaultWeek()).success).toBe(true);
  });

  it("accepts several ranges in a day", () => {
    const split = week({
      1: [
        ["09:00", "12:00"],
        ["13:00", "18:00"],
      ],
    });
    expect(weekSchema.safeParse(split).success).toBe(true);
  });

  it("accepts back-to-back ranges", () => {
    expect(
      weekSchema.safeParse(
        week({
          1: [
            ["09:00", "12:00"],
            ["12:00", "13:00"],
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ["no open days", week({}), "Open at least one day"],
    ["end before start", week({ 1: [["17:00", "09:00"]] }), "End after it starts"],
    ["zero-length range", week({ 1: [["09:00", "09:00"]] }), "End after it starts"],
    [
      "overlapping ranges",
      week({
        1: [
          ["09:00", "13:00"],
          ["12:00", "18:00"],
        ],
      }),
      "overlap",
    ],
    ["an open day without hours", week({ 1: [] }), "Add opening hours for Monday"],
    ["off the half hour", week({ 1: [["09:15", "17:00"]] }), "hour or half hour"],
  ])("rejects %s", (_case, days, message) => {
    const result = weekSchema.safeParse(days);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join(" ")).toContain(message);
  });

  it("rejects a week missing a day", () => {
    expect(weekSchema.safeParse(defaultWeek().slice(0, 6)).success).toBe(false);
  });

  it("rejects a repeated weekday", () => {
    const days = defaultWeek();
    days[6] = { ...days[0]! };
    expect(weekSchema.safeParse(days).success).toBe(false);
  });
});

describe("summaries", () => {
  it("summarizeWeek", () => {
    expect(summarizeWeek(tueToSun)).toBe("6 days open. Mondays closed.");
    expect(summarizeWeek(defaultWeek())).toBe("5 days open. Saturdays and Sundays closed.");
    expect(summarizeWeek(week({ 3: nineToSix }))).toBe(
      "1 day open. Mondays, Tuesdays, Thursdays, Fridays, Saturdays and Sundays closed.",
    );
    expect(
      summarizeWeek(
        week({
          0: nineToSix,
          1: nineToSix,
          2: nineToSix,
          3: nineToSix,
          4: nineToSix,
          5: nineToSix,
          6: nineToSix,
        }),
      ),
    ).toBe("Open every day.");
    expect(summarizeWeek(week({}))).toBe("Closed every day.");
  });

  it("describeOpenDays groups consecutive days, Monday first", () => {
    expect(describeOpenDays(tueToSun)).toBe("Tue – Sun");
    expect(describeOpenDays(defaultWeek())).toBe("Mon – Fri");
    expect(describeOpenDays(week({ 1: nineToSix, 3: nineToSix, 5: nineToSix }))).toBe(
      "Mon, Wed, Fri",
    );
    expect(describeOpenDays(week({ 6: nineToSix, 0: nineToSix }))).toBe("Sat, Sun");
    expect(describeOpenDays(week({}))).toBe("");
  });

  it("sharedHours only when every open day matches", () => {
    expect(sharedHours(tueToSun)).toBe("9:00 – 18:00");
    expect(
      sharedHours(
        week({
          1: [
            ["09:00", "12:00"],
            ["13:00", "18:00"],
          ],
        }),
      ),
    ).toBe("9:00 – 12:00, 13:00 – 18:00");
    expect(sharedHours(week({ 1: nineToSix, 2: [["10:00", "18:00"]] }))).toBeNull();
  });

  it("openingSummary reads like the mockup", () => {
    expect(openingSummary(tueToSun)).toBe("Open Tue – Sun · 9:00 – 18:00");
    expect(openingSummary(week({ 1: nineToSix, 2: [["10:00", "18:00"]] }))).toBe(
      "Open Mon, Tue · hours vary by day",
    );
  });
});

describe("availability rows", () => {
  it("round-trips a week through rows", () => {
    const split = week({
      1: [
        ["09:00", "12:00"],
        ["13:00", "18:00"],
      ],
      5: nineToSix,
    });
    const rows = toAvailabilityRows(split);
    expect(rows).toEqual([
      { weekday: 1, startTime: "09:00", endTime: "12:00" },
      { weekday: 1, startTime: "13:00", endTime: "18:00" },
      { weekday: 5, startTime: "09:00", endTime: "18:00" },
    ]);
    // Postgres returns "HH:MM:SS"
    const fromDb = rows.map((r) => ({
      ...r,
      startTime: `${r.startTime}:00`,
      endTime: `${r.endTime}:00`,
    }));
    expect(toAvailabilityRows(fromAvailabilityRows(fromDb))).toEqual(rows);
  });

  it("closed days write no rows", () => {
    expect(toAvailabilityRows(week({}))).toEqual([]);
  });

  it("an empty schedule becomes the default week", () => {
    expect(fromAvailabilityRows([])).toEqual(defaultWeek());
  });
});
