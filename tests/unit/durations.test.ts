import { describe, expect, it } from "vitest";

import { blockedTimeSummary, formatMinutes } from "@/lib/durations";

describe("formatMinutes", () => {
  it.each([
    [15, "15 min"],
    [60, "1 h"],
    [105, "1 h 45 min"],
    [240, "4 h"],
  ])("%i → %s", (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text);
  });
});

describe("blockedTimeSummary", () => {
  const base = { durationMin: 90, bufferBeforeMin: 0, bufferAfterMin: 15, slotIntervalMin: 30 };

  it("reads like the mockup", () => {
    expect(blockedTimeSummary(base)).toBe(
      "Blocks 1 h 45 min in the calendar (90 min + 15 min clean-up). Next start rounds up to the half hour.",
    );
  });

  it("skips the rounding note when it fits the interval", () => {
    expect(blockedTimeSummary({ ...base, bufferAfterMin: 30 })).toBe(
      "Blocks 2 h in the calendar (90 min + 30 min clean-up).",
    );
  });

  it("names prep time and the quarter hour", () => {
    expect(
      blockedTimeSummary({
        durationMin: 45,
        bufferBeforeMin: 10,
        bufferAfterMin: 0,
        slotIntervalMin: 15,
      }),
    ).toBe(
      "Blocks 55 min in the calendar (10 min prep + 45 min). Next start rounds up to the quarter hour.",
    );
  });

  it("no breakdown without buffers", () => {
    expect(blockedTimeSummary({ ...base, bufferAfterMin: 0 })).toBe(
      "Blocks 1 h 30 min in the calendar.",
    );
  });
});
