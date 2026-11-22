import { z } from "zod";

/*
 * The customer's details, as the booking page's form checks them and as
 * createBooking (src/server/booking/service.ts) checks them again.
 */

/**
 * Optional free text: blank becomes null. Accepts null too, so the form's own
 * output (already null) passes the server's check unchanged.
 */
export const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => value || null);

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80, "Keep your name under 80 characters."),
  email: z
    .string()
    .trim()
    .max(254, "That email address is too long.")
    .pipe(z.email("Enter a valid email address.")),
  phone: optionalText(40, "That phone number is too long."),
});

export const notesSchema = optionalText(500, "Keep notes under 500 characters.");

/** The details step's form. */
export const detailsFormSchema = customerSchema.extend({ notes: notesSchema });
export type DetailsFormInput = z.input<typeof detailsFormSchema>;
export type DetailsFormValues = z.output<typeof detailsFormSchema>;

/** The manual-booking sheet: the same rules, worded for the team. */
export const manualBookingFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the customer's name.")
    .max(80, "Keep the name under 80 characters."),
  email: z
    .string()
    .trim()
    .max(254, "That email address is too long.")
    .pipe(z.email("Enter the customer's email address.")),
  phone: optionalText(40, "That phone number is too long."),
  notes: notesSchema,
});
export type ManualBookingFormInput = z.input<typeof manualBookingFormSchema>;
export type ManualBookingFormValues = z.output<typeof manualBookingFormSchema>;
