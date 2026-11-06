import "server-only";

import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";

import type { OpeningRange, TimeRange } from "@/lib/hours";

import { type RlsClaims, withRls } from "../client";
import { availabilityRules, bookings, businesses, staff, timeOff } from "../schema";

/*
 * Settings → Business, as the signed-in member (withRls), always filtered by
 * business_id. Members read; only owners write (businesses_update policy and
 * column grants, docs/adr/0002-rls-strategy.md).
 */

export type BusinessSettingsRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  brandColor: string;
  logoUrl: string | null;
  openingHours: OpeningRange[] | null;
  minNoticeMin: number;
  maxDaysAhead: number;
  slotIntervalMin: number;
  cancellationWindowHours: number;
};

const settingsColumns = {
  id: businesses.id,
  name: businesses.name,
  slug: businesses.slug,
  timezone: businesses.timezone,
  currency: businesses.currency,
  brandColor: businesses.brandColor,
  logoUrl: businesses.logoUrl,
  openingHours: sql<OpeningRange[] | null>`${businesses.settings} -> 'openingHours'`,
  minNoticeMin: businesses.minNoticeMin,
  maxDaysAhead: businesses.maxDaysAhead,
  slotIntervalMin: businesses.slotIntervalMin,
  cancellationWindowHours: businesses.cancellationWindowHours,
};

export async function getBusinessSettings(
  claims: RlsClaims,
  businessId: string,
): Promise<BusinessSettingsRow | null> {
  const [row] = await withRls(claims, (tx) =>
    tx.select(settingsColumns).from(businesses).where(eq(businesses.id, businessId)),
  );
  return row ?? null;
}

export type StaffRange = TimeRange & {
  id: string;
  staffId: string;
  staffName: string;
  weekday: number;
};

/** Every staff member's weekly ranges, "HH:MM", for the grid check. */
export async function listStaffRanges(
  claims: RlsClaims,
  businessId: string,
): Promise<StaffRange[]> {
  const rows = await withRls(claims, (tx) =>
    tx
      .select({
        id: availabilityRules.id,
        staffId: availabilityRules.staffId,
        staffName: staff.name,
        weekday: availabilityRules.weekday,
        start: availabilityRules.startTime,
        end: availabilityRules.endTime,
      })
      .from(availabilityRules)
      .innerJoin(
        staff,
        and(eq(staff.id, availabilityRules.staffId), eq(staff.businessId, businessId)),
      )
      .where(eq(availabilityRules.businessId, businessId))
      .orderBy(asc(staff.createdAt), asc(availabilityRules.startTime)),
  );
  // Postgres returns "HH:MM:SS".
  return rows.map((row) => ({ ...row, start: row.start.slice(0, 5), end: row.end.slice(0, 5) }));
}

/** What a timezone change touches: upcoming bookings and time off. */
export async function countUpcoming(
  claims: RlsClaims,
  businessId: string,
  now: Date,
): Promise<{ bookings: number; timeOff: number }> {
  return withRls(claims, async (tx) => {
    const [booked] = await tx
      .select({ n: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, businessId),
          gt(bookings.endsAt, now),
          inArray(bookings.status, ["pending", "confirmed"]),
        ),
      );
    const [off] = await tx
      .select({ n: count() })
      .from(timeOff)
      .where(and(eq(timeOff.businessId, businessId), gt(timeOff.endsAt, now)));
    return { bookings: booked?.n ?? 0, timeOff: off?.n ?? 0 };
  });
}

export type SettingsUpdate = Omit<BusinessSettingsRow, "id" | "openingHours"> & {
  openingHours: OpeningRange[];
};

/**
 * Save the Business tab in one transaction:
 * - the business row (opening hours merged into settings),
 * - staff ranges rounded onto a new grid (`rounded`: new times, or null to delete),
 * - upcoming time off moved to the same local dates and times when the
 *   timezone changes (`moveTimeOff`). Bookings are never moved.
 * Returns false if RLS filtered the update out (not an owner). Throws 23505
 * if the slug was taken in the meantime.
 */
export async function updateBusinessSettings(
  claims: RlsClaims,
  businessId: string,
  { openingHours, ...values }: SettingsUpdate,
  {
    rounded,
    moveTimeOff,
    now,
  }: {
    rounded: { id: string; range: TimeRange | null }[];
    moveTimeOff: { from: string; to: string } | null;
    now: Date;
  },
): Promise<{ saved: boolean; movedTimeOff: number }> {
  return withRls(claims, async (tx) => {
    const updated = await tx
      .update(businesses)
      .set({
        ...values,
        settings: sql`${businesses.settings} || ${JSON.stringify({ openingHours })}::jsonb`,
      })
      .where(eq(businesses.id, businessId))
      .returning({ id: businesses.id });
    if (updated.length === 0) return { saved: false, movedTimeOff: 0 };

    for (const { id, range } of rounded) {
      const where = and(eq(availabilityRules.id, id), eq(availabilityRules.businessId, businessId));
      if (range) {
        await tx
          .update(availabilityRules)
          .set({ startTime: range.start, endTime: range.end })
          .where(where);
      } else {
        await tx.delete(availabilityRules).where(where);
      }
    }

    let movedTimeOff = 0;
    if (moveTimeOff) {
      // Same wall-clock times in the new zone: 09:00 Manila → 09:00 London.
      const local = (column: typeof timeOff.startsAt) =>
        sql`(${column} at time zone ${moveTimeOff.from}) at time zone ${moveTimeOff.to}`;
      const moved = await tx
        .update(timeOff)
        .set({ startsAt: local(timeOff.startsAt), endsAt: local(timeOff.endsAt) })
        .where(and(eq(timeOff.businessId, businessId), gt(timeOff.endsAt, now)))
        .returning({ id: timeOff.id });
      movedTimeOff = moved.length;
    }
    return { saved: true, movedTimeOff };
  });
}
