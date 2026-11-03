import { describe, expect, it } from "vitest";

import { centsToInput, currencySymbol, formatPrice, parsePriceToCents } from "@/lib/money";

describe("formatPrice", () => {
  it.each([
    [0, "USD", "Free"],
    [3500, "USD", "$35"],
    [3550, "USD", "$35.50"],
    [125000, "USD", "$1,250"],
    [3500, "EUR", "€35"],
    [3500, "PHP", "₱35"],
  ])("%i %s → %s", (cents, currency, text) => {
    expect(formatPrice(cents, currency)).toBe(text);
  });
});

describe("parsePriceToCents", () => {
  it.each([
    ["35", 3500],
    ["35.5", 3550],
    ["35.50", 3550],
    [" 1,250 ", 125000],
    ["0", 0],
    ["", 0],
  ])("%j → %i", (input, cents) => {
    expect(parsePriceToCents(input)).toBe(cents);
  });

  it.each(["-5", "35.505", "abc", "1e3", "$35", "1234567"])("rejects %j", (input) => {
    expect(parsePriceToCents(input)).toBeNull();
  });
});

describe("centsToInput", () => {
  it("round-trips with parsePriceToCents", () => {
    for (const cents of [0, 100, 3500, 3550, 3505, 99999]) {
      expect(parsePriceToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

describe("currencySymbol", () => {
  it("returns the symbol for the business currency", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
  });
});
