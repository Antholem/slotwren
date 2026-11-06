import { z } from "zod";

/** Days an invite link stays valid. */
export const INVITE_TTL_DAYS = 7;

const serviceIds = z.array(z.uuid()).transform((ids) => [...new Set(ids)]);

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || null);

/** The staff side sheet (add or edit someone, no login involved). */
export const staffFormSchema = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(60, "Keep it under 60 characters."),
  title: optionalText(60, "Keep it under 60 characters."),
  active: z.boolean(),
  serviceIds,
});
export type StaffFormInput = z.input<typeof staffFormSchema>;
export type StaffFormValues = z.output<typeof staffFormSchema>;

const email = z
  .email("Enter an email address, like sam@example.com.")
  .trim()
  .toLowerCase()
  .max(254);

/** "Invite a team member": a new person who'll sign in. */
export const inviteFormSchema = z.object({
  email,
  name: optionalText(60, "Keep it under 60 characters."),
  serviceIds,
});
export type InviteFormInput = z.input<typeof inviteFormSchema>;
export type InviteFormValues = z.output<typeof inviteFormSchema>;

/** Invite someone already on the team (a staff row without a login). */
export const inviteExistingSchema = z.object({ email });
