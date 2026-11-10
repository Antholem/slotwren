import { z } from "zod";

import { parsePriceToCents, priceExample } from "@/lib/money";

/*
 * The one service schema. The Services side sheet uses all of it; onboarding's
 * "Add your first service" picks the fields it asks for. Shared by the forms
 * and the server, which re-validates. The ranges match the services CHECKs.
 */

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

/** A price typed in the business's currency ("35,50" for EUR) → integer cents. */
export const priceField = (currency: string) =>
  z
    .string()
    .refine(
      (value) => parsePriceToCents(value, currency) !== null,
      `Enter a price like 35 or ${priceExample(currency)}.`,
    )
    .transform((value) => parsePriceToCents(value, currency)!);

const serviceFieldsFor = (currency: string) =>
  z.object({
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
    price: priceField(currency),
    bufferBeforeMin: minutes(120, "Use 5-minute steps."),
    bufferAfterMin: minutes(120, "Use 5-minute steps."),
  });

/** The Services side sheet, for a business's currency. */
export const serviceFormSchemaFor = (currency: string) =>
  serviceFieldsFor(currency).extend({
    active: z.boolean(),
    staffIds: z
      .array(z.uuid())
      .min(1, "Pick at least one person who offers this service.")
      .transform((ids) => [...new Set(ids)]),
  });

type ServiceFormSchema = ReturnType<typeof serviceFormSchemaFor>;
export type ServiceFormInput = z.input<ServiceFormSchema>;
export type ServiceFormValues = z.output<ServiceFormSchema>;

/**
 * Onboarding's first service: the same rules, fewer fields. It's bookable
 * online and offered by the owner; buffers before start at 0.
 */
export const firstServiceSchemaFor = (currency: string) =>
  serviceFieldsFor(currency).pick({
    name: true,
    description: true,
    durationMin: true,
    price: true,
    bufferAfterMin: true,
  });

type FirstServiceSchema = ReturnType<typeof firstServiceSchemaFor>;
export type FirstServiceInput = z.input<FirstServiceSchema>;
export type FirstServiceValues = z.output<FirstServiceSchema>;
