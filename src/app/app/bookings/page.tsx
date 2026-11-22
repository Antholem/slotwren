import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/dashboard/page-header";
import { bookingUrl } from "@/lib/booking-link";
import { PAGE_SIZE, parseBookingFilters } from "@/lib/bookings-filter";
import { todayIn } from "@/lib/time-off";
import { getDashboardContext } from "@/server/auth/dashboard";
import { hasAnyBooking, listBookings } from "@/server/db/queries/bookings-list";
import { getBookingOptions } from "@/server/db/queries/calendar";

import { BookingsView } from "./bookings-view";

export const metadata: Metadata = { title: "Bookings" };

/**
 * Bookings (docs/design/owner-dashboard/3-bookings, empty-brand-new-business-
 * bookings): every booking with server-side filters, search, sorting and
 * pagination, all in the URL, plus bulk actions and CSV export of the filter.
 */
export default function BookingsPage({ searchParams }: PageProps<"/app/bookings">) {
  return (
    <Suspense fallback={<BookingsSkeleton />}>
      <Bookings searchParams={searchParams} />
    </Suspense>
  );
}

async function Bookings({ searchParams }: Pick<PageProps<"/app/bookings">, "searchParams">) {
  const params = await searchParams;
  const { claims, business, role } = await getDashboardContext();
  const filters = parseBookingFilters(params);
  const now = new Date();
  const zone = business.timezone;
  const today = todayIn(zone, now);
  const [page, options] = await Promise.all([
    listBookings(claims, business.id, filters, {
      zone,
      now,
      today,
      limit: PAGE_SIZE,
      offset: (filters.page - 1) * PAGE_SIZE,
    }),
    getBookingOptions(claims, business.id),
  ]);
  const empty = page.total === 0 && !(await hasAnyBooking(claims, business.id));
  const open = typeof params.booking === "string" ? params.booking : null;

  return (
    <BookingsView
      filters={filters}
      rows={page.rows}
      total={page.total}
      empty={empty}
      today={today}
      zone={zone}
      currency={business.currency}
      businessName={business.name}
      bookingUrl={bookingUrl(business.slug)}
      role={role}
      options={options}
      openBookingId={open}
    />
  );
}

function BookingsSkeleton() {
  return (
    <PageBody label="Loading bookings">
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="h-10 w-48 animate-pulse rounded-lg bg-muted" />
            <div className="h-5 w-72 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-11 w-72 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex flex-wrap gap-3">
          {[18, 10, 9, 9, 9].map((w, i) => (
            <div
              key={i}
              className="h-11 animate-pulse rounded-lg bg-muted"
              style={{ width: `${w}rem` }}
            />
          ))}
        </div>
        <div className="flex flex-col divide-y rounded-xl border bg-card">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-6 px-6 py-5">
              <div className="size-5 animate-pulse rounded bg-muted" />
              <div className="h-5 w-40 animate-pulse rounded bg-muted" />
              <div className="hidden h-5 w-32 animate-pulse rounded bg-muted md:block" />
              <div className="hidden h-5 w-48 animate-pulse rounded bg-muted md:block" />
              <div className="ml-auto h-6 w-24 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </PageBody>
  );
}
