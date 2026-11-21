import "server-only";

import { z } from "zod";

import { err, ok, type Result } from "@/lib/result";
import { profileSchema } from "@/lib/validation/profile";
import type { RlsClaims } from "@/server/db/client";
import { updateProfileName } from "@/server/db/queries/dashboard";

/**
 * Save the signed-in user's display name (the account menu, "Edited by …").
 * Customers never see it: they see the name on the staff profile.
 */
export async function saveProfileName(
  claims: RlsClaims,
  input: unknown,
): Promise<Result<{ name: string }, "invalid_input" | "not_found">> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return err("invalid_input", fieldErrors.name?.[0] ?? "Enter your name.", fieldErrors);
  }
  const saved = await updateProfileName(claims, parsed.data.name);
  if (!saved) return err("not_found", "We couldn't find your profile. Sign out and in again.");
  return ok({ name: parsed.data.name });
}
