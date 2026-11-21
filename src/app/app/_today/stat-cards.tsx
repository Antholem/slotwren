import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { formatAmount } from "@/lib/money";
import { noShowRate, weekChange } from "@/lib/today";
import { cn } from "@/lib/utils";
import type { TodayStats } from "@/server/db/queries/today";

/** The four stat cards. `mine`: a staff member's own numbers. */
export function StatCards({
  stats,
  currency,
  hasBookings,
  mine,
}: {
  stats: TodayStats;
  currency: string;
  hasBookings: boolean;
  mine: boolean;
}) {
  const none = "No bookings yet";
  const { today, week, noShows } = stats;
  const change = weekChange(week.total, week.lastWeek);
  const rate = noShowRate(noShows.count, noShows.marked);

  const todayParts = [
    today.done && `${today.done} done`,
    today.inProgress && `${today.inProgress} in progress`,
    today.toGo && `${today.toGo} to go`,
    today.noShow && `${today.noShow} no-show`,
  ].filter(Boolean);

  return (
    <section aria-label={mine ? "Your numbers" : "Numbers"}>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label={mine ? "Your bookings today" : "Bookings today"}
          value={String(today.total)}
          note={
            !hasBookings
              ? none
              : today.total === 0
                ? "Nothing booked today"
                : todayParts.join(" · ")
          }
        />
        <StatCard
          label="This week"
          value={String(week.total)}
          note={
            !hasBookings ? (
              none
            ) : change === null ? (
              "No bookings last week"
            ) : (
              <span className="flex flex-wrap items-center gap-x-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-mono tabular-nums",
                    change >= 0 ? "text-success-text" : "text-muted-foreground",
                  )}
                >
                  {change >= 0 ? (
                    <TrendingUp aria-hidden className="size-4" />
                  ) : (
                    <TrendingDown aria-hidden className="size-4" />
                  )}
                  {change >= 0 ? "+" : "−"}
                  {Math.abs(change)}%
                </span>
                vs last week
              </span>
            )
          }
        />
        <StatCard
          label="Est. revenue this week"
          value={formatAmount(week.revenueCents, currency)}
          note={hasBookings ? "From booked prices" : none}
        />
        <StatCard
          label="No-show rate"
          value={rate ?? "–"}
          valueLabel={rate ?? "No rate yet"}
          note={!hasBookings ? none : rate ? "Last 30 days" : "Nothing marked in 30 days"}
        />
      </ul>
    </section>
  );
}

function StatCard({
  label,
  value,
  valueLabel,
  note,
}: {
  label: string;
  value: string;
  valueLabel?: string;
  note: ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 sm:p-6">
      <p className="text-body-sm text-muted-foreground">{label}</p>
      <p className="font-mono text-heading tabular-nums sm:text-display">
        <span aria-hidden={valueLabel ? true : undefined}>{value}</span>
        {valueLabel && <span className="sr-only">{valueLabel}</span>}
      </p>
      <div className="text-body-sm text-muted-foreground">{note}</div>
    </li>
  );
}
