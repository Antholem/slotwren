import { type NextRequest, NextResponse } from "next/server";

import { SLUG_PATTERN } from "@/lib/slug";
import { getAccountStatus } from "@/server/db/queries/onboarding";
import { getBookingConfirmation } from "@/server/db/queries/public/booking-page";
import { findBookingByManageToken } from "@/server/db/queries/public/bookings";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { hashToken } from "@/server/booking/tokens";
import { redirectWithSession, updateSession } from "@/server/supabase/proxy";

/**
 * Refreshes the Supabase session and routes by auth state:
 * - /app/* and /onboarding/* need a signed-in user, else /sign-in?next=…
 * - /app/* also needs a live business, else /onboarding (which resumes the
 *   wizard where the owner left off)
 * - /sign-in while signed in goes to /app
 * - /b/<slug>, /b/<slug>/booked/<id> and /m/<token> (no session): unknown
 *   links get a real 404
 *
 * This is the first gate, not the only one: pages and server actions still
 * check the user themselves (see src/server/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // The matchers include the bare paths (/b, /m): those get the 404 too.
  if (pathname === "/b" || pathname.startsWith("/b/")) return bookingPageGate(request, pathname);
  if (pathname === "/m" || pathname.startsWith("/m/")) return manageLinkGate(request, pathname);

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
  // /b/<slug>[/booked/<bookingId>[/event.ics]]
  const [, , slug = "", sub, bookingId = ""] = pathname.split("/");
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  const found =
    business &&
    (sub !== "booked" ||
      (UUID.test(bookingId) &&
        (await getBookingConfirmation({ businessId: business.id, bookingId }))));
  if (found) return NextResponse.next();
  // A route that doesn't exist renders the branded not-found page with a 404.
  return NextResponse.rewrite(new URL("/_booking-link-not-found", request.url));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Manage links: a wrong or retired token (a customer's reschedule rotates it)
 * gets the branded 404 before the page streams. Looked up by hash only.
 */
async function manageLinkGate(request: NextRequest, pathname: string) {
  const token = pathname.split("/")[2] ?? "";
  const found =
    MANAGE_TOKEN.test(token) && (await findBookingByManageToken({ tokenHash: hashToken(token) }));
  if (found) return NextResponse.next();
  return NextResponse.rewrite(new URL("/_manage-link-not-found", request.url));
}

const MANAGE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function isAppPath(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export const config = {
  // Routes that read the session, plus /b (booking links: 404 check only).
  // /m (manage links: 404 check only). Other public pages (/embed) and static
  // assets skip the proxy.
  matcher: ["/app/:path*", "/onboarding/:path*", "/sign-in", "/b/:path*", "/m/:path*"],
};
