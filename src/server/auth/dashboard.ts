import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { env } from "@/env";

import type { RlsClaims } from "@/server/db/client";
import { listMemberBusinesses, type MemberBusiness } from "@/server/db/queries/dashboard";

import { type CurrentUser, requireUser, rlsClaimsFor } from "./session";

/** Cookie remembering which business the dashboard shows (business switcher). */
export const CURRENT_BUSINESS_COOKIE = "sw_business";

export type DashboardContext = {
  user: CurrentUser;
  claims: RlsClaims;
  business: MemberBusiness;
  role: MemberBusiness["role"];
  businesses: MemberBusiness[];
};

/**
 * The signed-in member and the business the dashboard is showing: the one in
 * the switcher cookie if they still belong to it, else their first. Members
 * without a live business go to onboarding. Memoised per request, so the
 * layout and the page share one lookup. Reads cookies: call inside <Suspense>.
 */
export const getDashboardContext = cache(async (): Promise<DashboardContext> => {
  const user = await requireUser();
  const claims = rlsClaimsFor(user);
  const businesses = await listMemberBusinesses(claims);
  if (businesses.length === 0) redirect("/onboarding");

  const wanted = (await cookies()).get(CURRENT_BUSINESS_COOKIE)?.value;
  const business = businesses.find((b) => b.id === wanted) ?? businesses[0]!;
  return { user, claims, business, role: business.role, businesses };
});

/** The dashboard context for writes that only owners may make. */
export async function getOwnerContext() {
  const context = await getDashboardContext();
  return context.role === "owner" ? context : null;
}

/** Remember which business the dashboard shows (switcher, accepting an invite). */
export async function setCurrentBusiness(businessId: string) {
  (await cookies()).set(CURRENT_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
