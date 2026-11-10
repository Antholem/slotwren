import { describe, expect, it } from "vitest";

import {
  dayMinutes,
  type DayHours,
  defaultWeek,
  describeOpenDays,
  formatDuration,
  fromAvailabilityRows,
  hoursOutsideOpening,
  isOnGrid,
  type OpeningRange,
  openingSummary,
  openingWeek,
  roundRangeInward,
  roundWeekInward,
  sharedHours,
  summarizeWeek,
  timeOf,
  timeOptions,
  toAvailabilityRows,
  WEEK_ORDER,
  weekSchema,
  weeklyHoursLabel,
  weeklyHoursParts,
  weekOnGrid,
  weekSchemaFor,
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
    ["an open day without hours", week({ 1: [] }), "Add hours for Monday or mark it closed"],
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

describe("timeOptions", () => {
  it("covers the day on the business's grid", () => {
    const half = timeOptions(30);
    expect(half).toHaveLength(48);
    expect(half.slice(0, 3)).toEqual(["00:00", "00:30", "01:00"]);
    expect(half.at(-1)).toBe("23:30");
    const quarter = timeOptions(15);
    expect(quarter).toHaveLength(96);
    expect(quarter.slice(0, 3)).toEqual(["00:00", "00:15", "00:30"]);
  });
});

describe("weekSchemaFor (staff hours)", () => {
  const staffWeek = weekSchemaFor({ intervalMin: 30, requireOpenDay: false });

  it("lets a staff member be off all week", () => {
    expect(staffWeek.safeParse(week({})).success).toBe(true);
    expect(weekSchema.safeParse(week({})).success).toBe(false);
  });

  it("follows the business's slot interval", () => {
    const quarterPast = week({ 2: [["09:15", "17:45"]] });
    expect(staffWeek.safeParse(quarterPast).success).toBe(false);
    expect(weekSchemaFor({ intervalMin: 15 }).safeParse(quarterPast).success).toBe(true);
    // Off a 15-minute grid too.
    expect(
      weekSchemaFor({ intervalMin: 15 }).safeParse(week({ 2: [["09:10", "17:00"]] })).success,
    ).toBe(false);
  });

  it("puts errors on the day that has them", () => {
    const result = staffWeek.safeParse(
      week({
        3: [
          ["09:00", "13:00"],
          ["12:30", "18:00"],
        ],
      }),
    );
    expect(result.success).toBe(false);
    // Wednesday is index 2 (Monday first).
    expect(result.error?.issues[0]).toMatchObject({
      path: [2, "ranges"],
      message: "Wednesday's hours overlap.",
    });
  });

  it("caps the ranges in a day", () => {
    const many = week({
      1: [
        ["08:00", "09:00"],
        ["10:00", "11:00"],
        ["12:00", "13:00"],
        ["14:00", "15:00"],
        ["16:00", "17:00"],
      ],
    });
    expect(staffWeek.safeParse(many).success).toBe(false);
  });
});

describe("day totals", () => {
  it("dayMinutes adds the ranges of open days", () => {
    expect(
      dayMinutes({
        weekday: 1,
        open: true,
        ranges: [
          { start: "09:00", end: "12:00" },
          { start: "13:00", end: "17:30" },
        ],
      }),
    ).toBe(450);
    expect(
      dayMinutes({ weekday: 1, open: false, ranges: [{ start: "09:00", end: "17:00" }] }),
    ).toBe(0);
  });

  it("formatDuration", () => {
    expect(formatDuration(540)).toBe("9 h");
    expect(formatDuration(270)).toBe("4 h 30 min");
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(0)).toBe("–");
  });
});

describe("hoursOutsideOpening (a warning, not an error)", () => {
  const opening: OpeningRange[] = [2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday,
    start: "09:00",
    end: "18:00",
  }));

  it("is quiet when hours sit inside opening hours", () => {
    expect(hoursOutsideOpening(tueToSun, opening)).toEqual([]);
    expect(hoursOutsideOpening(week({ 2: [["10:00", "14:00"]] }), opening)).toEqual([]);
  });

  it("flags a day the business is closed", () => {
    expect(hoursOutsideOpening(week({ 1: nineToSix }), opening)).toEqual([
      "Monday: the business is closed that day.",
    ]);
  });

  it("flags hours that start early or end late", () => {
    expect(
      hoursOutsideOpening(week({ 2: [["08:30", "17:00"]], 3: [["12:00", "19:00"]] }), opening),
    ).toEqual([
      "Tuesday: outside opening hours (09:00 – 18:00).",
      "Wednesday: outside opening hours (09:00 – 18:00).",
    ]);
  });

  it("handles split opening hours", () => {
    const split: OpeningRange[] = [
      { weekday: 2, start: "09:00", end: "12:00" },
      { weekday: 2, start: "13:00", end: "18:00" },
    ];
    expect(hoursOutsideOpening(week({ 2: [["13:00", "17:00"]] }), split)).toEqual([]);
    // Over lunch, when the business is closed.
    expect(hoursOutsideOpening(week({ 2: [["11:00", "14:00"]] }), split)).toEqual([
      "Tuesday: outside opening hours (09:00 – 12:00, 13:00 – 18:00).",
    ]);
    // Back-to-back opening ranges count as continuous.
    const touching: OpeningRange[] = [
      { weekday: 2, start: "09:00", end: "12:00" },
      { weekday: 2, start: "12:00", end: "18:00" },
    ];
    expect(hoursOutsideOpening(week({ 2: [["10:00", "15:00"]] }), touching)).toEqual([]);
  });

  it("openingWeek turns opening hours into editor days", () => {
    expect(openingWeek(null)).toBeNull();
    expect(openingWeek([])).toBeNull();
    expect(openingSummary(openingWeek(opening)!)).toBe("Open Tue – Sun · 9:00 – 18:00");
  });
});

describe("moving hours onto a coarser grid", () => {
  it("timeOf and isOnGrid", () => {
    expect(timeOf(570)).toBe("09:30");
    expect(timeOf(0)).toBe("00:00");
    expect(isOnGrid("09:45", 15)).toBe(true);
    expect(isOnGrid("09:45", 30)).toBe(false);
    expect(isOnGrid("10:00", 30)).toBe(true);
  });

  it("roundRangeInward never grows a range", () => {
    expect(roundRangeInward({ start: "09:15", end: "17:45" }, 30)).toEqual({
      start: "09:30",
      end: "17:30",
    });
    expect(roundRangeInward({ start: "09:00", end: "17:00" }, 30)).toEqual({
      start: "09:00",
      end: "17:00",
    });
    expect(roundRangeInward({ start: "09:15", end: "10:00" }, 30)).toEqual({
      start: "09:30",
      end: "10:00",
    });
    // Too short for the grid: nothing left.
    expect(roundRangeInward({ start: "09:15", end: "09:45" }, 30)).toBeNull();
    expect(roundRangeInward({ start: "23:15", end: "23:45" }, 30)).toBeNull();
  });

  it("roundWeekInward rounds open days and closes emptied ones", () => {
    const days = week({
      1: [
        ["09:15", "12:00"],
        ["13:00", "17:45"],
      ],
      2: [["09:15", "09:45"]],
    });
    const rounded = roundWeekInward(days, 30);
    expect(rounded[0]).toEqual({
      weekday: 1,
      open: true,
      ranges: [
        { start: "09:30", end: "12:00" },
        { start: "13:00", end: "17:30" },
      ],
    });
    expect(rounded[1]?.open).toBe(false);
    expect(weekOnGrid(rounded, 30)).toBe(true);
    expect(weekOnGrid(days, 30)).toBe(false);
    expect(weekOnGrid(days, 15)).toBe(true);
    // Closed days don't count.
    expect(weekOnGrid(week({}), 30)).toBe(true);
  });
});

describe("weekly hours on staff cards", () => {
  it("splits into parts that wrap between ranges, not inside one", () => {
    const aiko = week({
      2: nineToSix,
      3: nineToSix,
      4: nineToSix,
      5: nineToSix,
      6: nineToSix,
      0: [["09:00", "13:00"]],
    });
    expect(weeklyHoursParts(aiko)).toEqual(["Tue – Sat 09:00 – 18:00", "Sun 09:00 – 13:00"]);
    expect(weeklyHoursLabel(aiko)).toBe("Tue – Sat 09:00 – 18:00 · Sun 09:00 – 13:00");
  });

  it("one run splits into its days and its hours", () => {
    expect(weeklyHoursParts(tueToSun)).toEqual(["Tue – Sun", "09:00 – 18:00"]);
    expect(weeklyHoursLabel(tueToSun)).toBe("Tue – Sun · 09:00 – 18:00");
  });

  it("no hours", () => {
    expect(weeklyHoursParts(week({}))).toEqual([]);
    expect(weeklyHoursLabel(week({}))).toBe("No hours set");
  });
});
