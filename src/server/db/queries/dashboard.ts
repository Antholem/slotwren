import "server-only";

import { and, asc, eq, isNotNull } from "drizzle-orm";

import { type RlsClaims, withRls } from "../client";
import { availabilityRules, businesses, memberships } from "../schema";

export type MemberBusiness = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string;
  timezone: string;
  currency: string;
  slotIntervalMin: number;
  role: "owner" | "staff";
};

/** Live businesses this user belongs to, with their role, oldest first. */
export async function listMemberBusinesses(claims: RlsClaims): Promise<MemberBusiness[]> {
  return withRls(claims, (tx) =>
    tx
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        logoUrl: businesses.logoUrl,
        brandColor: businesses.brandColor,
        timezone: businesses.timezone,
        currency: businesses.currency,
        slotIntervalMin: businesses.slotIntervalMin,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.userId, claims.sub), isNotNull(businesses.onboardedAt)))
      .orderBy(asc(memberships.createdAt)),
  );
}

/** Every staff member's weekly hours in a business (for "takes bookings Mon – Fri"). */
export async function listBusinessHours(claims: RlsClaims, businessId: string) {
  return withRls(claims, (tx) =>
    tx
      .select({
        weekday: availabilityRules.weekday,
        startTime: availabilityRules.startTime,
        endTime: availabilityRules.endTime,
      })
      .from(availabilityRules)
      .where(eq(availabilityRules.businessId, businessId)),
  );
}
