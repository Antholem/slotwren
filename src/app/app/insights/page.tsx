import type { Metadata, Route } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { bookingUrl } from "@/lib/booking-link";
import { formatInZone } from "@/lib/dates";
import { INSIGHT_RANGES, type InsightRange, insightWeeks } from "@/lib/insights";
import { todayIn, zonedInstant } from "@/lib/time-off";
import { getDashboardContext } from "@/server/auth/dashboard";
import { getBookingOptions } from "@/server/db/queries/calendar";
import { getInsights, myStaffId } from "@/server/db/queries/insights";

import { InsightsView } from "./insights-view";

export const metadata: Metadata = { title: "Insights" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Insights (docs/design/owner-dashboard/5-insights): bookings per week,
 * revenue, no-show rate, busiest hours, sources and top services for the
 * range in the URL (?range=4w|12w|year&staff=<id>). Every number is a SQL
 * aggregate (src/server/db/queries/insights.ts). Staff see their own.
 */
export default function InsightsPage({ searchParams }: PageProps<"/app/insights">) {
  return (
    <Suspense fallback={<InsightsSkeleton />}>
      <Insights searchParams={searchParams} />
    </Suspense>
  );
}

async function Insights({ searchParams }: Pick<PageProps<"/app/insights">, "searchParams">) {
  const params = await searchParams;
  const { claims, business, role } = await getDashboardContext();
  const zone = business.timezone;
  const today = todayIn(zone, new Date());
  const range: InsightRange = (INSIGHT_RANGES as readonly string[]).includes(String(params.range))
    ? (params.range as InsightRange)
    : "12w";
  const owner = role === "owner";
  const [options, mine] = await Promise.all([
    getBookingOptions(claims, business.id),
    owner ? Promise.resolve(null) : myStaffId(claims, business.id),
  ]);
  const asked = typeof params.staff === "string" && UUID.test(params.staff) ? params.staff : null;
  // Staff always see their own numbers; owners may pick anyone.
  const staffId = owner
    ? options.staff.some((s) => s.id === asked)
      ? asked
      : null
    : (mine ?? "00000000-0000-0000-0000-000000000000");
  const weeks = insightWeeks(range, today, zone);
  const data = await getInsights(claims, business.id, { bounds: weeks.bounds, zone, staffId });

  const first = weeks.mondays[0]!;
  const lastDay = new Date(weeks.bounds.at(-1)!.getTime() - 1);
  const label = (date: Date, pattern: string) => formatInZone(date, zone, pattern);
  const period = `${label(zonedInstant(first, "12:00", zone), first.slice(0, 4) === today.slice(0, 4) ? "d MMM" : "d MMM yyyy")} – ${label(lastDay, "d MMM yyyy")}`;
  const who = !owner
    ? "your bookings"
    : staffId
      ? (options.staff.find((s) => s.id === staffId)?.name ?? "one staff member")
      : "all staff";

  const href = (next: { range?: InsightRange; staff?: string | null }) => {
    const q = new URLSearchParams();
    const r = next.range ?? range;
    const s = next.staff === undefined ? staffId : next.staff;
    if (r !== "12w") q.set("range", r);
    if (owner && s) q.set("staff", s);
    const qs = q.toString();
    return `/app/insights${qs ? `?${qs}` : ""}` as Route;
  };

  return (
    <InsightsView
      data={data}
      mondays={weeks.mondays}
      range={range}
      subtitle={`${period} · ${who} · all services`}
      currency={business.currency}
      openingHours={business.openingHours}
      owner={owner}
      staff={owner ? options.staff.map((s) => ({ id: s.id, name: s.name })) : []}
      staffId={owner ? staffId : null}
      rangeHrefs={
        Object.fromEntries(INSIGHT_RANGES.map((r) => [r, href({ range: r })])) as Record<
          InsightRange,
          Route
        >
      }
      staffHrefs={Object.fromEntries([
        ["", href({ staff: null })],
        ...options.staff.map((s) => [s.id, href({ staff: s.id })]),
      ])}
      bookingUrl={bookingUrl(business.slug)}
    />
  );
}

function InsightsSkeleton() {
  return (
    <PageBody label="Loading insights">
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="h-10 w-48 animate-pulse rounded-lg bg-muted" />
            <div className="h-5 w-80 max-w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="h-11 w-72 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl border bg-card" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="h-80 animate-pulse rounded-xl border bg-card" />
          <div className="h-80 animate-pulse rounded-xl border bg-card" />
        </div>
      </div>
    </PageBody>
  );
}
