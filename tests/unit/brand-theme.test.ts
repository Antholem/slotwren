import { describe, expect, it } from "vitest";

import { BRAND_GROUNDS, brandTheme, brandThemeCss, mix } from "@/lib/brand-theme";
import { BRAND_SWATCHES, contrastRatio, DEFAULT_BRAND_COLOR } from "@/lib/color";

// The swatches, some awkward colours (pale, mid-grey, neon, near-black), and a
// deterministic spread across the whole cube.
const AWKWARD = ["#FDE047", "#FFFFFF", "#808080", "#767676", "#00FF00", "#111111", "#000000"];
const SPREAD = Array.from({ length: 216 }, (_, i) => {
  const step = (n: number) => (n * 51).toString(16).padStart(2, "0");
  return `#${step(i % 6)}${step(Math.floor(i / 6) % 6)}${step(Math.floor(i / 36))}`.toUpperCase();
});
const COLOURS = [...BRAND_SWATCHES.map((s) => s.hex), ...AWKWARD, ...SPREAD].filter(
  (c) => c !== DEFAULT_BRAND_COLOR,
);

describe("brandTheme", () => {
  it("leaves Slotwren's own teal to the design tokens", () => {
    expect(brandTheme(DEFAULT_BRAND_COLOR)).toBeNull();
    expect(brandTheme("#0f766e")).toBeNull();
    expect(brandThemeCss(DEFAULT_BRAND_COLOR)).toBe("");
  });

  it("refuses anything that isn't #RRGGBB", () => {
    expect(brandTheme("red")).toBeNull();
    expect(brandThemeCss("#123;}body{display:none")).toBe("");
  });

  it.each(["light", "dark"] as const)("keeps every %s token readable", (mode) => {
    const ground = BRAND_GROUNDS[mode];
    for (const colour of COLOURS) {
      const tokens = brandTheme(colour)![mode];
      // Button labels and selected chips.
      expect(
        contrastRatio(tokens.primary, tokens.primaryForeground),
        colour,
      ).toBeGreaterThanOrEqual(4.5);
      // The fill and focus ring stand out from the card.
      expect(contrastRatio(tokens.primary, ground.card), colour).toBeGreaterThanOrEqual(3);
      // Text on the tinted, selected card.
      expect(contrastRatio(tokens.primaryTint, ground.foreground), colour).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrastRatio(tokens.primaryTint, tokens.primaryTintForeground),
        colour,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses the brand colour itself in light mode when it already works", () => {
    expect(brandTheme("#BE123C")!.light).toMatchObject({
      primary: "#BE123C",
      primaryForeground: "#FFFFFF",
    });
  });

  it("lightens dark brand colours for dark mode", () => {
    const { dark } = brandTheme("#4338CA")!;
    expect(contrastRatio(dark.primary, BRAND_GROUNDS.dark.card)).toBeGreaterThanOrEqual(4.5);
    expect(dark.primary).not.toBe("#4338CA");
  });

  it("writes CSS scoped to the booking page, dark tokens under .dark", () => {
    const css = brandThemeCss("#BE123C");
    expect(css).toMatch(/^\.booking-theme\{--primary:#BE123C;/);
    expect(css).toContain(".dark .booking-theme{--primary:#");
    expect(css).not.toMatch(/[<>]/);
  });
});

describe("mix", () => {
  it("interpolates in sRGB", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#BE123C", "#BE123C", 0.3)).toBe("#BE123C");
    expect(mix("#123456", "#FFFFFF", 1)).toBe("#FFFFFF");
  });
});
