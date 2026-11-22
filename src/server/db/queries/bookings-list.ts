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
  const where = whereFor(businessId, filters, context);
  return withRls(claims, async (tx) => {
    const rows = await tx
      .select({ ...columns, total: sql<number>`(count(*) over ())::int` })
      .from(bookings)
      .innerJoin(services, servicesJoin)
      .innerJoin(staff, staffJoin)
      .innerJoin(customers, customersJoin)
      .where(where)
      .orderBy(...orderFor(filters))
      .limit(context.limit)
      .offset(context.offset);
    if (rows.length > 0 || context.offset === 0) {
      return { rows: rows.map(({ total: _, ...row }) => row), total: rows[0]?.total ?? 0 };
    }
    // A page past the end has no row to carry the count: ask for it.
    const [counted] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(bookings)
      .innerJoin(customers, customersJoin)
      .where(where);
    return { rows: [], total: counted?.total ?? 0 };
  });
}

// Every name comes from a join (composite: the row and the booking share a business).
const servicesJoin = and(
  eq(services.id, bookings.serviceId),
  eq(services.businessId, bookings.businessId),
);
const staffJoin = and(eq(staff.id, bookings.staffId), eq(staff.businessId, bookings.businessId));
const customersJoin = and(
  eq(customers.id, bookings.customerId),
  eq(customers.businessId, bookings.businessId),
);

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
 * Every booking matching `filters`, oldest first, in batches (the CSV export
 * streams them). Each batch is one query in its own short transaction, picking
 * up after the last (starts_at, id) it saw: a booking added or cancelled
 * meanwhile can't shift the rest, so none is skipped or repeated, and no batch
 * counts the whole result.
 */
export async function* bookingBatches(
  claims: RlsClaims,
  businessId: string,
  filters: BookingFilters,
  context: { zone: string; now: Date; today: string },
  batchSize = 500,
): AsyncGenerator<BookingRow[]> {
  const where = whereFor(businessId, filters, context);
  let after: { startsAt: Date; id: string } | null = null;
  for (;;) {
    const cursor: { startsAt: Date; id: string } | null = after;
    const rows: BookingRow[] = await withRls(claims, (tx) =>
      tx
        .select(columns)
        .from(bookings)
        .innerJoin(services, servicesJoin)
        .innerJoin(staff, staffJoin)
        .innerJoin(customers, customersJoin)
        .where(
          and(
            where,
            cursor
              ? sql`(${bookings.startsAt}, ${bookings.id}) > (${cursor.startsAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(asc(bookings.startsAt), asc(bookings.id))
        .limit(batchSize),
    );
    if (rows.length > 0) yield rows;
    if (rows.length < batchSize) return;
    const last = rows.at(-1)!;
    after = { startsAt: last.startsAt, id: last.id };
  }
}
