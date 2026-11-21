import { Check, CircleX, Download } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { BookingTopBar, PoweredBy } from "@/components/booking/booking-layout";
import { LocalRange, LocalTime } from "@/components/booking/local-time";
import { ManageLink } from "@/components/booking/manage-link";
import { Button } from "@/components/ui/button";
import { brandThemeCss } from "@/lib/brand-theme";
import { bookingHref } from "@/lib/booking-page";
import { googleCalendarUrl } from "@/lib/calendar";
import { formatPrice } from "@/lib/money";
import { loadConfirmation } from "@/server/booking/confirmation";
import { emailConfigured } from "@/server/email/send";

/*
 * After Confirm (docs/design/booking-flow/5-confirmed): the booking, its code
 * and Add to calendar. Found by the booking's unguessable ID; shows nothing
 * about the customer. Times on the customer's own clock.
 */

export async function generateMetadata({
  params,
}: PageProps<"/b/[slug]/booked/[bookingId]">): Promise<Metadata> {
  const { slug, bookingId } = await params;
  const confirmation = await loadConfirmation(slug, bookingId);
  return {
    title: {
      absolute: confirmation ? `Booked · ${confirmation.data.business.name}` : "Not found",
    },
    // A customer's booking: never in search results.
    robots: { index: false, follow: false },
  };
}

export default function BookedPage({
  params,
  searchParams,
}: PageProps<"/b/[slug]/booked/[bookingId]">) {
  return (
    <Suspense fallback={<BookedSkeleton />}>
      <Booked params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Booked({ params, searchParams }: PageProps<"/b/[slug]/booked/[bookingId]">) {
  const { slug, bookingId } = await params;
  // Arriving from the manage page right after cancelling there.
  const justCancelled = (await searchParams).cancelled === "1";
  const confirmation = await loadConfirmation(slug, bookingId);
  if (!confirmation) notFound();
  const { data, booking, event } = confirmation;
  const { business } = data;
  const css = brandThemeCss(business.brandColor);
  const cancelled = booking.status === "cancelled";
  const emailed = emailConfigured();
  const freeUntil = new Date(
    booking.startsAt.getTime() - business.cancellationWindowHours * 3_600_000,
  );
  await connection(); // whether free cancellation has passed depends on now
  const now = new Date();
  const icsHref = `/b/${slug}/booked/${booking.id}/event.ics` as Route;

  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    {
      label: "Service",
      value: (
        <>
          {booking.serviceName} ·{" "}
          <span className="font-mono tabular-nums">{booking.durationMin} min</span>
        </>
      ),
    },
    { label: "With", value: booking.staffName },
    ...(business.address ? [{ label: "Where", value: business.address }] : []),
    { label: "Price", value: formatPrice(booking.priceCents, business.currency), mono: true },
    { label: "Booking code", value: booking.code, mono: true },
  ];

  return (
    <div className="booking-theme flex flex-1 flex-col bg-background">
      {css && <style>{css}</style>}
      <BookingTopBar business={business} step="done" backHref={null} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-5 py-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            className={
              cancelled
                ? "flex size-20 items-center justify-center rounded-full bg-muted text-muted-foreground"
                : "flex size-20 items-center justify-center rounded-full bg-primary-tint text-primary-tint-foreground"
            }
          >
            {cancelled ? (
              <CircleX aria-hidden className="size-9" />
            ) : (
              <Check aria-hidden className="size-9" strokeWidth={2.5} />
            )}
          </span>
          <h1 className="text-display">{cancelled ? "Booking cancelled" : "You’re booked"}</h1>
          <p className="max-w-sm text-body text-muted-foreground">
            {cancelled
              ? `This booking with ${business.name} was cancelled.`
              : // Only claim the email when one really went (L3).
                emailed
                ? "We've emailed your confirmation, with a link to reschedule or cancel."
                : "Note your booking code. Reschedule or cancel from Manage booking below."}
          </p>
        </div>

        {cancelled && justCancelled && (
          <p
            role="status"
            className="flex items-center gap-3 rounded-xl border border-success bg-card p-4 text-body"
          >
            <Check aria-hidden className="size-5 shrink-0 text-success-text" />
            You&rsquo;ve cancelled your booking{emailed ? " and we’ve emailed you a receipt" : ""}.
            The time is free again in {business.name}&rsquo;s calendar.
          </p>
        )}

        <section aria-label="Booking details" className="rounded-2xl border bg-card p-6 shadow-xs">
          <div className="flex items-start justify-between gap-4 border-b pb-5">
            <div className="flex flex-col gap-1">
              <LocalRange
                start={booking.startsAt}
                end={booking.endsAt}
                className={cancelled ? "text-heading line-through" : "text-heading"}
              />
              <LocalTime
                value={booking.startsAt}
                pattern="EEEE, d MMMM"
                placeholder="…"
                className="text-body text-muted-foreground"
              />
            </div>
            <StatusBadge status={booking.status} />
          </div>
          <dl className="flex flex-col gap-3 pt-5 text-body">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className={row.mono ? "text-right font-mono tabular-nums" : "text-right"}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {cancelled ? (
          <Button asChild className="h-12 text-label">
            <Link href={bookingHref(slug, {})}>Book another time</Link>
          </Button>
        ) : (
          <>
            <section aria-labelledby="calendar-title" className="flex flex-col gap-3">
              <h2 id="calendar-title" className="text-label">
                Add to calendar
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <Button asChild variant="secondary" className="h-12 text-label">
                  <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
                    Google<span className="sr-only"> Calendar (opens in a new tab)</span>
                  </a>
                </Button>
                <Button asChild variant="secondary" className="h-12 text-label">
                  <a href={icsHref}>
                    Apple<span className="sr-only"> Calendar</span>
                  </a>
                </Button>
                <Button asChild variant="secondary" className="h-12 text-label">
                  <a href={icsHref} download={`${business.slug}-${booking.code}.ics`}>
                    <Download aria-hidden className="size-4" />
                    <span className="font-mono">.ics</span>
                    <span className="sr-only"> file</span>
                  </a>
                </Button>
              </div>
            </section>
            <ManageLink
              bookingId={booking.id}
              fallback={
                emailed
                  ? "To reschedule or cancel, use the Manage booking link in your confirmation email."
                  : `To reschedule or cancel, contact ${business.name}.`
              }
            />
            <p className="text-center text-body-sm text-muted-foreground">
              {freeUntil <= now ? (
                `It's within ${business.cancellationWindowHours} h of your appointment, so contact ${business.name} to change it.`
              ) : business.cancellationWindowHours > 0 ? (
                <>
                  Free cancellation until{" "}
                  <LocalTime value={freeUntil} pattern="EEE d MMM, " placeholder="…" />
                  <LocalTime
                    value={freeUntil}
                    pattern="HH:mm"
                    placeholder=""
                    className="font-mono tabular-nums"
                  />
                </>
              ) : (
                "Free cancellation until your appointment starts"
              )}
            </p>
          </>
        )}
      </main>
      <PoweredBy />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    confirmed: "bg-primary-tint text-primary-tint-foreground",
    pending: "bg-warning-soft text-warning-text",
    cancelled: "border text-muted-foreground",
    completed: "bg-success-soft text-success-text",
    no_show: "border text-muted-foreground",
  };
  const label: Record<string, string> = {
    confirmed: "Confirmed",
    pending: "Pending",
    cancelled: "Cancelled",
    completed: "Completed",
    no_show: "No-show",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-body-sm ${styles[status] ?? ""}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label[status] ?? status}
    </span>
  );
}

function BookedSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading your booking"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center gap-6 px-5 py-10"
    >
      <div className="size-20 animate-pulse rounded-full bg-muted" />
      <div className="h-10 w-56 animate-pulse rounded-lg bg-muted" />
      <div className="h-64 w-full animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}
