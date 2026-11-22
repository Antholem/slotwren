import "server-only";

import { and, eq, gte, lt, ne, type SQL, sql } from "drizzle-orm";

import { type RlsClaims, withRls } from "../client";
import { bookings, services, staff } from "../schema";

/*
 * Insights, as the signed-in member (withRls), filtered by business_id. Every
 * number is a SQL aggregate: per week (width_bucket over local-midnight
 * Mondays), per source, per service, and per local weekday × hour (AT TIME
 * ZONE, so DST is Postgres's job). Cancelled bookings never count; no-shows
 * count as bookings but earn nothing. Tested in tests/integration/insights.test.ts.
 */

export type WeekPoint = {
  bookings: number;
  revenueCents: number;
  noShows: number;
  /** Completed or no-show: the base for the no-show rate. */
  marked: number;
  ai: number;
};

export type Insights = {
  /** One per week, oldest first, aligned with the bounds passed in. */
  weeks: WeekPoint[];
  totals: WeekPoint;
  bySource: { source: "page" | "widget" | "ai" | "manual"; bookings: number }[];
  topServices: {
    id: string;
    name: string;
    priceCents: number;
    bookings: number;
    revenueCents: number;
  }[];
  /** Bookings starting in each local weekday (1 = Monday … 7 = Sunday) and hour. */
  heat: { weekday: number; hour: number; bookings: number }[];
  /** Any booking at all, ever (the empty state for a new business). */
  hasBookings: boolean;
};

const emptyPoint = (): WeekPoint => ({
  bookings: 0,
  revenueCents: 0,
  noShows: 0,
  marked: 0,
  ai: 0,
});

export async function getInsights(
  claims: RlsClaims,
  businessId: string,
  { bounds, zone, staffId }: { bounds: Date[]; zone: string; staffId: string | null },
): Promise<Insights> {
  const first = bounds[0]!;
  const last = bounds.at(-1)!;
  const inRange: SQL = and(
    eq(bookings.businessId, businessId),
    ne(bookings.status, "cancelled"),
    gte(bookings.startsAt, first),
    lt(bookings.startsAt, last),
    staffId ? eq(bookings.staffId, staffId) : undefined,
  )!;
  const thresholds = sql`array[${sql.join(
    bounds.map((b) => sql`${b.toISOString()}::timestamptz`),
    sql`, `,
  )}]`;
  const earns = sql`${bookings.status} <> 'no_show'`;

  return withRls(claims, async (tx) => {
    const weekly = await tx
      .select({
        week: sql<number>`width_bucket(${bookings.startsAt}, ${thresholds})::int`,
        bookings: sql<number>`count(*)::int`,
        revenueCents: sql<number>`(coalesce(sum(${bookings.priceCents}) filter (where ${earns}), 0))::int`,
        noShows: sql<number>`(count(*) filter (where ${bookings.status} = 'no_show'))::int`,
        marked: sql<number>`(count(*) filter (where ${bookings.status} in ('completed', 'no_show')))::int`,
        ai: sql<number>`(count(*) filter (where ${bookings.source} = 'ai'))::int`,
      })
      .from(bookings)
      .where(inRange)
      .groupBy(sql`1`);

    const bySource = await tx
      .select({ source: bookings.source, bookings: sql<number>`count(*)::int` })
      .from(bookings)
      .where(inRange)
      .groupBy(bookings.source)
      .orderBy(sql`2 desc`);

    const topServices = await tx
      .select({
        id: services.id,
        name: services.name,
        priceCents: services.priceCents,
        bookings: sql<number>`count(*)::int`,
        revenueCents: sql<number>`(coalesce(sum(${bookings.priceCents}) filter (where ${earns}), 0))::int`,
      })
      .from(bookings)
      .innerJoin(
        services,
        and(eq(services.id, bookings.serviceId), eq(services.businessId, bookings.businessId)),
      )
      .where(inRange)
      .groupBy(services.id)
      .orderBy(sql`4 desc`, services.name)
      .limit(6);

    const local = sql`(${bookings.startsAt} at time zone ${zone})`;
    const heat = await tx
      .select({
        weekday: sql<number>`extract(isodow from ${local})::int`,
        hour: sql<number>`extract(hour from ${local})::int`,
        bookings: sql<number>`count(*)::int`,
      })
      .from(bookings)
      .where(inRange)
      .groupBy(sql`1`, sql`2`);

    const [any] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, businessId),
          staffId ? eq(bookings.staffId, staffId) : undefined,
        ),
      )
      .limit(1);

    const weeks = Array.from({ length: bounds.length - 1 }, emptyPoint);
    for (const row of weekly) {
      const { week, ...point } = row;
      if (week >= 1 && week <= weeks.length) weeks[week - 1] = point;
    }
    const totals = weeks.reduce((sum, w) => {
      for (const key of Object.keys(sum) as (keyof WeekPoint)[]) sum[key] += w[key];
      return sum;
    }, emptyPoint());

    return { weeks, totals, bySource, topServices, heat, hasBookings: !!any };
  });
}

/** The signed-in member's staff row: staff see only their own numbers. */
export async function myStaffId(claims: RlsClaims, businessId: string): Promise<string | null> {
  const [row] = await withRls(claims, (tx) =>
    tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.businessId, businessId), eq(staff.userId, claims.sub))),
  );
  return row?.id ?? null;
}
