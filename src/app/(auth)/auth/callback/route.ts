import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { takeNextPath } from "@/server/auth/next-cookie";
import { createSupabaseServerClient } from "@/server/supabase/server";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup"]);

/**
 * Finishes every sign-in:
 * - `?token_hash=…&type=email` from the magic-link email (works even when
 *   the link is opened in a different browser from the one that asked for it)
 * - `?code=…` from Google OAuth (PKCE)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  const supabase = await createSupabaseServerClient();
  let failed = true;

  if (tokenHash && type && EMAIL_OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = !!error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = !!error;
  }

  if (failed) {
    // Expired or already-used link, cancelled Google consent, or a bad URL.
    const reason = params.get("error") === "access_denied" ? "cancelled" : "link";
    return NextResponse.redirect(new URL(`/sign-in?error=${reason}`, request.url));
  }

  return NextResponse.redirect(new URL(await takeNextPath(), request.url));
}
