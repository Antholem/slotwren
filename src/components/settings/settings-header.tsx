import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { cn } from "@/lib/utils";

export const SETTINGS_TABS = [
  { key: "business", label: "Business", href: "/app/settings" },
  { key: "booking-page", label: "Booking page", href: "/app/settings/booking-page" },
  { key: "embed", label: "Embed", href: "/app/settings/embed" },
  { key: "notifications", label: "Notifications", href: "/app/settings/notifications" },
  { key: "billing", label: "Billing", href: "/app/settings/billing" },
] as const satisfies readonly { key: string; label: string; href: Route }[];

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/**
 * "Settings", the tab's one-line summary and the section links, as on the
 * Embed and Billing mockups. Each tab is its own page, so these are links.
 */
export function SettingsHeader({
  current,
  description,
  actions,
}: {
  current: SettingsTab;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description={description} actions={actions} />
      <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-2 border-b">
          {SETTINGS_TABS.map((tab) => {
            const active = tab.key === current;
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex h-11 items-center border-b-2 px-3 text-body whitespace-nowrap transition-colors focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-ring",
                    active
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** A tab that isn't built yet: what it will do, and what happens meanwhile. */
export function ComingSoonPanel({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="coming-soon-title"
      className="flex max-w-2xl flex-col items-start gap-4 rounded-xl border bg-card p-6 sm:p-8"
    >
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-lg bg-primary-tint text-primary-tint-foreground [&_svg]:size-5"
      >
        {icon}
      </span>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="coming-soon-title" className="text-title">
            {title}
          </h2>
          <span className="rounded-full border px-2 py-0.5 text-caption text-muted-foreground">
            Coming soon
          </span>
        </div>
        <div className="flex flex-col gap-2 text-body text-muted-foreground">{children}</div>
      </div>
    </section>
  );
}
