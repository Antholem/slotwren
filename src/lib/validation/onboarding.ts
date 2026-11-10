import { z } from "zod";

import { HEX_COLOR } from "@/lib/color";
import { weekSchema } from "@/lib/hours";
import { slugSchema } from "@/lib/slug";
import { isValidTimeZone } from "@/lib/timezones";

import { priceField } from "./services";

/*
 * One schema per wizard step, shared by the client forms (React Hook Form) and
 * the server actions, which re-validate everything.
 */

export const ONBOARDING_STEPS = [
  { step: 1, path: "/onboarding/basics", label: "Business basics" },
  { step: 2, path: "/onboarding/brand", label: "Brand" },
  { step: 3, path: "/onboarding/service", label: "First service" },
  { step: 4, path: "/onboarding/hours", label: "Working hours" },
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]["step"];

export const basicsSchema = z.object({
  /** The owner: their staff card, "Mia invited you", the account menu. */
  ownerName: z.string().trim().min(1, "Enter your name.").max(60, "Keep it under 60 characters."),
  name: z
    .string()
    .trim()
    .min(2, "Enter your business name.")
    .max(80, "Keep it under 80 characters."),
  slug: slugSchema,
  timezone: z.string().refine(isValidTimeZone, "Pick a timezone from the list."),
});
export type BasicsInput = z.input<typeof basicsSchema>;

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIN_PX = 256;

export const brandSchema = z.object({
  brandColor: z
    .string()
    .trim()
    .regex(HEX_COLOR, "Use a hex colour like #0F766E.")
    .transform((hex) => hex.toUpperCase()),
  logoUrl: z.url().nullable(),
});
export type BrandInput = z.input<typeof brandSchema>;

export const DURATION_OPTIONS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240] as const;
export const BUFFER_OPTIONS = [0, 5, 10, 15, 30] as const;

export const serviceSchemaFor = (currency: string) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(2, "Name the service, like “Haircut”.")
      .max(80, "Keep it under 80 characters."),
    durationMin: z.coerce
      .number()
      .refine((n) => (DURATION_OPTIONS as readonly number[]).includes(n), "Pick a duration."),
    price: priceField(currency),
    bufferAfterMin: z.coerce
      .number()
      .refine((n) => (BUFFER_OPTIONS as readonly number[]).includes(n), "Pick a buffer."),
    description: z
      .string()
      .trim()
      .max(160, "Keep it to one line (160 characters).")
      .transform((value) => value || null),
  });
export type ServiceInput = z.input<ReturnType<typeof serviceSchemaFor>>;
export type ServiceValues = z.output<ReturnType<typeof serviceSchemaFor>>;

export const hoursSchema = z.object({ days: weekSchema });
export type HoursInput = z.input<typeof hoursSchema>;
