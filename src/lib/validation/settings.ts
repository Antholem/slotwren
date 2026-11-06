import { z } from "zod";

import { isOnGrid, weekSchemaFor, WEEKDAY_NAMES } from "@/lib/hours";
import { isSupportedCurrency } from "@/lib/money";

import { basicsSchema, brandSchema } from "./onboarding";

/*
 * Settings → Business, shared by the form (React Hook Form) and the server,
 * which re-validates everything. The ranges mirror the CHECK constraints on
 * businesses (schema.ts) and add upper limits the database doesn't need.
 */

/** Minimum notice choices, in minutes. Any whole multiple of 5 up to a week is valid. */
export const NOTICE_OPTIONS = [0, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 4320, 10080];
export const MAX_NOTICE_MIN = 7 * 24 * 60;

/** Free-cancellation window choices, in hours. Any whole hour up to two weeks is valid. */
export const CANCELLATION_OPTIONS = [0, 1, 2, 4, 6, 12, 24, 48, 72, 168];
export const MAX_CANCELLATION_HOURS = 14 * 24;

export const SLOT_INTERVALS = [15, 30] as const;
export const MAX_DAYS_AHEAD = 365;

/** "No minimum", "30 minutes", "2 hours", "1 day", "1 week". */
export function formatNotice(minutes: number): string {
  if (minutes === 0) return "No minimum";
  if (minutes % 10080 === 0) return plural(minutes / 10080, "week");
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}

/** "Any time before it starts", "24 hours before", "1 week before". */
export function formatCancellation(hours: number): string {
  if (hours === 0) return "Any time before it starts";
  if (hours % 168 === 0) return `${plural(hours / 168, "week")} before`;
  return `${plural(hours, "hour")} before`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

const wholeNumber = (message: string) =>
  z.coerce.number({ error: message }).refine(Number.isInteger, message);

export const bookingRulesSchema = z
  .object({
    minNoticeMin: wholeNumber("Pick a minimum notice.")
      .refine((n) => n >= 0 && n <= MAX_NOTICE_MIN, "Pick a notice of up to a week.")
      .refine((n) => n % 5 === 0, "Pick a minimum notice."),
    maxDaysAhead: wholeNumber("Enter a whole number of days.")
      .refine((n) => n >= 1, "Let customers book at least 1 day ahead.")
      .refine((n) => n <= MAX_DAYS_AHEAD, `Up to ${MAX_DAYS_AHEAD} days (a year).`),
    slotIntervalMin: z.coerce
      .number()
      .refine((n) => (SLOT_INTERVALS as readonly number[]).includes(n), "Pick 15 or 30 minutes."),
    cancellationWindowHours: wholeNumber("Pick a cancellation window.").refine(
      (n) => n >= 0 && n <= MAX_CANCELLATION_HOURS,
      "Pick a window of up to two weeks.",
    ),
  })
  .superRefine((rules, ctx) => {
    // Notice longer than the booking horizon leaves nothing to book.
    if (rules.minNoticeMin >= rules.maxDaysAhead * 1440) {
      ctx.addIssue({
        code: "custom",
        path: ["maxDaysAhead"],
        message: "Customers couldn't book anything: let them book further ahead than the notice.",
      });
    }
  });
export type BookingRulesInput = z.input<typeof bookingRulesSchema>;

export const businessSettingsSchema = z
  .object({
    name: basicsSchema.shape.name,
    slug: basicsSchema.shape.slug,
    timezone: basicsSchema.shape.timezone,
    currency: z.string().refine(isSupportedCurrency, "Pick a currency from the list."),
    brandColor: brandSchema.shape.brandColor,
    logoUrl: brandSchema.shape.logoUrl,
    // Checked against the chosen slot interval below.
    openingHours: weekSchemaFor({ intervalMin: 15 }),
    rules: bookingRulesSchema,
    /** Round staff hours that aren't on a new 30-minute grid. */
    roundStaffHours: z.boolean(),
    /** The owner has read what a timezone change does. */
    confirmTimezone: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const interval = Number(values.rules.slotIntervalMin);
    if (interval !== 30) return;
    values.openingHours.forEach((day, index) => {
      const off =
        day.open && day.ranges.find((r) => !isOnGrid(r.start, 30) || !isOnGrid(r.end, 30));
      if (off) {
        ctx.addIssue({
          code: "custom",
          path: ["openingHours", index, "ranges"],
          message: `${WEEKDAY_NAMES[day.weekday]} isn't on the 30-minute grid. Round it or pick other times.`,
        });
      }
    });
  });
export type BusinessSettingsInput = z.input<typeof businessSettingsSchema>;
export type BusinessSettingsValues = z.output<typeof businessSettingsSchema>;
