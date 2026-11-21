import { z } from "zod";

/** The profile dialog: the name the dashboard shows for you. */
export const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80, "Keep your name under 80 characters."),
});

export type ProfileValues = z.infer<typeof profileSchema>;
