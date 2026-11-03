/** Brand colour swatches offered in onboarding. Teal is Slotwren's own primary. */
export const BRAND_SWATCHES = [
  { hex: "#0F766E", name: "Teal" },
  { hex: "#4338CA", name: "Indigo" },
  { hex: "#86198F", name: "Plum" },
  { hex: "#BE123C", name: "Crimson" },
  { hex: "#15803D", name: "Green" },
  { hex: "#44403C", name: "Charcoal" },
] as const;

export const DEFAULT_BRAND_COLOR = BRAND_SWATCHES[0].hex;

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Text colours a brand colour may be paired with on buttons. */
export const WHITE = "#FFFFFF";
export const INK = "#1C1917"; // --foreground

function channel(value: number) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(channel) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for normal text. */
export const AA_TEXT = 4.5;

/**
 * Text colour for buttons filled with the brand colour: white when it passes
 * AA, otherwise whichever of white or ink contrasts more.
 */
export function readableTextOn(brand: string): string {
  if (contrastRatio(brand, WHITE) >= AA_TEXT) return WHITE;
  return contrastRatio(brand, INK) > contrastRatio(brand, WHITE) ? INK : WHITE;
}

/** "5.47:1", truncated (not rounded) so 4.496 never displays as a passing 4.50. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

/** Mix `hex` toward white: tint("#0F766E", 0.85) is a soft background of the brand colour. */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix) as [number, number, number];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`;
}

/** "Lumen Studio" → "LS", "Ana" → "AN". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
