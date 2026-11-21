import { CalendarDays, Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { SetupProgress } from "@/server/db/queries/today";

import { CopyLinkButton, NewBookingButton } from "./header-actions";

/** Nothing on today (docs/design/owner-dashboard/empty-brand-new-business-today). */
export function EmptyToday({
  url,
  firstBooking,
  owner,
  className,
}: {
  url: string;
  /** No bookings ever: invite the first one. */
  firstBooking: boolean;
  owner: boolean;
  className?: string;
}) {
  const body = !owner
    ? "Appointments booked with you will appear here."
    : firstBooking
      ? "Share your booking page and new bookings will appear here, grouped by team member."
      : "Nothing is booked for today. Share your booking page to fill the gaps.";
  return (
    <section
      aria-labelledby="empty-today"
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center sm:py-16",
        className,
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-xl bg-primary-tint text-primary-tint-foreground">
        <CalendarDays aria-hidden className="size-6" />
      </span>
      <h2 id="empty-today" className="text-title">
        No appointments today
      </h2>
      <p className="max-w-md text-body text-muted-foreground">{body}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <CopyLinkButton url={url} variant="default" />
        {owner && <NewBookingButton url={url} variant="text" />}
      </div>
    </section>
  );
}

/** "Get ready for your first booking": owners of a business with no bookings yet. */
export function SetupChecklist({ setup, url }: { setup: SetupProgress; url: string }) {
  const items: { label: string; done: boolean; action: ReactNode }[] = [
    { label: "Create your business", done: true, action: null },
    {
      label: "Set opening hours",
      done: setup.openingHours,
      action: <ChecklistLink href="/app/settings">Set hours</ChecklistLink>,
    },
    {
      label: "Add your services",
      done: setup.services,
      action: <ChecklistLink href="/app/services">Add services</ChecklistLink>,
    },
    {
      label: "Add your team",
      done: setup.team,
      action: <ChecklistLink href="/app/staff">Invite staff</ChecklistLink>,
    },
    {
      label: "Share your booking page",
      done: false,
      action: <CopyLinkButton url={url} label="Copy link" variant="link" />,
    },
    {
      label: "Turn on the AI receptionist",
      done: setup.aiEnabled,
      action: <span className="text-body-sm text-muted-foreground">Coming soon</span>,
    },
  ];
  const done = items.filter((i) => i.done).length;

  return (
    <section aria-labelledby="setup-checklist" className="rounded-xl border bg-card p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="setup-checklist" className="text-title">
          Get ready for your first booking
        </h2>
        <p className="font-mono text-body-sm whitespace-nowrap text-muted-foreground tabular-nums">
          {done} of {items.length}
        </p>
      </div>
      <div aria-hidden className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${(done / items.length) * 100}%` }}
        />
      </div>
      <ul className="mt-4 divide-y border-t">
        {items.map((item) => (
          <li key={item.label} className="flex min-h-16 items-center gap-3 py-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                item.done
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground",
              )}
            >
              {item.done && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 text-body",
                item.done && "text-muted-foreground line-through",
              )}
            >
              {item.label}
              <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
            </span>
            {!item.done && item.action}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChecklistLink({
  href,
  children,
}: {
  href: "/app/settings" | "/app/services" | "/app/staff";
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-label text-primary underline underline-offset-4 hover:text-primary-hover focus-visible:rounded focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}
