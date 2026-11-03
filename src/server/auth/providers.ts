import "server-only";

import { cacheLife } from "next/cache";

import { env } from "@/env";

/**
 * Whether Supabase Auth has Google sign-in configured. Asks Auth itself
 * (GET /auth/v1/settings) rather than mirroring its config in our env, so the
 * button only shows when clicking it can actually work: locally that's when
 * [auth.external.google] is enabled with credentials, in production when the
 * provider is switched on in the Supabase dashboard.
 */
export async function isGoogleSignInEnabled(): Promise<boolean> {
  "use cache";
  cacheLife("minutes");

  try {
    const response = await fetch(new URL("/auth/v1/settings", env.NEXT_PUBLIC_SUPABASE_URL), {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const settings = (await response.json()) as { external?: { google?: boolean } };
    return settings.external?.google === true;
  } catch {
    // Auth unreachable: hide the button; the magic link shows its own error.
    return false;
  }
}
