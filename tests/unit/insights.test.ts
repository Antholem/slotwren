import { describe, expect, it } from "vitest";

import { heatLevel, insightWeeks, percent } from "@/lib/insights";

describe("insightWeeks", () => {
  it("ends with the week holding today, Monday first", () => {
    const { mondays, bounds } = insightWeeks("4w", "2026-11-08", "Europe/London"); // a Sunday
    expect(mondays).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
    expect(bounds).toHaveLength(5);
    // London's clocks went back on 25 Oct: that week's Monday is midnight GMT, the one before BST.
    expect(bounds[1]!.toISOString()).toBe("2026-10-18T23:00:00.000Z");
    expect(bounds[2]!.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("this year starts at the week holding 1 January", () => {
    expect(insightWeeks("year", "2027-01-01", "Asia/Manila").mondays).toEqual(["2026-12-28"]);
    expect(insightWeeks("year", "2026-03-10", "Asia/Manila").mondays[0]).toBe("2025-12-29");
  });
});

describe("heat and shares", () => {
  it("steps counts into four levels against the busiest cell", () => {
    expect([0, 1, 2, 3, 4, 8].map((n) => heatLevel(n, 8))).toEqual([0, 1, 1, 2, 2, 4]);
    expect(heatLevel(5, 0)).toBe(0);
  });

  it("formats shares as whole percents", () => {
    expect(percent(118, 568)).toBe("21%");
    expect(percent(0, 0)).toBe("–");
  });
});
