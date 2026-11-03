"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { env } from "@/env";
import { err, ok, type Result } from "@/lib/result";
import { slugSchema } from "@/lib/slug";
import { basicsSchema, brandSchema, hoursSchema, serviceSchema } from "@/lib/validation/onboarding";
import { requireUser, rlsClaimsFor } from "@/server/auth/session";
import { isUniqueViolation } from "@/server/db/errors";
import {
  getSetupState,
  isSlugAvailable,
  saveBasics,
  saveBrand,
  saveFirstService,
  saveHours,
} from "@/server/db/queries/onboarding";
import { createSupabaseServerClient } from "@/server/supabase/server";

/*
 * One action per wizard step. Each re-validates its input with the step's Zod
 * schema, resolves the business from the signed-in user (never from the
 * client), saves, and moves on. Expected failures come back as Result values.
 *
 * intent "later" ("Save and finish later") saves, then signs out.
 */

const intentSchema = z.enum(["continue", "later"]);
type Intent = z.infer<typeof intentSchema>;
type StepResult = Result<never, "invalid_input" | "slug_taken">;

async function signedIn() {
  const user = await requireUser();
  return rlsClaimsFor(user);
}

async function signOutWithProgressSaved(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in?saved=1");
}

/** "Save and finish later" when the current step can't be saved as is. */
export async function leaveSetup(): Promise<never> {
  return signOutWithProgressSaved();
}

function proceed(intent: Intent, next: Route): Promise<never> | never {
  if (intent === "later") return signOutWithProgressSaved();
  redirect(next);
}

function invalid(error: z.ZodError): StepResult {
  const { fieldErrors, formErrors } = z.flattenError(error);
  const first = formErrors[0] ?? Object.values(fieldErrors).flat()[0];
  return err(
    "invalid_input",
    (first as string | undefined) ?? "Check the highlighted fields.",
    fieldErrors as Record<string, string[]>,
  );
}

/** The business the wizard is working on, or back to step 1. */
async function requireSetupBusiness(claims: Awaited<ReturnType<typeof signedIn>>) {
  const state = await getSetupState(claims);
  if (!state) redirect("/onboarding/basics");
  return state.business;
}

// ── Step 1 ──────────────────────────────────────────────────────────────

export async function checkSlug(slug: string): Promise<Result<{ available: boolean }>> {
  const claims = await signedIn();
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return err("invalid_input", parsed.error.issues[0]!.message);
  const state = await getSetupState(claims);
  return ok({ available: await isSlugAvailable(claims, parsed.data, state?.business.id) });
}

const SLUG_TAKEN = "That link is taken. Try adding your area or a number.";

export async function saveBasicsAction(input: unknown, rawIntent: unknown): Promise<StepResult> {
  const claims = await signedIn();
  const intent = intentSchema.parse(rawIntent);
  const parsed = basicsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const state = await getSetupState(claims);
  if (!(await isSlugAvailable(claims, parsed.data.slug, state?.business.id))) {
    return err("slug_taken", SLUG_TAKEN, { slug: [SLUG_TAKEN] });
  }
  try {
    await saveBasics(claims, parsed.data);
  } catch (error) {
    // Someone else took it between the check and the insert.
    if (isUniqueViolation(error, "businesses_slug_unique")) {
      return err("slug_taken", SLUG_TAKEN, { slug: [SLUG_TAKEN] });
    }
    throw error;
  }
  return proceed(intent, "/onboarding/brand");
}

// ── Step 2 ──────────────────────────────────────────────────────────────

export async function saveBrandAction(input: unknown, rawIntent: unknown): Promise<StepResult> {
  const claims = await signedIn();
  const intent = intentSchema.parse(rawIntent);
  const business = await requireSetupBusiness(claims);
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  // Only logos uploaded to this business's folder in our bucket.
  const allowedPrefix = new URL(
    `/storage/v1/object/public/logos/${business.id}/`,
    env.NEXT_PUBLIC_SUPABASE_URL,
  ).toString();
  if (parsed.data.logoUrl && !parsed.data.logoUrl.startsWith(allowedPrefix)) {
    return err("invalid_input", "Upload the logo again.", { logoUrl: ["Upload the logo again."] });
  }

  await saveBrand(claims, business.id, parsed.data);
  return proceed(intent, "/onboarding/service");
}

// ── Step 3 ──────────────────────────────────────────────────────────────

export async function saveServiceAction(input: unknown, rawIntent: unknown): Promise<StepResult> {
  const claims = await signedIn();
  const intent = intentSchema.parse(rawIntent);
  const business = await requireSetupBusiness(claims);
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  await saveFirstService(claims, business.id, parsed.data);
  return proceed(intent, "/onboarding/hours");
}

// ── Step 4 ──────────────────────────────────────────────────────────────

export async function saveHoursAction(input: unknown, rawIntent: unknown): Promise<StepResult> {
  const claims = await signedIn();
  const intent = intentSchema.parse(rawIntent);
  const business = await requireSetupBusiness(claims);
  if (business.setupStep < 3) redirect("/onboarding");
  const parsed = hoursSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  // Saving for later keeps the business in setup; Finish puts it live.
  await saveHours(claims, business.id, parsed.data.days, { goLive: intent === "continue" });
  return proceed(intent, "/onboarding/live");
}
