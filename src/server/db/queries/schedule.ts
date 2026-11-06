import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { DayHours } from "@/lib/hours";
import { toAvailabilityRows } from "@/lib/hours";
import type { TimeOffValues } from "@/lib/time-off";

import { type RlsClaims, withRls } from "../client";
import { availabilityRules, staff, timeOff } from "../schema";

/*
 * Weekly hours and time off for one staff member, as the signed-in member
 * (withRls), always filtered by business_id. RLS lets owners write anyone's
 * schedule and staff write only their own (docs/adr/0002-rls-strategy.md).
 */

/** Who a staff row belongs to (null user: no login). Null if not in this business. */
export async function findStaff(
  claims: RlsClaims,
  businessId: string,
  staffId: string,
): Promise<{ id: string; userId: string | null } | null> {
  const [row] = await withRls(claims, (tx) =>
    tx
      .select({ id: staff.id, userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.businessId, businessId))),
  );
  return row ?? null;
}

/** The staff member a time-off entry belongs to, or null. */
export async function findTimeOffStaff(
  claims: RlsClaims,
  businessId: string,
  timeOffId: string,
): Promise<{ staffId: string; userId: string | null } | null> {
  const [row] = await withRls(claims, (tx) =>
    tx
      .select({ staffId: timeOff.staffId, userId: staff.userId })
      .from(timeOff)
      .innerJoin(
        staff,
        and(eq(staff.id, timeOff.staffId), eq(staff.businessId, timeOff.businessId)),
      )
      .where(and(eq(timeOff.id, timeOffId), eq(timeOff.businessId, businessId))),
  );
  return row ?? null;
}

/** Replace a staff member's weekly hours. Throws 42501 if RLS refuses. */
export async function replaceStaffHours(
  claims: RlsClaims,
  businessId: string,
  staffId: string,
  days: DayHours[],
) {
  await withRls(claims, async (tx) => {
    await tx
      .delete(availabilityRules)
      .where(
        and(eq(availabilityRules.businessId, businessId), eq(availabilityRules.staffId, staffId)),
      );
    const rows = toAvailabilityRows(days);
    if (rows.length > 0) {
      await tx
        .insert(availabilityRules)
        .values(rows.map((row) => ({ ...row, businessId, staffId })));
    }
  });
}

export async function createTimeOff(
  claims: RlsClaims,
  businessId: string,
  staffId: string,
  values: TimeOffValues,
): Promise<string> {
  const id = randomUUID();
  await withRls(claims, (tx) => tx.insert(timeOff).values({ id, businessId, staffId, ...values }));
  return id;
}

/** False if RLS hid the row or it doesn't exist. */
export async function updateTimeOff(
  claims: RlsClaims,
  businessId: string,
  timeOffId: string,
  values: TimeOffValues,
): Promise<boolean> {
  const updated = await withRls(claims, (tx) =>
    tx
      .update(timeOff)
      .set(values)
      .where(and(eq(timeOff.id, timeOffId), eq(timeOff.businessId, businessId)))
      .returning({ id: timeOff.id }),
  );
  return updated.length > 0;
}

export async function deleteTimeOff(
  claims: RlsClaims,
  businessId: string,
  timeOffId: string,
): Promise<boolean> {
  const deleted = await withRls(claims, (tx) =>
    tx
      .delete(timeOff)
      .where(and(eq(timeOff.id, timeOffId), eq(timeOff.businessId, businessId)))
      .returning({ id: timeOff.id }),
  );
  return deleted.length > 0;
}
