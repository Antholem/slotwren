import { describe, expect, it } from "vitest";

import {
  centsToInput,
  CURRENCIES,
  currencySymbol,
  formatPrice,
  parsePriceToCents,
  priceExample,
} from "@/lib/money";

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
    ["0,5", 50],
  ])("%j → %i", (input, cents) => {
    expect(parsePriceToCents(input)).toBe(cents);
  });

  it.each(["-5", "35.505", "abc", "1e3", "$35", "1234567", "35.", ".5", "1,2345", "12,34,5"])(
    "rejects %j",
    (input) => {
      expect(parsePriceToCents(input)).toBeNull();
    },
  );

  // The same text, for a dot-decimal and a comma-decimal currency.
  it.each([
    // input, USD, EUR
    ["35,50", 3550, 3550], // one separator, two digits after: a decimal either way
    ["1,234.56", 123456, 123456], // both separators: the last is the decimal
    ["1.234,56", 123456, 123456],
    ["1 234,56", 123456, 123456], // spaces only ever group thousands
    ["1'234.50", 123450, 123450],
    ["1,234", 123400, null], // EUR writes decimals with a comma: three decimals, refused
    ["1.234", null, 123400], // USD writes decimals with a dot: refused
    ["1,234,567", null, null], // over 999,999
    ["12,345", 1234500, null],
    ["1,23,456", 12345600, null], // Indian grouping, where comma groups thousands
  ])("%j → USD %s, EUR %s", (input, usd, eur) => {
    expect(parsePriceToCents(input, "USD")).toBe(usd);
    expect(parsePriceToCents(input, "EUR")).toBe(eur);
  });

  it("refuses broken grouping instead of guessing", () => {
    expect(parsePriceToCents("1,23.45", "USD")).toBeNull();
    expect(parsePriceToCents("12.34.56", "USD")).toBeNull();
    expect(parsePriceToCents("1 23,45", "EUR")).toBeNull();
  });
});

describe("centsToInput", () => {
  it("writes the currency's decimal separator", () => {
    expect(centsToInput(3550, "USD")).toBe("35.50");
    expect(centsToInput(3550, "EUR")).toBe("35,50");
    expect(centsToInput(3500, "EUR")).toBe("35");
    expect(priceExample("PLN")).toBe("35,50");
    expect(priceExample("PHP")).toBe("35.50");
  });

  it("round-trips with parsePriceToCents in every currency", () => {
    for (const currency of CURRENCIES) {
      for (const cents of [0, 100, 3500, 3550, 3505, 99999, 99999999]) {
        expect(parsePriceToCents(centsToInput(cents, currency), currency), currency).toBe(cents);
      }
    }
  });
});

describe("currencySymbol", () => {
  it("returns the symbol for the business currency", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
  });
});
