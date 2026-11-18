import { AA_TEXT, contrastRatio, DEFAULT_BRAND_COLOR, HEX_COLOR, INK, WHITE } from "@/lib/color";

/*
 * The booking page wears the business's colour: buttons, the selected card,
 * chips and the progress bar use `primary` tokens, recomputed from the brand
 * colour so they stay readable (WCAG AA) in light and dark mode. Slotwren's own
 * teal keeps the design tokens untouched.
 */

/** Grounds the brand colours sit on (docs/design/globals.css). */
const LIGHT = { background: "#FAFAF9", card: "#FFFFFF", foreground: "#1C1917" };
const DARK = { background: "#0C0A09", card: "#1C1917", foreground: "#FAFAF9" };
const BLACK = "#000000";

/** Contrast that marks out a filled control or focus ring from its ground (1.4.11). */
const NON_TEXT = 3;

export type BrandTokens = {
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  primaryTint: string;
  primaryTintForeground: string;
  ring: string;
};

export type BrandTheme = { light: BrandTokens; dark: BrandTokens };

const toRgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};
const toHex = (rgb: readonly number[]) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** `a` moved `t` (0–1) of the way to `b`, in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex(x.map((c, i) => c + (y[i]! - c) * t));
}

/** Step `color` towards `target` until `ok` holds (or it arrives). */
function shiftUntil(color: string, target: string, ok: (c: string) => boolean): string {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const candidate = mix(color, target, Math.min(t, 1));
    if (ok(candidate)) return candidate;
  }
  return target;
}

/** The better of white or ink text on `fill`. */
const textOn = (fill: string) =>
  contrastRatio(fill, WHITE) >= contrastRatio(fill, INK) ? WHITE : INK;

/**
 * A fill whose label passes AA: the colour itself if white or ink reads on
 * it, else nudged darker (towards a white label) until one does.
 */
function readableFill(color: string): string {
  const passes = (c: string) => contrastRatio(c, textOn(c)) >= AA_TEXT;
  if (passes(color)) return color;
  return shiftUntil(color, BLACK, passes);
}

function lightTokens(brand: string): BrandTokens {
  // Fills must still stand out from a white card (very pale brands darken).
  const visible = shiftUntil(brand, BLACK, (c) => contrastRatio(c, LIGHT.card) >= NON_TEXT);
  const primary = readableFill(visible);
  const tint = mix(brand, WHITE, 0.86);
  return {
    primary,
    primaryForeground: textOn(primary),
    primaryHover: mix(primary, BLACK, 0.15),
    primaryTint: tint,
    primaryTintForeground: shiftUntil(primary, BLACK, (c) => contrastRatio(c, tint) >= AA_TEXT),
    ring: primary,
  };
}

function darkTokens(brand: string): BrandTokens {
  // Lighter on dark grounds, so it reads as text and as a fill on the card.
  const primary = readableFill(
    shiftUntil(brand, WHITE, (c) => contrastRatio(c, DARK.card) >= AA_TEXT),
  );
  const tint = mix(brand, DARK.card, 0.7);
  return {
    primary,
    primaryForeground: textOn(primary),
    primaryHover: mix(primary, WHITE, 0.2),
    primaryTint: tint,
    primaryTintForeground: shiftUntil(primary, WHITE, (c) => contrastRatio(c, tint) >= AA_TEXT),
    ring: primary,
  };
}

/** Light and dark tokens for a brand colour; null for Slotwren's own teal or bad input. */
export function brandTheme(brandColor: string): BrandTheme | null {
  if (!HEX_COLOR.test(brandColor)) return null;
  const brand = brandColor.toUpperCase();
  if (brand === DEFAULT_BRAND_COLOR.toUpperCase()) return null;
  return { light: lightTokens(brand), dark: darkTokens(brand) };
}

const declarations = (tokens: BrandTokens) =>
  [
    `--primary:${tokens.primary}`,
    `--primary-foreground:${tokens.primaryForeground}`,
    `--primary-hover:${tokens.primaryHover}`,
    `--primary-tint:${tokens.primaryTint}`,
    `--primary-tint-foreground:${tokens.primaryTintForeground}`,
    `--ring:${tokens.ring}`,
  ].join(";");

/**
 * CSS scoping the tokens to `.${scope}` (dark ones under `.dark`). Every value
 * is a #RRGGBB built here, so it is safe to put in a <style> element.
 */
export function brandThemeCss(brandColor: string, scope = "booking-theme"): string {
  const theme = brandTheme(brandColor);
  if (!theme) return "";
  return `.${scope}{${declarations(theme.light)}}.dark .${scope}{${declarations(theme.dark)}}`;
}

export const BRAND_GROUNDS = { light: LIGHT, dark: DARK };
