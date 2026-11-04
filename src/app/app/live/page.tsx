import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { bookingLinkLabel, bookingUrl } from "@/lib/booking-link";
import { describeOpenDays, fromAvailabilityRows, sharedHours } from "@/lib/hours";
import { getDashboardContext } from "@/server/auth/dashboard";
import { listBusinessHours } from "@/server/db/queries/dashboard";

import { CopyLinkField, LinkActions, QrDownloads } from "./live-actions";

export const metadata: Metadata = { title: "You're live" };

/** Where onboarding ends (docs/design/setup-settings/2-you're-live), inside the dashboard shell. */
export default function LivePage() {
  return (
    <Suspense fallback={<LiveSkeleton />}>
      <Live />
    </Suspense>
  );
}

const NEXT_STEPS = [
  {
    title: "Add your team",
    body: "Invite your staff so customers can pick who they see.",
  },
  {
    title: "Add more services",
    body: "Add the rest of your menu, with prices and durations.",
  },
  {
    title: "Turn on the AI receptionist",
    body: "Answers questions and books 24/7 from your site.",
  },
];

async function Live() {
  const { business, claims } = await getDashboardContext();
  const url = bookingUrl(business.slug);
  const display = bookingLinkLabel(business.slug);
  const days = fromAvailabilityRows(await listBusinessHours(claims, business.id));
  const when = `${describeOpenDays(days)}, ${sharedHours(days) ?? "with hours that vary by day"}`;
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1C1917", light: "#FFFFFF" },
  });

  return (
    <main className="flex w-full max-w-7xl flex-col px-4 py-8 sm:px-6 lg:px-12 lg:py-12">
      <div className="flex w-full flex-col gap-8">
        <header className="flex items-start gap-4 sm:gap-6">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-text sm:size-16">
            <Check aria-hidden className="size-7 sm:size-8" strokeWidth={2.5} />
          </span>
          <div>
            <h1 className="text-heading sm:text-display">
              You&rsquo;re live. Customers can book now.
            </h1>
            <p className="mt-2 text-body text-muted-foreground">
              {business.name} takes bookings {when}. Share your link anywhere your customers already
              are.
            </p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section
            aria-labelledby="link-title"
            className="flex flex-col gap-6 rounded-xl border bg-card p-6 shadow-xs sm:p-8"
          >
            <h2 id="link-title" className="text-title">
              Your booking link
            </h2>
            <CopyLinkField url={url} display={display} />
            <LinkActions url={url} name={business.name} />
            <div className="flex flex-col items-start gap-3 rounded-xl bg-primary-tint p-6 text-primary-tint-foreground">
              <h3 className="text-title">Add booking to your website</h3>
              <p className="text-body">
                Paste one line of code and a &ldquo;Book now&rdquo; button appears on every page,
                with the AI receptionist if you want it.
              </p>
              <Button asChild className="mt-1 h-11 px-5 text-label">
                <Link href="/app/settings/embed">
                  Add to your website
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </section>

          <section
            aria-labelledby="qr-title"
            className="flex flex-col items-center gap-5 rounded-xl border bg-card p-6 text-center shadow-xs sm:p-8"
          >
            <h2 id="qr-title" className="self-start text-title">
              QR code
            </h2>
            <div
              role="img"
              aria-label={`QR code that opens ${display}`}
              className="size-48 rounded-xl border bg-white p-3 [&_svg]:size-full"
              // Generated on the server from our own URL by the qrcode library.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="text-body-sm text-muted-foreground">
              Print it for your front desk, mirrors or receipts. Scans open your booking page.
            </p>
            <QrDownloads url={url} svg={svg} slug={business.slug} />
          </section>
        </div>

        <section aria-labelledby="next-title" className="flex flex-col gap-4">
          <h2 id="next-title" className="text-title">
            Finish setting up
          </h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {NEXT_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4 rounded-xl border bg-card p-5">
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-mono-sm text-muted-foreground"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-label">{step.title}</p>
                  <p className="mt-1 text-body-sm text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

function LiveSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading your booking link"
      className="flex w-full max-w-7xl flex-col px-4 py-8 sm:px-6 lg:px-12 lg:py-12"
    >
      <div className="flex w-full flex-col gap-8">
        <div className="h-16 w-2/3 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="h-96 animate-pulse rounded-xl border bg-card" />
          <div className="h-96 animate-pulse rounded-xl border bg-card" />
        </div>
      </div>
    </main>
  );
}
