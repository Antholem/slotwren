import { type NextRequest, NextResponse } from "next/server";

import { SLUG_PATTERN } from "@/lib/slug";
import type { RlsClaims } from "@/server/db/client";
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
 *   wizard where the owner left off). Checked once per user, then remembered
 *   in a cookie (see readyGate)
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

  if (isAppPath(pathname)) return readyGate(request, response, claims);
  // Onboarding (a first business, or another one): check again next time.
  if (request.cookies.has(READY_COOKIE)) response.cookies.delete(READY_COOKIE);
  return response;
}

/**
 * Remembers that this user has a live business, so the database is asked once
 * rather than on every /app request. Safe as a hint: it only skips a redirect.
 * Every dashboard page and action still loads the member's live businesses
 * through getDashboardContext(), which sends anyone without one to
 * /onboarding. Keyed to the user id, so another account on this browser is
 * checked afresh; visiting /onboarding clears it.
 */
const READY_COOKIE = "sw_ready";

async function readyGate(request: NextRequest, response: NextResponse, claims: RlsClaims) {
  if (request.cookies.get(READY_COOKIE)?.value === claims.sub) return response;
  if ((await getAccountStatus(claims)) !== "ready") {
    return redirectWithSession(request, response, "/onboarding");
  }
  response.cookies.set(READY_COOKIE, claims.sub, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
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
 * Manage links: a wrong, revoked or expired token (see manage_tokens)
 * gets the branded 404 before the page streams. Looked up by hash only.
 */
async function manageLinkGate(request: NextRequest, pathname: string) {
  const token = pathname.split("/")[2] ?? "";
  const found =
    MANAGE_TOKEN.test(token) &&
    (await findBookingByManageToken({ tokenHash: hashToken(token), now: new Date() }));
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
