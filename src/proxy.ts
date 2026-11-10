import { type NextRequest, NextResponse } from "next/server";

import { SLUG_PATTERN } from "@/lib/slug";
import { getAccountStatus } from "@/server/db/queries/onboarding";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { redirectWithSession, updateSession } from "@/server/supabase/proxy";

/**
 * Refreshes the Supabase session and routes by auth state:
 * - /app/* and /onboarding/* need a signed-in user, else /sign-in?next=…
 * - /app/* also needs a live business, else /onboarding (which resumes the
 *   wizard where the owner left off)
 * - /sign-in while signed in goes to /app
 * - /b/<slug> (no session): unknown booking links get a real 404
 *
 * This is the first gate, not the only one: pages and server actions still
 * check the user themselves (see src/server/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/b/")) return bookingPageGate(request, pathname);

  const { response, claims } = await updateSession(request);

  if (pathname === "/sign-in") {
    return claims ? redirectWithSession(request, response, "/app") : response;
  }

  if (!claims) {
    const next = encodeURIComponent(pathname + search);
    return redirectWithSession(request, response, `/sign-in?next=${next}`);
  }

  if (isAppPath(pathname) && (await getAccountStatus(claims)) !== "ready") {
    return redirectWithSession(request, response, "/onboarding");
  }

  return response;
}

/**
 * Booking links: an unknown slug gets a real 404. The page streams, and a
 * notFound() after streaming starts can only answer 200 (Next docs: not-found),
 * so the check runs here, before rendering. No session: the page is public.
 */
async function bookingPageGate(request: NextRequest, pathname: string) {
  const slug = pathname.split("/")[2] ?? "";
  if (SLUG_PATTERN.test(slug) && (await getPublicBusinessBySlug(slug))) return NextResponse.next();
  // A route that doesn't exist renders the branded not-found page with a 404.
  return NextResponse.rewrite(new URL("/_booking-link-not-found", request.url));
}

function isAppPath(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export const config = {
  // Routes that read the session, plus /b (booking links: 404 check only).
  // Other public pages (/m, /embed) and static assets skip the proxy.
  matcher: ["/app/:path*", "/onboarding/:path*", "/sign-in", "/b/:path*"],
};
