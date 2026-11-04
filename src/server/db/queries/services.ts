import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, max } from "drizzle-orm";

import type { ServiceFormValues } from "@/lib/validation/services";

import { type RlsClaims, type Transaction, withRls } from "../client";
import { pgError } from "../errors";
import { bookings, services, staff, staffServices } from "../schema";

/*
 * Services for the dashboard, as the signed-in member (withRls) and always
 * filtered by business_id. RLS limits writes to owners.
 */

export type DashboardService = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  active: boolean;
  archivedAt: Date | null;
  staffIds: string[];
  bookingCount: number;
};

export type StaffOption = {
  id: string;
  name: string;
  title: string | null;
  color: "teal" | "violet" | "pink";
};

export async function listServices(
  claims: RlsClaims,
  businessId: string,
): Promise<DashboardService[]> {
  return withRls(claims, async (tx) => {
    const rows = await tx
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        durationMin: services.durationMin,
        priceCents: services.priceCents,
        bufferBeforeMin: services.bufferBeforeMin,
        bufferAfterMin: services.bufferAfterMin,
        active: services.active,
        archivedAt: services.archivedAt,
      })
      .from(services)
      .where(eq(services.businessId, businessId))
      .orderBy(asc(services.sortOrder), asc(services.createdAt));

    const assignments = await tx
      .select({ serviceId: staffServices.serviceId, staffId: staffServices.staffId })
      .from(staffServices)
      .where(eq(staffServices.businessId, businessId));

    const counts = await tx
      .select({ serviceId: bookings.serviceId, n: count() })
      .from(bookings)
      .where(eq(bookings.businessId, businessId))
      .groupBy(bookings.serviceId);
    const bookingCount = new Map(counts.map((c) => [c.serviceId, c.n]));

    return rows.map((row) => ({
      ...row,
      staffIds: assignments.filter((a) => a.serviceId === row.id).map((a) => a.staffId),
      bookingCount: bookingCount.get(row.id) ?? 0,
    }));
  });
}

/** Active staff, for "Staff who offer it". */
export async function listStaffOptions(
  claims: RlsClaims,
  businessId: string,
): Promise<StaffOption[]> {
  return withRls(claims, (tx) =>
    tx
      .select({ id: staff.id, name: staff.name, title: staff.title, color: staff.color })
      .from(staff)
      .where(and(eq(staff.businessId, businessId), eq(staff.active, true)))
      .orderBy(asc(staff.sortOrder), asc(staff.createdAt)),
  );
}

function columns({ price, staffIds: _staffIds, ...values }: ServiceFormValues) {
  return { ...values, priceCents: price };
}

/**
 * Point the service at exactly `staffIds`. Ids from another business fail the
 * composite foreign key (23503).
 */
async function assignStaff(
  tx: Transaction,
  businessId: string,
  serviceId: string,
  staffIds: string[],
) {
  await tx
    .delete(staffServices)
    .where(and(eq(staffServices.businessId, businessId), eq(staffServices.serviceId, serviceId)));
  await tx
    .insert(staffServices)
    .values(staffIds.map((staffId) => ({ businessId, serviceId, staffId })));
}

export async function createService(
  claims: RlsClaims,
  businessId: string,
  values: ServiceFormValues,
): Promise<string> {
  return withRls(claims, async (tx) => {
    const id = randomUUID();
    // New services go to the end of the list.
    const [last] = await tx
      .select({ sortOrder: max(services.sortOrder) })
      .from(services)
      .where(eq(services.businessId, businessId));
    await tx.insert(services).values({
      id,
      businessId,
      ...columns(values),
      sortOrder: (last?.sortOrder ?? -1) + 1,
    });
    await assignStaff(tx, businessId, id, values.staffIds);
    return id;
  });
}

/** False if the service doesn't exist in this business (or RLS hid it). */
export async function updateService(
  claims: RlsClaims,
  businessId: string,
  serviceId: string,
  values: ServiceFormValues,
): Promise<boolean> {
  return withRls(claims, async (tx) => {
    const updated = await tx
      .update(services)
      .set(columns(values))
      .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)))
      .returning({ id: services.id });
    if (updated.length === 0) return false;
    await assignStaff(tx, businessId, serviceId, values.staffIds);
    return true;
  });
}

/**
 * Delete a service nobody has booked; archive one with bookings so their
 * history keeps its service. Archived services leave the booking page.
 */
export async function removeService(
  claims: RlsClaims,
  businessId: string,
  serviceId: string,
): Promise<"deleted" | "archived" | "not_found"> {
  return withRls(claims, async (tx) => {
    const scope = and(eq(services.id, serviceId), eq(services.businessId, businessId));
    const [{ n }] = (await tx
      .select({ n: count() })
      .from(bookings)
      .where(and(eq(bookings.businessId, businessId), eq(bookings.serviceId, serviceId)))) as [
      { n: number },
    ];

    if (n === 0) {
      try {
        // Savepoint: if a booking arrived since the count, its foreign key
        // stops the delete and we archive instead.
        const deleted = await tx.transaction((sp) =>
          sp.delete(services).where(scope).returning({ id: services.id }),
        );
        return deleted.length > 0 ? "deleted" : "not_found";
      } catch (error) {
        if (pgError(error).code !== "23503") throw error;
      }
    }

    const archived = await tx
      .update(services)
      .set({ archivedAt: new Date(), active: false })
      .where(scope)
      .returning({ id: services.id });
    return archived.length > 0 ? "archived" : "not_found";
  });
}

/** Bring an archived service back, still hidden from the booking page until turned on. */
export async function restoreService(
  claims: RlsClaims,
  businessId: string,
  serviceId: string,
): Promise<boolean> {
  const restored = await withRls(claims, (tx) =>
    tx
      .update(services)
      .set({ archivedAt: null })
      .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)))
      .returning({ id: services.id }),
  );
  return restored.length > 0;
}

/** Whether every id is an active staff member of this business. */
export async function staffBelongToBusiness(
  claims: RlsClaims,
  businessId: string,
  staffIds: string[],
): Promise<boolean> {
  const rows = await withRls(claims, (tx) =>
    tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.businessId, businessId), inArray(staff.id, staffIds))),
  );
  return rows.length === new Set(staffIds).size;
}
