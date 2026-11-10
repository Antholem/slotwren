import { ArrowRight, CalendarClock, QrCode, Scissors } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { getDashboardContext } from "@/server/auth/dashboard";

export const metadata: Metadata = {
  title: "Today",
};

// Placeholder until the Today view (schedule, stats, now and next) lands in Phase 3.
export default function TodayPage() {
  return (
    <PageBody>
      <PageHeader
        title="Today"
        description="Your day at a glance arrives with bookings. Until then, start here."
      />
      <Suspense fallback={<QuickLinksSkeleton />}>
        <QuickLinks />
      </Suspense>
    </PageBody>
  );
}

/** Owners get setup prompts; staff get what they can act on themselves. */
async function QuickLinks() {
  const { role } = await getDashboardContext();
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      <QuickLink
        href="/app/live"
        icon={<QrCode aria-hidden className="size-5" />}
        title="Your booking link"
        body="Copy it, share it, or print the QR code."
      />
      {role === "owner" ? (
        <QuickLink
          href="/app/services"
          icon={<Scissors aria-hidden className="size-5" />}
          title="Services"
          body="Add the rest of your menu, with prices and durations."
        />
      ) : (
        <QuickLink
          href="/app/staff"
          icon={<CalendarClock aria-hidden className="size-5" />}
          title="Your schedule"
          body="Your weekly hours and time off."
        />
      )}
    </ul>
  );
}

function QuickLinksSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-4 md:grid-cols-2">
      <div className="h-20 animate-pulse rounded-xl border bg-card" />
      <div className="h-20 animate-pulse rounded-xl border bg-card" />
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  body,
}: {
  href: "/app/live" | "/app/services" | "/app/staff";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-4 rounded-xl border bg-card p-5 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary-tint text-primary-tint-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-label">{title}</span>
          <span className="block text-body-sm text-muted-foreground">{body}</span>
        </span>
        <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
      </Link>
    </li>
  );
}
