import { z } from "zod";

import { parsePriceToCents } from "@/lib/money";

/** Offered in the duration picker; any multiple of 5 up to 8 h is valid. */
export const DURATION_CHOICES = [15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240] as const;
export const BUFFER_CHOICES = [0, 5, 10, 15, 20, 30, 45, 60] as const;

const minutes = (max: number, message: string) =>
  z.coerce
    .number()
    .int()
    .min(0)
    .max(max)
    .refine((n) => n % 5 === 0, message);

/** The service side sheet. Shared by the form and the server, which re-validates. */
export const serviceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name the service, like “Haircut”.")
    .max(80, "Keep it under 80 characters."),
  description: z
    .string()
    .trim()
    .max(160, "Keep it to one line (160 characters).")
    .transform((value) => value || null),
  durationMin: minutes(480, "Use 5-minute steps.").refine((n) => n >= 5, "Pick a duration."),
  price: z
    .string()
    .refine((value) => parsePriceToCents(value) !== null, "Enter a price like 35 or 35.50.")
    .transform((value) => parsePriceToCents(value)!),
  bufferBeforeMin: minutes(120, "Use 5-minute steps."),
  bufferAfterMin: minutes(120, "Use 5-minute steps."),
  active: z.boolean(),
  staffIds: z
    .array(z.uuid())
    .min(1, "Pick at least one person who offers this service.")
    .transform((ids) => [...new Set(ids)]),
});

export type ServiceFormInput = z.input<typeof serviceFormSchema>;
export type ServiceFormValues = z.output<typeof serviceFormSchema>;
