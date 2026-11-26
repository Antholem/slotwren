import "server-only";

import { z } from "zod";

import { type EmbedSettings, embedSettingsSchema } from "@/lib/embed";
import { err, ok, type Result } from "@/lib/result";
import type { Actor } from "@/server/catalog/services";
import { pgError } from "@/server/db/errors";
import { updateEmbedSettings } from "@/server/db/queries/settings";

/*
 * Settings → Embed: save the website widget's options. Owners only (the role
 * check here, RLS on businesses again). Tested in tests/integration/embed.test.ts.
 */

const FORBIDDEN = "Only owners can change the website widget. Ask an owner to make this change.";

export async function saveEmbedSettings(
  actor: Actor,
  input: unknown,
): Promise<Result<EmbedSettings, "forbidden" | "invalid_input">> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  const parsed = embedSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors, formErrors } = z.flattenError(parsed.error);
    const first = formErrors[0] ?? (Object.values(fieldErrors).flat()[0] as string | undefined);
    return err("invalid_input", first ?? "Check the options.", fieldErrors);
  }
  try {
    const saved = await updateEmbedSettings(actor.claims, actor.businessId, parsed.data);
    return saved ? ok(parsed.data) : err("forbidden", FORBIDDEN);
  } catch (error) {
    if (pgError(error).code === "42501") return err("forbidden", FORBIDDEN);
    throw error;
  }
}
