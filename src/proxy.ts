import type { NextRequest } from "next/server";

import { hasAnyMembership } from "@/server/db/queries/memberships";
import { redirectWithSession, updateSession } from "@/server/supabase/proxy";

/**
 * Refreshes the Supabase session and routes by auth state:
 * - /app/* and /onboarding/* need a signed-in user, else /sign-in?next=…
 * - /app/* also needs a business, else /onboarding
 * - /sign-in while signed in goes to /app
 *
 * This is the first gate, not the only one: pages and server actions still
 * check the user themselves (see src/server/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  const { response, claims } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (pathname === "/sign-in") {
    return claims ? redirectWithSession(request, response, "/app") : response;
  }

  if (!claims) {
    const next = encodeURIComponent(pathname + search);
    return redirectWithSession(request, response, `/sign-in?next=${next}`);
  }

  if (isAppPath(pathname) && !(await hasAnyMembership(claims))) {
    return redirectWithSession(request, response, "/onboarding");
  }

  return response;
}

function isAppPath(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export const config = {
  // Only routes that read the session. Public pages (/b, /m, /embed) and
  // static assets skip the proxy entirely.
  matcher: ["/app/:path*", "/onboarding/:path*", "/sign-in"],
};
