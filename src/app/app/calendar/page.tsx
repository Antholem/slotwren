import type { Metadata, Route } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { weekDates } from "@/lib/calendar-grid";
import { formatInZone } from "@/lib/dates";
import { hoursToSpans, gridBounds, type Span } from "@/lib/timeline";
import { nextDate, todayIn, zonedInstant } from "@/lib/time-off";
import { weekdayOf } from "@/lib/today";
import { zoneClock } from "@/lib/zone-clock";
import { getDashboardContext } from "@/server/auth/dashboard";
import { getBookingOptions, getCalendar } from "@/server/db/queries/calendar";

import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Calendar" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar (docs/design/owner-dashboard/2-calendar-booking-drawer-open): day
 * and week views in the business timezone, one lane per staff member. The
 * view and date live in the URL (?view=day|week&date=YYYY-MM-DD) so Back,
 * reloads and shared links keep them.
 */
export default function CalendarPage({ searchParams }: PageProps<"/app/calendar">) {
  return (
    <Suspense fallback={<CalendarSkeleton />}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

async function Calendar({ searchParams }: Pick<PageProps<"/app/calendar">, "searchParams">) {
  const params = await searchParams;
  const { claims, business, role } = await getDashboardContext();
  const zone = business.timezone;
  const now = new Date();
  const today = todayIn(zone, now);
  const view = params.view === "day" ? "day" : "week";
  // No view in the URL: week here, and the view switches phones to day (it can see the width).
  const viewChosen = params.view === "day" || params.view === "week";
  const asked = typeof params.date === "string" && DATE.test(params.date) ? params.date : null;
  const date = asked && !Number.isNaN(Date.parse(`${asked}T12:00:00Z`)) ? asked : today;
  const dates = view === "week" ? weekDates(date) : [date];
  const from = zonedInstant(dates[0]!, "00:00", zone);
  const to = zonedInstant(nextDate(dates.at(-1)!), "00:00", zone);

  const [data, options] = await Promise.all([
    getCalendar(claims, business.id, { from, to }),
    getBookingOptions(claims, business.id),
  ]);

  // Hours worth showing: everyone's hours on these weekdays, and every booking.
  const clock = zoneClock(zone);
  const weekdays = new Set(dates.map(weekdayOf));
  const spans: Span[] = [
    ...data.staff.flatMap((s) => hoursToSpans(s.hours.filter((h) => weekdays.has(h.weekday)))),
    ...data.bookings
      .filter((b) => b.status !== "cancelled")
      .map((b) => {
        const start = clock.parts(Math.max(b.startsAt.getTime(), from.getTime()));
        const end = clock.parts(Math.min(b.endsAt.getTime(), to.getTime()));
        return {
          start: start.minutes,
          end: end.date !== start.date || end.minutes === 0 ? 24 * 60 : end.minutes,
        };
      }),
  ];
  const range = gridBounds(spans);

  const step = view === "week" ? 7 : 1;
  const href = (next: { view?: string; date?: string }) =>
    `/app/calendar?view=${next.view ?? view}&date=${next.date ?? date}` as Route;
  const first = dates[0]!;
  const last = dates.at(-1)!;
  const title =
    view === "day"
      ? formatInZone(from, zone, "EEEE, d MMMM yyyy")
      : first.slice(0, 7) === last.slice(0, 7)
        ? `${Number(first.slice(8))} – ${formatInZone(zonedInstant(last, "12:00", zone), zone, "d MMMM yyyy")}`
        : `${formatInZone(zonedInstant(first, "12:00", zone), zone, "d MMMM")} – ${formatInZone(zonedInstant(last, "12:00", zone), zone, "d MMMM yyyy")}`;

  return (
    <CalendarView
      view={view}
      viewChosen={viewChosen}
      dates={dates}
      today={today}
      zone={zone}
      now={now}
      range={range}
      intervalMin={business.slotIntervalMin}
      staff={data.staff}
      bookings={data.bookings}
      options={options}
      role={role}
      currency={business.currency}
      title={title}
      links={{
        prev: href({ date: nextDate(date, -step) }),
        next: href({ date: nextDate(date, step) }),
        today: href({ date: today }),
        day: href({ view: "day" }),
        week: href({ view: "week" }),
        dayOf: Object.fromEntries(dates.map((d) => [d, href({ view: "day", date: d })])),
      }}
    />
  );
}

function CalendarSkeleton() {
  return (
    <PageBody label="Loading calendar">
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-10 w-72 animate-pulse rounded-lg bg-muted" />
          <div className="h-11 w-40 animate-pulse rounded-lg bg-muted" />
          <div className="h-11 w-32 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="grid h-[36rem] grid-cols-[4rem_repeat(7,minmax(0,1fr))] gap-px overflow-hidden rounded-xl border bg-border">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-col gap-3 bg-card p-2">
              {i > 0 &&
                [0, 1, 2].map((j) => (
                  <div
                    key={j}
                    className="animate-pulse rounded-md bg-muted"
                    style={{ height: `${3 + ((i + j) % 3)}rem`, marginTop: `${(i * j) % 4}rem` }}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </PageBody>
  );
}
