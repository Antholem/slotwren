import { describe, expect, it } from "vitest";

import { defaultWeek, type DayHours, WEEK_ORDER } from "@/lib/hours";
import { CURRENCIES, currencyLabel, isSupportedCurrency } from "@/lib/money";
import {
  bookingRulesSchema,
  businessSettingsSchema,
  formatCancellation,
  formatNotice,
  NOTICE_OPTIONS,
} from "@/lib/validation/settings";

const rules = {
  minNoticeMin: 120,
  maxDaysAhead: 60,
  slotIntervalMin: 30,
  cancellationWindowHours: 24,
};

const messages = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message).join(" ") ?? "";

describe("bookingRulesSchema", () => {
  it("accepts the defaults and the edges", () => {
    expect(bookingRulesSchema.safeParse(rules).success).toBe(true);
    expect(
      bookingRulesSchema.safeParse({
        minNoticeMin: 0,
        maxDaysAhead: 1,
        slotIntervalMin: 15,
        cancellationWindowHours: 0,
      }).success,
    ).toBe(true);
    expect(
      bookingRulesSchema.safeParse({
        minNoticeMin: 10080,
        maxDaysAhead: 365,
        slotIntervalMin: 30,
        cancellationWindowHours: 336,
      }).success,
    ).toBe(true);
  });

  it("coerces form strings to numbers", () => {
    const result = bookingRulesSchema.parse({
      minNoticeMin: "60",
      maxDaysAhead: "30",
      slotIntervalMin: "15",
      cancellationWindowHours: "48",
    });
    expect(result).toEqual({
      minNoticeMin: 60,
      maxDaysAhead: 30,
      slotIntervalMin: 15,
      cancellationWindowHours: 48,
    });
  });

  it.each([
    ["negative notice", { minNoticeMin: -5 }, "up to a week"],
    ["notice over a week", { minNoticeMin: 10085 }, "up to a week"],
    ["notice off the 5-minute steps", { minNoticeMin: 7 }, "Pick a minimum notice"],
    ["0 days ahead", { maxDaysAhead: 0 }, "at least 1 day"],
    ["an empty days field", { maxDaysAhead: "" }, "at least 1 day"],
    ["over a year ahead", { maxDaysAhead: 366 }, "Up to 365 days"],
    ["part days", { maxDaysAhead: 1.5 }, "whole number of days"],
    ["text for days", { maxDaysAhead: "soon" }, "whole number of days"],
    ["a 20-minute grid", { slotIntervalMin: 20 }, "15 or 30"],
    ["a 60-minute grid", { slotIntervalMin: 60 }, "15 or 30"],
    ["a negative window", { cancellationWindowHours: -1 }, "up to two weeks"],
    ["a window over two weeks", { cancellationWindowHours: 337 }, "up to two weeks"],
    ["part hours", { cancellationWindowHours: 1.5 }, "cancellation window"],
  ])("rejects %s", (_case, change, message) => {
    const result = bookingRulesSchema.safeParse({ ...rules, ...change });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain(message);
  });

  it("rejects notice that leaves nothing to book", () => {
    // 2 days' notice but only 2 days ahead: every slot is too soon.
    const result = bookingRulesSchema.safeParse({ ...rules, minNoticeMin: 2880, maxDaysAhead: 2 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["maxDaysAhead"] });
    expect(
      bookingRulesSchema.safeParse({ ...rules, minNoticeMin: 2880, maxDaysAhead: 3 }).success,
    ).toBe(true);
  });

  it("offers only choices it accepts", () => {
    for (const minNoticeMin of NOTICE_OPTIONS) {
      expect(
        bookingRulesSchema.safeParse({ ...rules, minNoticeMin, maxDaysAhead: 365 }).success,
      ).toBe(true);
    }
  });
});

describe("rule labels", () => {
  it("formatNotice", () => {
    expect(formatNotice(0)).toBe("No minimum");
    expect(formatNotice(15)).toBe("15 minutes");
    expect(formatNotice(60)).toBe("1 hour");
    expect(formatNotice(120)).toBe("2 hours");
    expect(formatNotice(1440)).toBe("1 day");
    expect(formatNotice(4320)).toBe("3 days");
    expect(formatNotice(10080)).toBe("1 week");
    expect(formatNotice(90)).toBe("90 minutes");
  });

  it("formatCancellation", () => {
    expect(formatCancellation(0)).toBe("Any time before it starts");
    expect(formatCancellation(1)).toBe("1 hour before");
    expect(formatCancellation(24)).toBe("24 hours before");
    expect(formatCancellation(168)).toBe("1 week before");
  });
});

describe("currencies", () => {
  it("offers two-decimal currencies only", () => {
    for (const code of CURRENCIES) {
      const digits = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits;
      expect(digits, code).toBe(2);
    }
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("JPY")).toBe(false); // no cents
    expect(isSupportedCurrency("usd")).toBe(false);
  });

  it("labels codes with their names", () => {
    expect(currencyLabel("USD")).toBe("USD · US Dollar");
    expect(currencyLabel("PHP")).toBe("PHP · Philippine Peso");
  });
});

describe("businessSettingsSchema", () => {
  const valid = {
    name: "Lumen Studio",
    slug: "lumen-studio",
    timezone: "Asia/Manila",
    currency: "USD",
    brandColor: "#0f766e",
    logoUrl: null,
    openingHours: defaultWeek(),
    rules,
    roundStaffHours: false,
    confirmTimezone: false,
  };

  const week = (ranges: [string, string][]): DayHours[] =>
    WEEK_ORDER.map((weekday) => ({
      weekday,
      open: weekday === 2,
      ranges: ranges.map(([start, end]) => ({ start, end })),
    }));

  it("accepts a whole Business tab", () => {
    const result = businessSettingsSchema.parse(valid);
    expect(result.brandColor).toBe("#0F766E");
  });

  it("checks name, slug, timezone and currency", () => {
    for (const [field, value] of [
      ["name", "L"],
      ["slug", "Lumen Studio!"],
      ["slug", "app"], // reserved
      ["timezone", "Mars/Olympus"],
      ["currency", "JPY"],
      ["brandColor", "teal"],
    ] as const) {
      const result = businessSettingsSchema.safeParse({ ...valid, [field]: value });
      expect(result.success, `${field}: ${value}`).toBe(false);
      expect(result.error?.issues[0]?.path[0]).toBe(field);
    }
  });

  it("needs at least one open day", () => {
    const closed = WEEK_ORDER.map((weekday) => ({ weekday, open: false, ranges: [] }));
    expect(businessSettingsSchema.safeParse({ ...valid, openingHours: closed }).success).toBe(
      false,
    );
  });

  it("holds opening hours to the chosen grid", () => {
    const quarter = week([["09:15", "17:45"]]);
    expect(
      businessSettingsSchema.safeParse({
        ...valid,
        openingHours: quarter,
        rules: { ...rules, slotIntervalMin: 15 },
      }).success,
    ).toBe(true);

    const result = businessSettingsSchema.safeParse({ ...valid, openingHours: quarter });
    expect(result.success).toBe(false);
    // Tuesday is index 1, Monday first.
    expect(result.error?.issues[0]).toMatchObject({
      path: ["openingHours", 1, "ranges"],
      message: "Tuesday isn't on the 30-minute grid. Round it or pick other times.",
    });
  });

  it("puts rule errors under rules", () => {
    const result = businessSettingsSchema.safeParse({
      ...valid,
      rules: { ...rules, maxDaysAhead: 0 },
    });
    expect(result.error?.issues[0]?.path).toEqual(["rules", "maxDaysAhead"]);
  });
});
