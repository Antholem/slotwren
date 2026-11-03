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
 * "35", "35.5", "35.50", "" → cents. Returns null for anything else (negative,
 * more than two decimals, letters). Empty means free.
 */
export function parsePriceToCents(input: string): number | null {
  const value = input.trim().replace(/,/g, "");
  if (value === "") return 0;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Cents → the text a price input shows: 3500 → "35", 3550 → "35.50", 0 → "0". */
export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
