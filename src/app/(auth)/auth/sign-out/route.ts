import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/safe-next";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * POST only, so a link or prefetch can't sign someone out. Auth cookies are
 * SameSite=Lax, so a cross-site form post arrives without a session.
 * An optional `next` field (e.g. an invite link) carries through to sign-in.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });

  const form = await request.formData().catch(() => null);
  const next = form?.get("next");
  const target = new URL("/sign-in?signed_out=1", request.url);
  if (typeof next === "string" && next) target.searchParams.set("next", safeNextPath(next));
  // 303 turns the POST into a GET of the sign-in page.
  return NextResponse.redirect(target, 303);
}
