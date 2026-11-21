import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { bookingUrl } from "@/lib/booking-link";
import { formatInZone } from "@/lib/dates";
import { prettyTime } from "@/lib/hours";
import { gridBounds, hoursToSpans, localSpan } from "@/lib/timeline";
import { greetingAt, todayRanges } from "@/lib/today";
import { getDashboardContext } from "@/server/auth/dashboard";
import { getToday } from "@/server/db/queries/today";

import { AiCard } from "./_today/ai-card";
import { EmptyToday, SetupChecklist } from "./_today/empty-today";
import { CopyLinkButton, NewBookingButton } from "./_today/header-actions";
import { StatCards } from "./_today/stat-cards";
import { TodayBoard } from "./_today/today-board";
import { TodaySkeleton } from "./_today/today-skeleton";

export const metadata: Metadata = { title: "Today" };

/**
 * Today (docs/design/owner-dashboard/1-today, mobile-today, empty-…-today,
 * loading-today): greeting, four stat cards, the day as a timeline per staff
 * member, and "Now and next" with quick actions. Staff see only their own
 * appointments and numbers.
 */
export default function TodayPage() {
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <Today />
    </Suspense>
  );
}

async function Today() {
  const { claims, business, role } = await getDashboardContext();
  const now = new Date();
  const zone = business.timezone;
  const ranges = todayRanges(now, zone);
  const data = await getToday(claims, { businessId: business.id, role, ranges, now });

  const owner = role === "owner";
  const brandNew = owner && !data.hasBookings;
  const date = formatInZone(now, zone, "EEEE, d MMMM");
  const opening = business.openingHours;
  const openToday = opening?.filter((o) => o.weekday === ranges.weekday) ?? [];
  const hours = !opening
    ? null
    : openToday.length === 0
      ? "Closed today"
      : `Open today ${openToday.map((o) => `${prettyTime(o.start)} – ${prettyTime(o.end)}`).join(", ")}`;
  const subtitle = brandNew
    ? `${business.name} · ${date}`
    : [date, hours].filter(Boolean).join(" · ");

  const url = bookingUrl(business.slug);
  const day = { dayStart: ranges.dayStart, dayEnd: ranges.dayEnd };
  const grid = gridBounds([
    ...hoursToSpans(openToday),
    ...data.staff.flatMap((s) => hoursToSpans(s.hours)),
    ...data.appointments.map((a) => localSpan(a, day, zone)),
  ]);
  const staffNames = new Map(data.staff.map((s) => [s.id, s]));

  return (
    <PageBody label="Today">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-heading sm:text-display">
            {brandNew ? "Welcome to Slotwren" : greetingAt(now, zone)}
          </h1>
          <p className="mt-1 text-body text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 gap-3">
          <CopyLinkButton url={url} className="hidden sm:inline-flex" />
          <NewBookingButton url={url} />
        </div>
      </div>

      <StatCards
        stats={data.stats}
        currency={business.currency}
        hasBookings={data.hasBookings}
        mine={!owner}
      />

      {data.appointments.length === 0 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <EmptyToday
            url={url}
            firstBooking={!data.hasBookings}
            owner={owner}
            className={data.setup ? undefined : "lg:col-span-2"}
          />
          {data.setup && <SetupChecklist setup={data.setup} url={url} />}
        </div>
      ) : (
        <TodayBoard
          zone={zone}
          now={now}
          dayStart={ranges.dayStart}
          dayEnd={ranges.dayEnd}
          grid={grid}
          staff={data.staff}
          appointments={data.appointments.map((a) => ({
            ...a,
            staffName: staffNames.get(a.staffId)?.name ?? "",
            staffColor: staffNames.get(a.staffId)?.color ?? "teal",
          }))}
          mine={!owner}
          aside={data.ai && <AiCard ai={data.ai} zone={zone} />}
        />
      )}
    </PageBody>
  );
}
