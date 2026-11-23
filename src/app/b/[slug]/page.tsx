import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { BookingTopBar, BusinessIntro, PoweredBy } from "@/components/booking/booking-layout";
import { ChatPreview } from "@/components/chat/chat-preview";
import { env } from "@/env";
import { DetailsStep } from "@/components/booking/details-step";
import { ServiceStep } from "@/components/booking/service-step";
import { StepHeading } from "@/components/booking/step-heading";
import { StaffStep } from "@/components/booking/staff-step";
import { TimeStep } from "@/components/booking/time-step";
import { brandThemeCss } from "@/lib/brand-theme";
import {
  type BookingPageData,
  type BookingState,
  bookingHref,
  parseBookingState,
} from "@/lib/booking-page";
import { prettyTime } from "@/lib/hours";
import { SLUG_PATTERN } from "@/lib/slug";
import { zoneClock } from "@/lib/zone-clock";
import { getNextOpenings } from "@/server/booking/public-slots";
import { getBookingPage } from "@/server/db/queries/public/booking-page";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";

import { bookAction } from "./actions";

/*
 * The public booking page (docs/design/booking-flow): service → staff → date
 * and time → details, then /b/[slug]/booked/[id]. Every choice lives in the
 * URL (src/lib/booking-page.ts), so Back, reload and shared links work.
 * Bookings go through createBooking only (./actions.ts).
 */

async function load(slug: string) {
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  return business ? getBookingPage(business.id) : null;
}

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const data = await load((await params).slug);
  if (!data) return { title: { absolute: "Not found" }, robots: { index: false } };
  const { business, services } = data;
  const title = `${business.name} · Book online`;
  const offer = services
    .slice(0, 3)
    .map((s) => s.name)
    .join(", ");
  const description = [
    offer ? `Book ${offer}${services.length > 3 ? " and more" : ""} with ${business.name}.` : null,
    business.address,
    "Pick a time that suits you and get an instant confirmation.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    title: { absolute: title },
    description,
    openGraph: { title, description, type: "website", siteName: "Slotwren" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function BookingPage({ params, searchParams }: PageProps<"/b/[slug]">) {
  return (
    <Suspense fallback={<BookingSkeleton />}>
      <Booking params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** "9:00 – 18:00" from the business's opening hours on its local today, or null. */
function openToday(data: BookingPageData, now: Date): string | null {
  const clock = zoneClock(data.business.timezone);
  const today = clock.parts(now.getTime()).date;
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const ranges = data.business.openingHours.filter((o) => o.weekday === weekday);
  if (ranges.length === 0) return null;
  return ranges.map((r) => `${prettyTime(r.start)} – ${prettyTime(r.end)}`).join(", ");
}

/** Where the phone header's Back goes from each step. */
function backHref(slug: string, state: BookingState) {
  switch (state.step) {
    case "service":
      return null;
    case "staff":
      return bookingHref(slug, { serviceId: state.serviceId });
    case "time":
      return bookingHref(slug, { ...state, step: "staff", start: null, taken: null });
    case "details":
      return bookingHref(slug, { ...state, step: "time", taken: null });
  }
}

async function Booking({ params, searchParams }: PageProps<"/b/[slug]">) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  // The test chat box (steps 4.1–4.2) behind a flag; the real chat UI is step 4.4.
  const chatPreview =
    env.AI_CHAT_PREVIEW === "1" && (await getPublicBusinessBySlug(slug))?.aiEnabled === true;
  const state = parseBookingState(await searchParams, data);
  await connection(); // "now" is per request
  const now = new Date();

  const { business } = data;
  const service = data.services.find((s) => s.id === state.serviceId) ?? null;
  const team = service ? data.staff.filter((p) => p.serviceIds.includes(service.id)) : [];
  const withWhom = data.staff.find((p) => p.id === state.staffId)?.name ?? "Anyone available";
  const css = brandThemeCss(business.brandColor);
  const today = openToday(data, now);

  let step: React.ReactNode;
  if (!service || state.step === "service") {
    step = (
      <ServiceStep
        slug={slug}
        services={data.services}
        currency={business.currency}
        state={state}
      />
    );
  } else if (state.step === "staff") {
    const nextOpenings = await getNextOpenings({
      businessId: business.id,
      serviceId: service.id,
      staffIds: team.map((p) => p.id),
      timezone: business.timezone,
      now,
    });
    step = (
      <StaffStep
        slug={slug}
        service={service}
        staff={team}
        currency={business.currency}
        nextOpenings={nextOpenings}
        now={now.toISOString()}
        state={state}
      />
    );
  } else if (state.step === "time" || !state.start) {
    step = (
      <TimeStep
        slug={slug}
        business={business}
        service={service}
        withWhom={withWhom}
        canChooseStaff={team.length > 1 || state.staffId !== "any"}
        state={state}
        now={now.toISOString()}
      />
    );
  } else {
    step = (
      <DetailsStep
        slug={slug}
        business={business}
        service={service}
        withWhom={withWhom}
        state={{ ...state, start: state.start }}
        book={bookAction}
      />
    );
  }

  return (
    <div className="booking-theme flex flex-1 flex-col bg-background pb-20 lg:pb-0">
      {/* Brand colours as primary tokens; every value is a #RRGGBB we built. */}
      {css && <style>{css}</style>}
      <StepHeading>{`${STEP_HEADINGS[state.step]} · Book with ${business.name}`}</StepHeading>
      {/* Keep focused fields clear of the fixed Continue bar on phones (WCAG 2.4.11). */}
      <style>{"@media (width < 64rem) { html { scroll-padding-bottom: 6rem; } }"}</style>
      <BookingTopBar
        business={business}
        step={state.step}
        backHref={backHref(slug, state)}
        openToday={state.step === "service" ? today : undefined}
        stepHrefs={{
          service: bookingHref(slug, { serviceId: state.serviceId }),
          staff: bookingHref(slug, { ...state, step: "staff", start: null, taken: null }),
          time: bookingHref(slug, { ...state, step: "time", taken: null }),
        }}
      />
      {state.step === "service" && <BusinessIntro business={business} openToday={today} />}
      <main className="flex flex-1 flex-col">{step}</main>
      {chatPreview && <ChatPreview slug={slug} businessName={business.name} />}
      <PoweredBy />
    </div>
  );
}

const STEP_HEADINGS: Record<BookingState["step"], string> = {
  service: "Choose a service",
  staff: "Choose who you'd like",
  time: "Pick a date and time",
  details: "Your details",
};

function BookingSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading booking page"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-8"
    >
      <div className="size-14 animate-pulse rounded-2xl bg-muted" />
      <div className="h-10 w-64 animate-pulse rounded-lg bg-muted" />
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
  );
}
