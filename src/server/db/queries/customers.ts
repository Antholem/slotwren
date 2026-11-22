import "server-only";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import type { AppointmentStatus } from "@/lib/today";

import { type RlsClaims, withRls } from "../client";
import { bookings, customers, handoffRequests, profiles, services, staff } from "../schema";

/*
 * Customers for the dashboard (list, profile, private notes) and the command
 * palette, as the signed-in member (withRls), filtered by business_id. Visit
 * counts and totals are SQL aggregates in the same query as the rows.
 *
 * A visit is a completed booking; total spent is what completed bookings cost
 * (the price snapshot on each booking).
 */

const escapeLike = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const CUSTOMER_SORTS = ["name", "last_visit", "spent", "visits"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export type CustomerListRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  visits: number;
  lastVisit: Date | null;
  totalSpentCents: number;
  upcoming: number;
};

export async function listCustomers(
  claims: RlsClaims,
  businessId: string,
  {
    q,
    sort,
    dir,
    limit,
    offset,
    now,
  }: {
    q: string;
    sort: CustomerSort;
    dir: "asc" | "desc";
    limit: number;
    offset: number;
    now: Date;
  },
): Promise<{ rows: CustomerListRow[]; total: number }> {
  const term = q.trim();
  const completed = sql`${bookings.status} = 'completed'`;
  const visits = sql<number>`(count(${bookings.id}) filter (where ${completed}))::int`;
  const lastVisit = sql<Date | null>`max(${bookings.startsAt}) filter (where ${completed})`;
  const spent = sql<number>`(coalesce(sum(${bookings.priceCents}) filter (where ${completed}), 0))::int`;
  const upcoming = sql<number>`(count(${bookings.id}) filter (where ${bookings.status} in ('pending', 'confirmed') and ${bookings.endsAt} > ${now.toISOString()}::timestamptz))::int`;
  const direction = dir === "desc" ? desc : asc;
  const order = {
    name: [direction(sql`lower(${customers.name})`)],
    last_visit: [sql`${lastVisit} ${sql.raw(dir === "desc" ? "desc" : "asc")} nulls last`],
    spent: [direction(spent)],
    visits: [direction(visits)],
  }[sort];

  const search = and(
    eq(customers.businessId, businessId),
    term
      ? or(ilike(customers.name, escapeLike(term)), ilike(customers.email, escapeLike(term)))
      : undefined,
  );
  return withRls(claims, async (tx) => {
    const rows = await tx
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        visits,
        lastVisit,
        totalSpentCents: spent,
        upcoming,
        total: sql<number>`(count(*) over ())::int`,
      })
      .from(customers)
      .leftJoin(
        bookings,
        and(eq(bookings.customerId, customers.id), eq(bookings.businessId, customers.businessId)),
      )
      .where(search)
      .groupBy(customers.id)
      .orderBy(...order, asc(customers.id))
      .limit(limit)
      .offset(offset);
    let total = rows[0]?.total ?? 0;
    if (rows.length === 0 && offset > 0) {
      // A page past the end has no row to carry the count: ask for it.
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(customers)
        .where(search);
      total = counted?.total ?? 0;
    }
    return {
      rows: rows.map(({ total: _, ...row }) => ({
        ...row,
        lastVisit: row.lastVisit ? new Date(row.lastVisit) : null,
      })),
      total,
    };
  });
}

export type CustomerBooking = {
  id: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  source: "page" | "widget" | "ai" | "manual";
  priceCents: number;
  serviceName: string;
  staffName: string;
  staffColor: "teal" | "violet" | "pink";
};

export type CustomerProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  notes: string | null;
  notesUpdatedAt: Date | null;
  /** Who last edited the notes (profile name), when known. */
  notesUpdatedBy: string | null;
  stats: { totalSpentCents: number; visits: number; noShows: number; upcoming: number };
  /** Newest first for history; upcoming soonest first. */
  upcoming: CustomerBooking[];
  history: CustomerBooking[];
  openQuestion: { message: string; createdAt: Date } | null;
};

/** One customer's profile in three queries, however many bookings they have. */
export async function getCustomerProfile(
  claims: RlsClaims,
  businessId: string,
  customerId: string,
  now: Date,
): Promise<CustomerProfile | null> {
  return withRls(claims, async (tx) => {
    const [customer] = await tx
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        createdAt: customers.createdAt,
        notes: customers.notes,
        notesUpdatedAt: customers.notesUpdatedAt,
        notesUpdatedBy: profiles.fullName,
      })
      .from(customers)
      .leftJoin(profiles, eq(profiles.id, customers.notesUpdatedBy))
      .where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)));
    if (!customer) return null;

    const all = await tx
      .select({
        id: bookings.id,
        code: bookings.code,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        status: bookings.status,
        source: bookings.source,
        priceCents: bookings.priceCents,
        serviceName: services.name,
        staffName: staff.name,
        staffColor: staff.color,
      })
      .from(bookings)
      .innerJoin(
        services,
        and(eq(services.id, bookings.serviceId), eq(services.businessId, bookings.businessId)),
      )
      .innerJoin(
        staff,
        and(eq(staff.id, bookings.staffId), eq(staff.businessId, bookings.businessId)),
      )
      .where(and(eq(bookings.businessId, businessId), eq(bookings.customerId, customerId)))
      .orderBy(desc(bookings.startsAt));

    const [question] = await tx
      .select({ message: handoffRequests.message, createdAt: handoffRequests.createdAt })
      .from(handoffRequests)
      .where(
        and(
          eq(handoffRequests.businessId, businessId),
          eq(handoffRequests.customerId, customerId),
          eq(handoffRequests.status, "open"),
        ),
      )
      .orderBy(desc(handoffRequests.createdAt))
      .limit(1);

    const active = (b: CustomerBooking) => b.status === "pending" || b.status === "confirmed";
    const upcoming = all.filter((b) => active(b) && b.endsAt > now).reverse();
    const history = all.filter((b) => !upcoming.includes(b));
    const completed = all.filter((b) => b.status === "completed");
    return {
      ...customer,
      stats: {
        totalSpentCents: completed.reduce((sum, b) => sum + b.priceCents, 0),
        visits: completed.length,
        noShows: all.filter((b) => b.status === "no_show").length,
        upcoming: upcoming.length,
      },
      upcoming,
      history,
      openQuestion: question ?? null,
    };
  });
}

/**
 * Save a customer's private notes. The database stamps who and when
 * (customers_guard_notes) and refuses anyone but an owner (42501). False if
 * the customer isn't this business's.
 */
export async function updateCustomerNotes(
  claims: RlsClaims,
  businessId: string,
  customerId: string,
  notes: string | null,
): Promise<{ notesUpdatedAt: Date | null } | null> {
  const rows = await withRls(claims, (tx) =>
    tx
      .update(customers)
      .set({ notes })
      .where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)))
      .returning({ notesUpdatedAt: customers.notesUpdatedAt }),
  );
  return rows[0] ?? null;
}

export type PaletteResults = {
  customers: { id: string; name: string; email: string }[];
  bookings: { id: string; code: string; customerName: string; startsAt: Date }[];
};

/** ⌘K: customers by name or email, bookings by code. Two small queries in one transaction. */
export async function paletteSearch(
  claims: RlsClaims,
  businessId: string,
  query: string,
): Promise<PaletteResults> {
  const term = query.trim();
  if (term.length < 2) return { customers: [], bookings: [] };
  return withRls(claims, async (tx) => {
    const people = await tx
      .select({ id: customers.id, name: customers.name, email: customers.email })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, businessId),
          or(ilike(customers.name, escapeLike(term)), ilike(customers.email, escapeLike(term))),
        ),
      )
      .orderBy(asc(sql`lower(${customers.name})`))
      .limit(6);
    const codes = await tx
      .select({
        id: bookings.id,
        code: bookings.code,
        customerName: bookings.customerName,
        startsAt: bookings.startsAt,
      })
      .from(bookings)
      .where(and(eq(bookings.businessId, businessId), ilike(bookings.code, escapeLike(term))))
      .orderBy(desc(bookings.startsAt))
      .limit(5);
    return { customers: people, bookings: codes };
  });
}
