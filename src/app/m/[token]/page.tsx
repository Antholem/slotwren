import { CircleCheck, Info, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { BookingTopBar, PoweredBy } from "@/components/booking/booking-layout";
import { LocalRange, LocalTime } from "@/components/booking/local-time";
import { ManageActions, ManageConfirm, ManageTimeStep } from "@/components/booking/manage";
import { Button } from "@/components/ui/button";
import { brandThemeCss } from "@/lib/brand-theme";
import { bookingHref, fromNow, manageHref, parseManageState } from "@/lib/booking-page";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import { hashToken } from "@/server/booking/tokens";
import { getBookingPage } from "@/server/db/queries/public/booking-page";
import { getBusinessContact, getManagedBooking } from "@/server/db/queries/public/manage";

import { cancelAction, moveAction } from "./actions";

/*
 * Manage booking (docs/design/booking-flow/6-manage-booking), from the link in
 * the confirmation email. The token is the key: looked up by its hash; a wrong
 * or retired one gets the branded 404 (the proxy checks first). Inside the
 * cancellation window the customer can reschedule (the booking page's own
 * time picker) or cancel; after it, the policy and how to reach the business.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function load(token: string) {
  if (!TOKEN.test(token)) return null;
  const booking = await getManagedBooking({ tokenHash: hashToken(token) });
  if (!booking) return null;
  const [data, contact] = await Promise.all([
    getBookingPage(booking.businessId),
    getBusinessContact({ businessId: booking.businessId }),
  ]);
  return data ? { booking, data, contact } : null;
}

export async function generateMetadata({ params }: PageProps<"/m/[token]">): Promise<Metadata> {
  const loaded = await load((await params).token);
  return {
    title: {
      absolute: loaded ? `Manage booking · ${loaded.data.business.name}` : "Not found",
    },
    // A bearer link: never indexed, never sent on as a referrer.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default function ManagePage({ params, searchParams }: PageProps<"/m/[token]">) {
  return (
    <Suspense fallback={<ManageSkeleton />}>
      <Manage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const AVATAR = {
  teal: "bg-staff-teal-soft text-staff-teal-text",
  violet: "bg-staff-violet-soft text-staff-violet-text",
  pink: "bg-staff-pink-soft text-staff-pink-text",
} as const;

async function Manage({ params, searchParams }: PageProps<"/m/[token]">) {
  const { token } = await params;
  const loaded = await load(token);
  if (!loaded) notFound();
  const { booking, data, contact } = loaded;
  const { business } = data;
  const state = parseManageState(await searchParams);
  await connection(); // the window depends on now
  const now = new Date();

  const active = booking.status === "pending" || booking.status === "confirmed";
  const upcoming = active && booking.startsAt > now;
  const freeUntil = new Date(
    booking.startsAt.getTime() - business.cancellationWindowHours * 3_600_000,
  );
  const canChange = upcoming && now < freeUntil;
  const css = brandThemeCss(business.brandColor);
  const service = {
    id: booking.serviceId,
    name: booking.serviceName,
    durationMin: booking.durationMin,
    priceCents: booking.priceCents,
  };

  let body: React.ReactNode;
  let backHref = null;
  if (canChange && state.step === "time") {
    backHref = manageHref(token, {});
    body = (
      <ManageTimeStep
        token={token}
        slug={business.slug}
        business={business}
        service={service}
        staffName={booking.staffName}
        staffId={booking.staffId}
        date={state.date}
        taken={state.taken}
        now={now.toISOString()}
      />
    );
  } else if (canChange && state.step === "confirm" && state.start) {
    backHref = manageHref(token, { step: "time", date: state.date });
    const end = new Date(Date.parse(state.start) + booking.durationMin * 60_000).toISOString();
    body = (
      <div className="mx-auto w-full max-w-xl px-5 py-8">
        <ManageConfirm
          token={token}
          from={{ start: booking.startsAt.toISOString(), end: booking.endsAt.toISOString() }}
          to={{ start: state.start, end }}
          date={state.date}
          serviceName={booking.serviceName}
          staffName={booking.staffName}
          move={moveAction}
        />
      </div>
    );
  } else {
    body = (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-display">Manage booking</h1>
          <p className="text-body text-muted-foreground">
            Booking code <span className="font-mono text-foreground">{booking.code}</span>
          </p>
        </div>

        {state.done && (
          <p
            role="status"
            className="flex items-center gap-3 rounded-xl border border-success bg-card p-4 text-body"
          >
            <CircleCheck aria-hidden className="size-5 shrink-0 text-success-text" />
            {state.done === "moved"
              ? "Done: your booking has moved. We've emailed you the details and a new link."
              : "Your booking is cancelled. We've emailed you a receipt."}
          </p>
        )}

        <section
          aria-label="Your booking"
          className="flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-xs"
        >
          <div className="flex items-start justify-between gap-4 border-b pb-5">
            <div className="flex flex-col gap-1">
              <LocalRange
                start={booking.startsAt}
                end={booking.endsAt}
                className={cn("text-heading", !active && "line-through")}
              />
              <LocalTime
                value={booking.startsAt}
                pattern="EEEE, d MMMM"
                placeholder="…"
                className="text-body text-muted-foreground"
              />
            </div>
            <Status status={booking.status} past={active && !upcoming} />
          </div>
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full text-label",
                AVATAR[booking.staffColor],
              )}
            >
              {booking.staffName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <p className="text-title">
                {booking.serviceName} with {booking.staffName}
              </p>
              <p className="font-mono text-body text-muted-foreground tabular-nums">
                {booking.durationMin} min · {formatPrice(booking.priceCents, business.currency)}
              </p>
            </div>
          </div>
          <dl className="flex flex-col gap-3 text-body">
            {business.address && <Row label="Where" value={business.address} />}
            <Row label="Name" value={booking.customerName} />
            <Row
              label="Notes"
              value={booking.customerNotes ?? <span className="text-muted-foreground">None</span>}
            />
          </dl>
        </section>

        {canChange ? (
          <>
            <p className="flex gap-3 rounded-xl bg-info-soft p-4 text-body text-info-text">
              <Info aria-hidden className="mt-0.5 size-5 shrink-0" />
              <span>
                <strong className="font-medium">
                  Free cancellation until{" "}
                  <LocalTime value={freeUntil} pattern="EEE d MMM, HH:mm" placeholder="…" />
                </strong>
                , {fromNow(freeUntil, now)}. After that, contact {business.name} to change your
                booking.
              </span>
            </p>
            <ManageActions token={token} cancel={cancelAction} businessName={business.name} />
          </>
        ) : upcoming ? (
          <ContactPanel
            title={
              business.cancellationWindowHours > 0
                ? `Online changes close ${business.cancellationWindowHours} h before the appointment`
                : "Online changes are closed"
            }
            businessName={business.name}
            contact={contact}
            address={business.address}
          />
        ) : (
          <Button asChild className="h-12 text-label">
            <Link href={bookingHref(business.slug, {})}>Book again</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="booking-theme flex flex-1 flex-col bg-background">
      {css && <style>{css}</style>}
      <BookingTopBar business={business} step="done" backHref={backHref} />
      <main className="flex flex-1 flex-col">
        {state.step !== "view" && canChange && <h1 className="sr-only">Reschedule your booking</h1>}
        {body}
      </main>
      <PoweredBy />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Status({ status, past }: { status: string; past: boolean }) {
  const [label, style] =
    status === "cancelled"
      ? ["Cancelled", "border text-muted-foreground"]
      : past || status === "completed"
        ? ["Past", "border text-muted-foreground"]
        : status === "no_show"
          ? ["No-show", "border text-muted-foreground"]
          : status === "pending"
            ? ["Pending", "bg-warning-soft text-warning-text"]
            : ["Confirmed", "bg-primary-tint text-primary-tint-foreground"];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-body-sm",
        style,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function ContactPanel({
  title,
  businessName,
  contact,
  address,
}: {
  title: string;
  businessName: string;
  contact: { businessPhone: string | null; businessEmail: string | null };
  address: string | null;
}) {
  const link = "inline-flex min-h-11 items-center gap-2 underline underline-offset-4";
  return (
    <section aria-labelledby="contact-title" className="flex flex-col gap-3 rounded-xl border p-5">
      <h2 id="contact-title" className="text-title">
        {title}
      </h2>
      <p className="text-body text-muted-foreground">
        To change or cancel now, get in touch with {businessName}.
      </p>
      <div className="flex flex-col text-body">
        {contact.businessPhone && (
          <a href={`tel:${contact.businessPhone.replace(/[^+\d]/g, "")}`} className={link}>
            <Phone aria-hidden className="size-4" />
            {contact.businessPhone}
          </a>
        )}
        {contact.businessEmail && (
          <a href={`mailto:${contact.businessEmail}`} className={link}>
            <Mail aria-hidden className="size-4" />
            {contact.businessEmail}
          </a>
        )}
        {!contact.businessPhone && !contact.businessEmail && address && (
          <p className="flex items-center gap-2">
            <MapPin aria-hidden className="size-4" />
            {address}
          </p>
        )}
      </div>
    </section>
  );
}

function ManageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading your booking"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-8"
    >
      <div className="h-10 w-64 animate-pulse rounded-lg bg-muted" />
      <div className="h-72 w-full animate-pulse rounded-2xl bg-muted" />
      <div className="h-14 w-full animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
