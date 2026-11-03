import { describe, expect, it } from "vitest";

import {
  BRAND_SWATCHES,
  contrastRatio,
  formatRatio,
  initialsOf,
  INK,
  readableTextOn,
  tint,
  WHITE,
} from "@/lib/color";

describe("contrastRatio", () => {
  it("matches the WCAG extremes", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0F766E", WHITE)).toBe(contrastRatio(WHITE, "#0F766E"));
  });

  it("gives Slotwren teal 5.47:1 with white text, as in the mockup", () => {
    expect(formatRatio(contrastRatio("#0F766E", WHITE))).toBe("5.47:1");
  });

  it.each(BRAND_SWATCHES.map((s) => [s.name, s.hex]))(
    "the %s swatch passes AA with white text",
    (_name, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("readableTextOn", () => {
  it("keeps white on dark brand colours", () => {
    expect(readableTextOn("#0F766E")).toBe(WHITE);
  });

  it("switches to ink on light ones", () => {
    expect(readableTextOn("#FDE68A")).toBe(INK);
    expect(readableTextOn("#FFFFFF")).toBe(INK);
  });
});

describe("formatRatio", () => {
  it("truncates so a failing ratio never shows as 4.50", () => {
    expect(formatRatio(4.4999)).toBe("4.49:1");
    expect(formatRatio(21)).toBe("21.00:1");
  });
});

describe("tint", () => {
  it("mixes toward white", () => {
    expect(tint("#000000", 0.5)).toBe("#808080");
    expect(tint("#0F766E", 0)).toBe("#0F766E");
    expect(tint("#0F766E", 1)).toBe("#FFFFFF");
  });
});

describe("initialsOf", () => {
  it.each([
    ["Lumen Studio", "LS"],
    ["lumen studio and spa", "LS"],
    ["Ana", "AN"],
    ["  ", ""],
  ])("%j → %j", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});
