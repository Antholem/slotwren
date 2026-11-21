import "server-only";

import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";

import type { AppointmentStatus, TodayRanges } from "@/lib/today";

import { type RlsClaims, type Transaction, withRls } from "../client";
import {
  aiConversations,
  availabilityRules,
  bookings,
  businesses,
  handoffRequests,
  services,
  staff,
  staffInvites,
  timeOff,
} from "../schema";

/*
 * The Today page (docs/design/owner-dashboard/1-today), as the signed-in
 * member (withRls), always filtered by business_id. Staff see only their own
 * appointments and numbers: everything below takes a `staffId` scope, set for
 * staff and null for owners. Stats are SQL aggregates over instants computed
 * in the business timezone (src/lib/today.ts). Tested in
 * tests/integration/today.test.ts.
 */

export type TodayStats = {
  today: { total: number; done: number; inProgress: number; toGo: number; noShow: number };
  week: { total: number; lastWeek: number; revenueCents: number };
  /** Last 30 days: no-shows out of appointments marked completed or no-show. */
  noShows: { count: number; marked: number };
};

export type TodayAppointment = {
  id: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  customerName: string;
  serviceName: string;
  staffId: string;
};

export type TodayStaff = {
  id: string;
  name: string;
  color: "teal" | "violet" | "pink";
  /** Working ranges for today's weekday, local "HH:MM". */
  hours: { start: string; end: string }[];
  /** Time off overlapping today. */
  timeOff: { startsAt: Date; endsAt: Date }[];
};

export type TodayAi = {
  conversations: number;
  bookings: number;
  openQuestions: number;
  latestQuestion: { name: string; email: string; message: string; createdAt: Date } | null;
};

export type SetupProgress = {
  openingHours: boolean;
  services: boolean;
  team: boolean;
  aiEnabled: boolean;
};

export type TodayData = {
  /** The signed-in member's staff row: the scope for staff, null for owners. */
  scopeStaffId: string | null;
  stats: TodayStats;
  appointments: TodayAppointment[];
  staff: TodayStaff[];
  /** False until the business (or, for staff, this person) has any booking at all. */
  hasBookings: boolean;
  /** Owners only. */
  ai: TodayAi | null;
  /** Owners of a business with no bookings yet: the "get ready" checklist. */
  setup: SetupProgress | null;
};

const iso = (date: Date) => date.toISOString();

/** Everything the Today page shows, in one transaction. */
export async function getToday(
  claims: RlsClaims,
  {
    businessId,
    role,
    ranges,
    now,
  }: { businessId: string; role: "owner" | "staff"; ranges: TodayRanges; now: Date },
): Promise<TodayData> {
  return withRls(claims, async (tx) => {
    let scopeStaffId: string | null = null;
    if (role === "staff") {
      const [me] = await tx
        .select({ id: staff.id })
        .from(staff)
        .where(and(eq(staff.businessId, businessId), eq(staff.userId, claims.sub)));
      // A staff login without a staff row sees nothing rather than everyone.
      scopeStaffId = me?.id ?? "00000000-0000-0000-0000-000000000000";
    }

    const stats = await readStats(tx, { businessId, scopeStaffId, ranges, now });
    const appointments = await listAppointments(tx, { businessId, scopeStaffId, ranges });
    const people = await listStaffForDay(tx, { businessId, scopeStaffId, ranges });
    const owner = role === "owner";
    return {
      scopeStaffId,
      stats: stats.stats,
      appointments,
      staff: people,
      hasBookings: stats.hasBookings,
      ai: owner ? await readAi(tx, { businessId, ranges }) : null,
      setup: owner && !stats.hasBookings ? await readSetup(tx, { businessId, now }) : null,
    };
  });
}

/**
 * The four stat cards in one pass over the bookings between last Monday and
 * the end of this week (or the last 30 days, whichever reaches further back).
 * Cancelled bookings never count; no-shows don't earn revenue.
 */
async function readStats(
  tx: Transaction,
  {
    businessId,
    scopeStaffId,
    ranges,
    now,
  }: { businessId: string; scopeStaffId: string | null; ranges: TodayRanges; now: Date },
): Promise<{ stats: TodayStats; hasBookings: boolean }> {
  const scope = scopeStaffId ? sql`and b.staff_id = ${scopeStaffId}` : sql``;
  const dayStart = iso(ranges.dayStart);
  const dayEnd = iso(ranges.dayEnd);
  const weekStart = iso(ranges.weekStart);
  const weekEnd = iso(ranges.weekEnd);
  const lastWeekStart = iso(ranges.lastWeekStart);
  const last30 = iso(ranges.last30Start);
  const at = iso(now);
  const from = iso(
    ranges.last30Start < ranges.lastWeekStart ? ranges.last30Start : ranges.lastWeekStart,
  );
  const to = iso(ranges.weekEnd > ranges.dayEnd ? ranges.weekEnd : ranges.dayEnd);

  const [row] = await tx.execute<{
    today_total: number;
    today_done: number;
    today_in_progress: number;
    today_to_go: number;
    today_no_show: number;
    week_total: number;
    last_week_total: number;
    week_revenue: number;
    no_shows: number;
    marked: number;
    has_bookings: boolean;
  }>(sql`
    with scoped as (
      select b.starts_at, b.ends_at, b.status, b.price_cents,
        (b.starts_at >= ${dayStart}::timestamptz and b.starts_at < ${dayEnd}::timestamptz) as is_today,
        (b.starts_at >= ${weekStart}::timestamptz and b.starts_at < ${weekEnd}::timestamptz) as is_week,
        (b.starts_at >= ${lastWeekStart}::timestamptz and b.starts_at < ${weekStart}::timestamptz) as is_last_week,
        (b.starts_at >= ${last30}::timestamptz and b.starts_at < ${at}::timestamptz) as is_last_30,
        b.status in ('pending', 'confirmed') as active
      from ${bookings} b
      where b.business_id = ${businessId}
        and b.status <> 'cancelled'
        and b.starts_at >= ${from}::timestamptz
        and b.starts_at < ${to}::timestamptz
        ${scope}
    )
    select
      count(*) filter (where is_today)::int as today_total,
      count(*) filter (where is_today and status = 'completed')::int as today_done,
      count(*) filter (where is_today and active
        and starts_at <= ${at}::timestamptz and ends_at > ${at}::timestamptz)::int as today_in_progress,
      count(*) filter (where is_today and active and starts_at > ${at}::timestamptz)::int as today_to_go,
      count(*) filter (where is_today and status = 'no_show')::int as today_no_show,
      count(*) filter (where is_week)::int as week_total,
      count(*) filter (where is_last_week)::int as last_week_total,
      coalesce(sum(price_cents) filter (where is_week and status <> 'no_show'), 0)::int as week_revenue,
      count(*) filter (where is_last_30 and status = 'no_show')::int as no_shows,
      count(*) filter (where is_last_30 and status in ('completed', 'no_show'))::int as marked,
      exists (
        select 1 from ${bookings} b where b.business_id = ${businessId} ${scope}
      ) as has_bookings
    from scoped
  `);
  const r = row!;
  return {
    stats: {
      today: {
        total: r.today_total,
        done: r.today_done,
        inProgress: r.today_in_progress,
        toGo: r.today_to_go,
        noShow: r.today_no_show,
      },
      week: { total: r.week_total, lastWeek: r.last_week_total, revenueCents: r.week_revenue },
      noShows: { count: r.no_shows, marked: r.marked },
    },
    hasBookings: r.has_bookings,
  };
}

/** Today's appointments (anything overlapping the local day), cancelled ones left out. */
async function listAppointments(
  tx: Transaction,
  {
    businessId,
    scopeStaffId,
    ranges,
  }: { businessId: string; scopeStaffId: string | null; ranges: TodayRanges },
): Promise<TodayAppointment[]> {
  return tx
    .select({
      id: bookings.id,
      code: bookings.code,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
      customerName: bookings.customerName,
      serviceName: services.name,
      staffId: bookings.staffId,
    })
    .from(bookings)
    .innerJoin(
      services,
      and(eq(services.id, bookings.serviceId), eq(services.businessId, bookings.businessId)),
    )
    .where(
      and(
        eq(bookings.businessId, businessId),
        ne(bookings.status, "cancelled"),
        lt(bookings.startsAt, ranges.dayEnd),
        gt(bookings.endsAt, ranges.dayStart),
        scopeStaffId ? eq(bookings.staffId, scopeStaffId) : undefined,
      ),
    )
    .orderBy(asc(bookings.startsAt), asc(bookings.id));
}

/**
 * Rows for the timeline: active staff (and anyone inactive who still has an
 * appointment today), with today's hours and time off.
 */
async function listStaffForDay(
  tx: Transaction,
  {
    businessId,
    scopeStaffId,
    ranges,
  }: { businessId: string; scopeStaffId: string | null; ranges: TodayRanges },
): Promise<TodayStaff[]> {
  const scoped = scopeStaffId ? eq(staff.id, scopeStaffId) : undefined;
  const people = await tx
    .select({ id: staff.id, name: staff.name, color: staff.color, active: staff.active })
    .from(staff)
    .where(and(eq(staff.businessId, businessId), scoped))
    .orderBy(asc(staff.sortOrder), asc(staff.createdAt));
  const rules = await tx
    .select({
      staffId: availabilityRules.staffId,
      start: availabilityRules.startTime,
      end: availabilityRules.endTime,
    })
    .from(availabilityRules)
    .where(
      and(
        eq(availabilityRules.businessId, businessId),
        eq(availabilityRules.weekday, ranges.weekday),
      ),
    )
    .orderBy(asc(availabilityRules.startTime));
  const away = await tx
    .select({ staffId: timeOff.staffId, startsAt: timeOff.startsAt, endsAt: timeOff.endsAt })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.businessId, businessId),
        lt(timeOff.startsAt, ranges.dayEnd),
        gt(timeOff.endsAt, ranges.dayStart),
      ),
    );
  const busy = new Set(
    (
      await tx
        .selectDistinct({ staffId: bookings.staffId })
        .from(bookings)
        .where(
          and(
            eq(bookings.businessId, businessId),
            ne(bookings.status, "cancelled"),
            lt(bookings.startsAt, ranges.dayEnd),
            gt(bookings.endsAt, ranges.dayStart),
          ),
        )
    ).map((b) => b.staffId),
  );

  return people
    .filter((person) => person.active || busy.has(person.id))
    .map((person) => ({
      id: person.id,
      name: person.name,
      color: person.color,
      hours: rules
        .filter((r) => r.staffId === person.id)
        .map((r) => ({ start: r.start.slice(0, 5), end: r.end.slice(0, 5) })),
      timeOff: away
        .filter((t) => t.staffId === person.id)
        .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    }));
}

/** The "AI receptionist today" card. */
async function readAi(
  tx: Transaction,
  { businessId, ranges }: { businessId: string; ranges: TodayRanges },
): Promise<TodayAi> {
  const [counts] = await tx.execute<{ conversations: number; bookings: number; open: number }>(
    sql`
      select
        (select count(*)::int from ${aiConversations}
          where business_id = ${businessId}
            and started_at >= ${iso(ranges.dayStart)}::timestamptz
            and started_at < ${iso(ranges.dayEnd)}::timestamptz) as conversations,
        (select count(*)::int from ${bookings}
          where business_id = ${businessId} and source = 'ai'
            and created_at >= ${iso(ranges.dayStart)}::timestamptz
            and created_at < ${iso(ranges.dayEnd)}::timestamptz) as bookings,
        (select count(*)::int from ${handoffRequests}
          where business_id = ${businessId} and status = 'open') as open
    `,
  );
  const [latest] = await tx
    .select({
      name: handoffRequests.name,
      email: handoffRequests.email,
      message: handoffRequests.message,
      createdAt: handoffRequests.createdAt,
    })
    .from(handoffRequests)
    .where(and(eq(handoffRequests.businessId, businessId), eq(handoffRequests.status, "open")))
    .orderBy(sql`${handoffRequests.createdAt} desc`)
    .limit(1);
  return {
    conversations: counts!.conversations,
    bookings: counts!.bookings,
    openQuestions: counts!.open,
    latestQuestion: latest ?? null,
  };
}

/** "Get ready for your first booking": what a new owner has done so far. */
async function readSetup(
  tx: Transaction,
  { businessId, now }: { businessId: string; now: Date },
): Promise<SetupProgress> {
  const [row] = await tx.execute<{
    opening_hours: boolean;
    ai_enabled: boolean;
    services: number;
    staff: number;
    invites: number;
  }>(sql`
    select
      coalesce(jsonb_array_length(${businesses.settings} -> 'openingHours'), 0) > 0 as opening_hours,
      ${businesses.aiEnabled} as ai_enabled,
      (select count(*)::int from ${services}
        where business_id = ${businessId} and archived_at is null) as services,
      (select count(*)::int from ${staff}
        where business_id = ${businessId} and active) as staff,
      (select count(*)::int from ${staffInvites}
        where business_id = ${businessId} and accepted_at is null
          and expires_at > ${iso(now)}::timestamptz) as invites
    from ${businesses}
    where ${businesses.id} = ${businessId}
  `);
  // Not visible to this member (RLS): nothing to show as done.
  const r = row ?? { opening_hours: false, ai_enabled: false, services: 0, staff: 0, invites: 0 };
  return {
    openingHours: r.opening_hours,
    services: r.services > 0,
    team: r.staff > 1 || r.invites > 0,
    aiEnabled: r.ai_enabled,
  };
}
