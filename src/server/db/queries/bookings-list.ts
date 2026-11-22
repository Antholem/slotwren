import "server-only";

import { and, asc, desc, eq, gte, ilike, lt, or, type SQL, sql } from "drizzle-orm";

import { type BookingFilters, rangeDates } from "@/lib/bookings-filter";
import { zonedInstant } from "@/lib/time-off";
import type { AppointmentStatus } from "@/lib/today";

import { type RlsClaims, withRls } from "../client";
import { bookings, customers, services, staff } from "../schema";

/*
 * The Bookings table and its CSV export, as the signed-in member (withRls),
 * filtered by business_id. One query per page: the total rides along as a
 * window count, and every name comes from a join, never a query per row.
 */

export type BookingRow = {
  id: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  source: "page" | "widget" | "ai" | "manual";
  priceCents: number;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  serviceName: string;
  staffId: string;
  staffName: string;
  staffColor: "teal" | "violet" | "pink";
  notes: string | null;
};

const escapeLike = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The WHERE for a set of filters, with date ranges read in the business timezone. */
function whereFor(
  businessId: string,
  filters: BookingFilters,
  { zone, now, today }: { zone: string; now: Date; today: string },
): SQL | undefined {
  const range = rangeDates(filters, today);
  const term = filters.q.trim();
  return and(
    eq(bookings.businessId, businessId),
    filters.status ? eq(bookings.status, filters.status) : undefined,
    filters.staff ? eq(bookings.staffId, filters.staff) : undefined,
    filters.service ? eq(bookings.serviceId, filters.service) : undefined,
    filters.source ? eq(bookings.source, filters.source) : undefined,
    range.fromDate
      ? gte(bookings.startsAt, zonedInstant(range.fromDate, "00:00", zone))
      : undefined,
    range.toDate ? lt(bookings.startsAt, zonedInstant(range.toDate, "00:00", zone)) : undefined,
    range.fromNow ? gte(bookings.endsAt, now) : undefined,
    range.untilNow ? lt(bookings.startsAt, now) : undefined,
    term
      ? or(
          ilike(bookings.customerName, escapeLike(term)),
          ilike(customers.email, escapeLike(term)),
          ilike(bookings.code, escapeLike(term)),
        )
      : undefined,
  );
}

function orderFor(filters: BookingFilters): SQL[] {
  const dir = filters.dir === "desc" ? desc : asc;
  const by = {
    date: [dir(bookings.startsAt)],
    customer: [dir(sql`lower(${bookings.customerName})`), asc(bookings.startsAt)],
    price: [dir(bookings.priceCents), asc(bookings.startsAt)],
    status: [dir(bookings.status), asc(bookings.startsAt)],
  }[filters.sort];
  return [...by, asc(bookings.id)];
}

const columns = {
  id: bookings.id,
  code: bookings.code,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  status: bookings.status,
  source: bookings.source,
  priceCents: bookings.priceCents,
  customerId: bookings.customerId,
  customerName: bookings.customerName,
  customerEmail: customers.email,
  customerPhone: sql<string | null>`coalesce(${bookings.customerPhone}, ${customers.phone})`,
  serviceName: services.name,
  staffId: bookings.staffId,
  staffName: staff.name,
  staffColor: staff.color,
  notes: bookings.customerNotes,
};

/** One page of bookings matching `filters`, and how many match in all. */
export async function listBookings(
  claims: RlsClaims,
  businessId: string,
  filters: BookingFilters,
  context: { zone: string; now: Date; today: string; limit: number; offset: number },
): Promise<{ rows: BookingRow[]; total: number }> {
  const rows = await withRls(claims, (tx) =>
    tx
      .select({ ...columns, total: sql<number>`(count(*) over ())::int` })
      .from(bookings)
      .innerJoin(
        services,
        and(eq(services.id, bookings.serviceId), eq(services.businessId, bookings.businessId)),
      )
      .innerJoin(
        staff,
        and(eq(staff.id, bookings.staffId), eq(staff.businessId, bookings.businessId)),
      )
      .innerJoin(
        customers,
        and(eq(customers.id, bookings.customerId), eq(customers.businessId, bookings.businessId)),
      )
      .where(whereFor(businessId, filters, context))
      .orderBy(...orderFor(filters))
      .limit(context.limit)
      .offset(context.offset),
  );
  return {
    rows: rows.map(({ total: _, ...row }) => row),
    total: rows[0]?.total ?? 0,
  };
}

/** Does the business have any bookings at all? (The empty state.) */
export async function hasAnyBooking(claims: RlsClaims, businessId: string): Promise<boolean> {
  const [row] = await withRls(claims, (tx) =>
    tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.businessId, businessId))
      .limit(1),
  );
  return !!row;
}

/**
 * Every booking matching `filters`, in batches (the CSV export streams them).
 * Each batch is one query in its own short transaction.
 */
export async function* bookingBatches(
  claims: RlsClaims,
  businessId: string,
  filters: BookingFilters,
  context: { zone: string; now: Date; today: string },
  batchSize = 500,
): AsyncGenerator<BookingRow[]> {
  for (let offset = 0; ; offset += batchSize) {
    const { rows } = await listBookings(claims, businessId, filters, {
      ...context,
      limit: batchSize,
      offset,
    });
    if (rows.length > 0) yield rows;
    if (rows.length < batchSize) return;
  }
}
