import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * POST only, so a link or prefetch can't sign someone out. Auth cookies are
 * SameSite=Lax, so a cross-site form post arrives without a session.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  // 303 turns the POST into a GET of the sign-in page.
  return NextResponse.redirect(new URL("/sign-in?signed_out=1", request.url), 303);
}
