import "server-only";

import { cookies } from "next/headers";

import { env } from "@/env";
import { safeNextPath } from "@/lib/safe-next";

/*
 * Where to go after sign-in. Kept in a short-lived cookie rather than the
 * redirect URL, so the magic-link email template can stay a fixed
 * {{ .SiteURL }}/auth/callback link. Opening the link on another device just
 * lands on /app.
 */
const NEXT_COOKIE = "sw_next";

export async function rememberNextPath(next: string | null | undefined) {
  const cookieStore = await cookies();
  cookieStore.set(NEXT_COOKIE, safeNextPath(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60, // matches the magic link's lifetime
  });
}

export async function takeNextPath(): Promise<string> {
  const cookieStore = await cookies();
  const next = cookieStore.get(NEXT_COOKIE)?.value;
  cookieStore.delete(NEXT_COOKIE);
  return safeNextPath(next);
}
