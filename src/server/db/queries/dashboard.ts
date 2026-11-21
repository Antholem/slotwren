import "server-only";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

import type { OpeningRange } from "@/lib/hours";

import { type RlsClaims, withRls } from "../client";
import { availabilityRules, businesses, memberships, profiles } from "../schema";

export type MemberBusiness = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string;
  timezone: string;
  currency: string;
  slotIntervalMin: number;
  /** settings.openingHours; null if the business never set them. */
  openingHours: OpeningRange[] | null;
  role: "owner" | "staff";
};

export type DashboardMember = {
  /** Live businesses this user belongs to, with their role, oldest first. */
  businesses: MemberBusiness[];
  /** profiles.full_name, trimmed; null if they never gave one. */
  profileName: string | null;
};

/**
 * The signed-in member: their live businesses and their profile name, in one
 * query (the name rides along on every membership row).
 */
export async function getDashboardMember(claims: RlsClaims): Promise<DashboardMember> {
  const rows = await withRls(claims, (tx) =>
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
        openingHours: sql<OpeningRange[] | null>`${businesses.settings} -> 'openingHours'`,
        role: memberships.role,
        profileName: profiles.fullName,
      })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .leftJoin(profiles, eq(profiles.id, memberships.userId))
      .where(and(eq(memberships.userId, claims.sub), isNotNull(businesses.onboardedAt)))
      .orderBy(asc(memberships.createdAt)),
  );
  return {
    businesses: rows.map(({ profileName: _, ...business }) => business),
    profileName: rows[0]?.profileName?.trim() || null,
  };
}

/** Set the signed-in user's own display name (RLS: own profile only). */
export async function updateProfileName(claims: RlsClaims, fullName: string): Promise<boolean> {
  const rows = await withRls(claims, (tx) =>
    tx
      .update(profiles)
      .set({ fullName })
      .where(eq(profiles.id, claims.sub))
      .returning({ id: profiles.id }),
  );
  return rows.length > 0;
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
