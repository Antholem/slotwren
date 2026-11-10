import { z } from "zod";

import { HEX_COLOR } from "@/lib/color";
import { weekSchema } from "@/lib/hours";
import { slugSchema } from "@/lib/slug";
import { isValidTimeZone } from "@/lib/timezones";

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

export const hoursSchema = z.object({ days: weekSchema });
export type HoursInput = z.input<typeof hoursSchema>;
