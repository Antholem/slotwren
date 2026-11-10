/** Integer cents + ISO currency → "$35", "$35.50", "Free". */
export function formatPrice(cents: number, currency: string, locale = "en-US"): string {
  if (cents === 0) return "Free";
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** "$" for USD, "€" for EUR, … */
export function currencySymbol(currency: string, locale = "en-US"): string {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency
  );
}

/**
 * Currencies whose usual locale writes the decimal with a comma ("35,50 €").
 * Fixed here rather than read from Intl, so the server and every browser
 * agree. Only consulted when input is genuinely ambiguous ("1,234").
 */
const COMMA_DECIMAL = new Set(["EUR", "SEK", "NOK", "DKK", "PLN", "CZK", "BRL"]);

/** "," or "." */
export const decimalSeparator = (currency: string) => (COMMA_DECIMAL.has(currency) ? "," : ".");

/** Spaces (incl. no-break and thin) and apostrophes are only ever thousands separators. */
const GROUP_ONLY = /[\s   '’]/g;

/** "1,234,567" (and Indian "1,23,456"): valid thousands grouping with `sep`. */
function isGrouped(whole: string, sep: string): boolean {
  const s = sep === "." ? "\\." : sep;
  return new RegExp(`^\\d{1,3}(${s}\\d{3})+$|^\\d{1,2}(${s}\\d{2})*${s}\\d{3}$`).test(whole);
}

/**
 * A typed price → cents, in `currency`'s conventions. Empty means free.
 * Unambiguous forms are read the same for every currency:
 *   "35", "35.5", "35,50" (one separator, 1–2 digits after: a decimal),
 *   "1,234.56", "1.234,56" (both: the last is the decimal),
 *   "1 234,56", "1'234.50" (spaces and apostrophes group thousands).
 * Only "1,234" / "1.234" depend on the currency: thousands where that
 * character groups thousands, refused where it marks decimals (three
 * decimals). Anything else (negatives, letters, bad grouping) is null.
 * Up to 999,999.99.
 */
export function parsePriceToCents(input: string, currency = "USD"): number | null {
  const value = input.trim().replace(GROUP_ONLY, (match, offset: number, all: string) =>
    // Keep a group mark only between digits: "1 234" yes, "35 " no (already trimmed).
    /\d/.test(all[offset - 1] ?? "") && /\d/.test(all[offset + 1] ?? "") ? "_" : match,
  );
  if (value === "") return 0;
  if (/[^\d.,_]/.test(value)) return null;

  let whole: string;
  let fraction = "";
  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    // Both: the later one is the decimal, the other groups thousands.
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    const at = value.lastIndexOf(decimal);
    whole = value.slice(0, at);
    fraction = value.slice(at + 1);
    if (!/^\d{1,2}$/.test(fraction)) return null;
    if (!isGrouped(whole.replaceAll("_", group), group)) return null;
    whole = whole.replace(/[.,_]/g, "");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = value.split(sep);
    const after = parts.at(-1)!;
    if (parts.length === 2 && /^\d{1,2}$/.test(after)) {
      // "35,50" / "35.5": a group needs three digits, so this is a decimal.
      [whole, fraction] = parts as [string, string];
    } else if (after.length === 3 && !value.includes("_")) {
      // "1,234" / "1.234" / "1,234,567": thousands, unless this currency
      // writes decimals with `sep` (then it's three decimals: refuse).
      if (decimalSeparator(currency) === sep) return null;
      if (!isGrouped(value, sep)) return null;
      whole = value.replaceAll(sep, "");
    } else {
      return null;
    }
  } else {
    whole = value;
  }

  // Thousands grouped with spaces or apostrophes: "1 234", "1'234".
  if (whole.includes("_")) {
    if (!isGrouped(whole.replaceAll("_", ","), ",")) return null;
    whole = whole.replaceAll("_", "");
  }
  if (!/^\d{1,6}$/.test(whole)) return null;
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** "35.50" / "35,50": a price written the way `currency` writes it, for examples. */
export const priceExample = (currency = "USD") => `35${decimalSeparator(currency)}50`;

/** Cents → the text a price input shows: 3500 → "35", 3550 → "35.50" (EUR "35,50"), 0 → "0". */
export function centsToInput(cents: number, currency = "USD"): string {
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2).replace(".", decimalSeparator(currency));
}

/**
 * Currencies a business can pick. Prices are integer cents, so only
 * currencies with two decimal places (ISO 4217) are offered.
 */
export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "SGD",
  "HKD",
  "PHP",
  "MYR",
  "THB",
  "INR",
  "AED",
  "ZAR",
  "MXN",
  "BRL",
] as const;

export const isSupportedCurrency = (code: string) =>
  (CURRENCIES as readonly string[]).includes(code);

/** "USD · US Dollar" */
export function currencyLabel(code: string, locale = "en-US"): string {
  const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
  return name && name !== code ? `${code} · ${name}` : code;
}
