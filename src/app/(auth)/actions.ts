"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { env } from "@/env";
import { err, ok, type Result } from "@/lib/result";
import { rememberNextPath } from "@/server/auth/next-cookie";
import { createSupabaseServerClient } from "@/server/supabase/server";

const callbackUrl = () => new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL).toString();

const magicLinkSchema = z.object({
  email: z.email("Enter a valid email address, like you@example.com.").trim().toLowerCase(),
  next: z.string().optional(),
});

export type MagicLinkState = Result<{ email: string }, MagicLinkError> | null;
type MagicLinkError = "invalid_input" | "rate_limited" | "send_failed";

export async function sendMagicLink(
  _previous: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    return err("invalid_input", fieldErrors.email?.[0] ?? "Check your email address.", fieldErrors);
  }

  const { email, next } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true },
  });

  if (error) {
    if (error.status === 429) {
      return err("rate_limited", "Too many sign-in emails. Wait a minute, then try again.");
    }
    console.error("signInWithOtp failed", { status: error.status, code: error.code });
    return err("send_failed", "We couldn't send your sign-in link. Please try again.");
  }

  await rememberNextPath(next);
  return ok({ email });
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl() },
  });

  if (error || !data.url) {
    console.error("signInWithOAuth failed", { status: error?.status, code: error?.code });
    redirect("/sign-in?error=google");
  }

  const next = formData.get("next");
  await rememberNextPath(typeof next === "string" ? next : undefined);
  // Google's consent screen: an external URL, so typed routes can't check it.
  redirect(data.url as Route);
}
