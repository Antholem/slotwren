import "server-only";

import { z } from "zod";

import { err, ok, type Result } from "@/lib/result";
import { pgError } from "@/server/db/errors";
import { updateCustomerNotes } from "@/server/db/queries/customers";

import type { Actor } from "./services";

/*
 * Customers' private notes: owners write, staff read. The database enforces
 * the same (customers_guard_notes) and stamps who edited them and when.
 * Tested in tests/integration/customers.test.ts.
 */

const FORBIDDEN = "Only owners can edit private notes.";
const NOT_FOUND = "That customer no longer exists. Refresh to see the latest.";

export const customerNotesSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(2000, "Keep notes under 2,000 characters.")
    .transform((value) => value || null),
});

export async function saveCustomerNotes(
  actor: Actor,
  customerId: string,
  input: unknown,
): Promise<
  Result<
    { notes: string | null; notesUpdatedAt: Date | null },
    "forbidden" | "not_found" | "invalid_input"
  >
> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  if (!z.uuid().safeParse(customerId).success) return err("not_found", NOT_FOUND);
  const parsed = customerNotesSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Check the notes.";
    return err("invalid_input", message, { notes: [message] });
  }
  try {
    const saved = await updateCustomerNotes(
      actor.claims,
      actor.businessId,
      customerId,
      parsed.data.notes,
    );
    if (!saved) return err("not_found", NOT_FOUND);
    return ok({ notes: parsed.data.notes, notesUpdatedAt: saved.notesUpdatedAt });
  } catch (error) {
    if (pgError(error).code === "42501") return err("forbidden", FORBIDDEN);
    throw error;
  }
}
