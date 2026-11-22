/*
 * CSV for exports (Bookings). RFC 4180 quoting, and safe to open in a
 * spreadsheet: a cell that starts like a formula (= + - @, or a tab or
 * carriage return that some apps skip before reading one) gets a leading
 * apostrophe, so "=HYPERLINK(...)" typed as a customer's name stays text.
 * Client-safe and pure.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell: neutralised if it could run as a formula, then quoted. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Numbers we write ourselves (prices) may be negative one day; they're safe as numbers.
  if (typeof value !== "number" && FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** One line, CRLF-terminated as RFC 4180 asks. */
export function csvRow(values: (string | number | null | undefined)[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

/** Excel reads UTF-8 (accents, emoji in names) only with a byte-order mark. */
export const CSV_BOM = "﻿";
