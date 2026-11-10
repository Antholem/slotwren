import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { DayHours } from "@/lib/hours";
import { toAvailabilityRows } from "@/lib/hours";

import { type RlsClaims, type Transaction, withRls } from "../client";
import {
  availabilityRules,
  businesses,
  memberships,
  profiles,
  services,
  staff,
  staffColorFor,
  staffServices,
} from "../schema";

/*
 * Onboarding wizard data access. Everything runs as the signed-in user through
 * withRls and filters by business_id explicitly. The business being set up is
 * always resolved here from the user, never taken from the client.
 */

export type SetupBusiness = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  brandColor: string;
  logoUrl: string | null;
  setupStep: number;
  onboardedAt: Date | null;
};

export type SetupState = {
  business: SetupBusiness;
  service: {
    name: string;
    durationMin: number;
    priceCents: number;
    bufferAfterMin: number;
    description: string | null;
  } | null;
  hours: { weekday: number; startTime: string; endTime: string }[];
  /** The owner's name on this business (their staff row). */
  ownerName: string | null;
};

/** "none": no business yet · "setup": wizard unfinished · "ready": a live business. */
export type AccountStatus = "none" | "setup" | "ready";

export async function getAccountStatus(claims: RlsClaims): Promise<AccountStatus> {
  const rows = await withRls(claims, (tx) =>
    tx
      .select({ onboardedAt: businesses.onboardedAt })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(eq(memberships.userId, claims.sub)),
  );
  if (rows.length === 0) return "none";
  return rows.some((row) => row.onboardedAt !== null) ? "ready" : "setup";
}

const businessColumns = {
  id: businesses.id,
  name: businesses.name,
  slug: businesses.slug,
  timezone: businesses.timezone,
  currency: businesses.currency,
  brandColor: businesses.brandColor,
  logoUrl: businesses.logoUrl,
  setupStep: businesses.setupStep,
  onboardedAt: businesses.onboardedAt,
};

/**
 * The business this owner is setting up: their most recent unfinished one, or
 * (with `includeLive`) their most recent business of any kind.
 */
async function findSetupBusiness(
  tx: Transaction,
  userId: string,
  { includeLive }: { includeLive: boolean },
): Promise<SetupBusiness | null> {
  const [row] = await tx
    .select(businessColumns)
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.role, "owner"),
        includeLive ? undefined : isNull(businesses.onboardedAt),
      ),
    )
    .orderBy(sql`${businesses.onboardedAt} is not null`, desc(businesses.createdAt))
    .limit(1);
  return row ?? null;
}

/** The owner's own staff row in a business (working hours hang off it). */
async function findOwnerStaff(tx: Transaction, businessId: string, userId: string) {
  const [row] = await tx
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.businessId, businessId), eq(staff.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Wizard state for resuming: business, its first service and the owner's hours. */
export async function getSetupState(
  claims: RlsClaims,
  { includeLive = false }: { includeLive?: boolean } = {},
): Promise<SetupState | null> {
  return withRls(claims, async (tx) => {
    const business = await findSetupBusiness(tx, claims.sub, { includeLive });
    if (!business) return null;

    const [service] = await tx
      .select({
        name: services.name,
        durationMin: services.durationMin,
        priceCents: services.priceCents,
        bufferAfterMin: services.bufferAfterMin,
        description: services.description,
      })
      .from(services)
      .where(eq(services.businessId, business.id))
      .orderBy(asc(services.sortOrder), asc(services.createdAt))
      .limit(1);

    const ownerStaff = await findOwnerStaff(tx, business.id, claims.sub);
    const hours = ownerStaff
      ? await tx
          .select({
            weekday: availabilityRules.weekday,
            startTime: availabilityRules.startTime,
            endTime: availabilityRules.endTime,
          })
          .from(availabilityRules)
          .where(
            and(
              eq(availabilityRules.businessId, business.id),
              eq(availabilityRules.staffId, ownerStaff.id),
            ),
          )
      : [];

    const [ownerRow] = ownerStaff
      ? await tx
          .select({ name: staff.name })
          .from(staff)
          .where(and(eq(staff.id, ownerStaff.id), eq(staff.businessId, business.id)))
      : [];
    return { business, service: service ?? null, hours, ownerName: ownerRow?.name ?? null };
  });
}

/** Whether `slug` is free (or already belongs to `ownBusinessId`). */
export async function isSlugAvailable(
  claims: RlsClaims,
  slug: string,
  ownBusinessId?: string,
): Promise<boolean> {
  return withRls(claims, async (tx) => {
    if (ownBusinessId) {
      const [own] = await tx
        .select({ slug: businesses.slug })
        .from(businesses)
        .where(eq(businesses.id, ownBusinessId));
      if (own?.slug === slug) return true;
    }
    const [row] = await tx.execute<{ available: boolean }>(
      sql`select private.is_slug_available(${slug}) as available`,
    );
    return row?.available === true;
  });
}

type BasicsValues = { ownerName: string; name: string; slug: string; timezone: string };

/** The signed-in user's name from their profile (Google fills it in), or null. */
export async function getProfileName(claims: RlsClaims): Promise<string | null> {
  const [row] = await withRls(claims, (tx) =>
    tx.select({ fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, claims.sub)),
  );
  return row?.fullName?.trim() || null;
}

/**
 * Step 1. Creates the business (the creator becomes its owner by trigger) and
 * the owner's staff row, or updates the unfinished business on a revisit.
 * Throws Postgres 23505 if the slug was taken in the meantime.
 */
export async function saveBasics(
  claims: RlsClaims,
  { ownerName, ...values }: BasicsValues,
): Promise<string> {
  return withRls(claims, async (tx) => {
    await tx.update(profiles).set({ fullName: ownerName }).where(eq(profiles.id, claims.sub));

    const existing = await findSetupBusiness(tx, claims.sub, { includeLive: false });
    if (existing) {
      await tx.update(businesses).set(values).where(eq(businesses.id, existing.id));
      await tx
        .update(staff)
        .set({ name: ownerName })
        .where(and(eq(staff.businessId, existing.id), eq(staff.userId, claims.sub)));
      return existing.id;
    }

    // Generated here, inserted without RETURNING: see CLAUDE.md "Gotchas".
    const id = randomUUID();
    await tx.insert(businesses).values({ id, ...values, setupStep: 1 });

    await tx.insert(staff).values({
      businessId: id,
      userId: claims.sub,
      name: ownerName,
      email: claims.email ?? null,
      color: staffColorFor(0),
    });
    return id;
  });
}

/** "Mia Santos" from the profile, else "mia.santos@…" → "Mia Santos", else "Owner". */
export function staffNameFor(fullName: string | null | undefined, email: string | undefined) {
  if (fullName?.trim()) return fullName.trim();
  const local = email?.split("@")[0];
  if (!local) return "Owner";
  return local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

const advanceTo = (step: number) => sql`greatest(${businesses.setupStep}, ${step})`;

/** Step 2: brand colour and logo. */
export async function saveBrand(
  claims: RlsClaims,
  businessId: string,
  values: { brandColor: string; logoUrl: string | null },
) {
  await withRls(claims, (tx) =>
    tx
      .update(businesses)
      .set({ ...values, setupStep: advanceTo(2) })
      .where(eq(businesses.id, businessId)),
  );
}

type ServiceValues = {
  name: string;
  durationMin: number;
  price: number; // cents
  bufferAfterMin: number;
  description: string | null;
};

/** Step 3: create or update the first service and assign it to the owner. */
export async function saveFirstService(
  claims: RlsClaims,
  businessId: string,
  { price, ...values }: ServiceValues,
) {
  await withRls(claims, async (tx) => {
    const [first] = await tx
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, businessId))
      .orderBy(asc(services.sortOrder), asc(services.createdAt))
      .limit(1);

    let serviceId = first?.id;
    if (serviceId) {
      await tx
        .update(services)
        .set({ ...values, priceCents: price })
        .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)));
    } else {
      serviceId = randomUUID();
      await tx
        .insert(services)
        .values({ id: serviceId, businessId, ...values, priceCents: price, sortOrder: 0 });
    }

    const ownerStaff = await findOwnerStaff(tx, businessId, claims.sub);
    if (ownerStaff) {
      await tx
        .insert(staffServices)
        .values({ businessId, staffId: ownerStaff.id, serviceId })
        .onConflictDoNothing();
    }

    await tx
      .update(businesses)
      .set({ setupStep: advanceTo(3) })
      .where(eq(businesses.id, businessId));
  });
}

/**
 * Step 4: replace the owner's weekly hours and, unless saving for later, put
 * the business live.
 */
export async function saveHours(
  claims: RlsClaims,
  businessId: string,
  days: DayHours[],
  { goLive }: { goLive: boolean },
) {
  await withRls(claims, async (tx) => {
    const ownerStaff = await findOwnerStaff(tx, businessId, claims.sub);
    if (!ownerStaff) throw new Error("Owner has no staff row in this business");

    await tx
      .delete(availabilityRules)
      .where(
        and(
          eq(availabilityRules.businessId, businessId),
          eq(availabilityRules.staffId, ownerStaff.id),
        ),
      );
    const rows = toAvailabilityRows(days);
    if (rows.length > 0) {
      await tx
        .insert(availabilityRules)
        .values(rows.map((row) => ({ ...row, businessId, staffId: ownerStaff.id })));
    }

    // "When are you open?" is also the business's opening hours.
    const openingHours = rows.map((row) => ({
      weekday: row.weekday,
      start: row.startTime,
      end: row.endTime,
    }));
    await tx
      .update(businesses)
      .set({ settings: sql`${businesses.settings} || ${JSON.stringify({ openingHours })}::jsonb` })
      .where(eq(businesses.id, businessId));

    if (!goLive) return;
    await tx
      .update(businesses)
      .set({
        setupStep: 4,
        onboardedAt: sql`coalesce(${businesses.onboardedAt}, now())`,
      })
      .where(eq(businesses.id, businessId));
  });
}
