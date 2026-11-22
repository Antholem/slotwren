"use client";

import { ChartLine, TrendingDown, TrendingUp } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type PointerEvent, useId, useState } from "react";

import { formatInZone } from "@/lib/dates";
import { type OpeningRange, minutesOf } from "@/lib/hours";
import { heatLevel, INSIGHT_RANGES, type InsightRange, percent, RANGE_LABEL } from "@/lib/insights";
import { formatAmount, formatPrice } from "@/lib/money";
import { noShowRate, weekChange } from "@/lib/today";
import { cn } from "@/lib/utils";
import type { Insights } from "@/server/db/queries/insights";

import { CopyLinkButton } from "../_today/header-actions";

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";
const SOURCE_LABEL = {
  page: "Booking page",
  widget: "Website widget",
  ai: "AI receptionist",
  manual: "Added by staff",
} as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
/** Sequential heat ramp from the tokens: primary mixed into the card. Busier is darker in light, brighter in dark. */
const HEAT_MIX = [0, 25, 50, 75, 100];

const weekLabel = (monday: string) => formatInZone(new Date(`${monday}T12:00:00Z`), "UTC", "d MMM");
const pad = (h: number) => String(h).padStart(2, "0");

export function InsightsView({
  data,
  mondays,
  range,
  subtitle,
  currency,
  openingHours,
  owner,
  staff,
  staffId,
  rangeHrefs,
  staffHrefs,
  bookingUrl,
}: {
  data: Insights;
  mondays: string[];
  range: InsightRange;
  subtitle: string;
  currency: string;
  openingHours: OpeningRange[] | null;
  owner: boolean;
  staff: { id: string; name: string }[];
  staffId: string | null;
  rangeHrefs: Record<InsightRange, Route>;
  staffHrefs: Record<string, Route>;
  bookingUrl: string;
}) {
  const router = useRouter();
  const id = useId();
  const { totals } = data;
  const rate = noShowRate(totals.noShows, totals.marked);
  const label = RANGE_LABEL[range].toLowerCase();

  return (
    <main
      aria-label="Insights"
      className="flex w-full max-w-7xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-12 lg:py-12"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-heading sm:text-display">Insights</h1>
          <p className="mt-1 text-body text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Range" className="flex rounded-lg border bg-card p-1">
            {INSIGHT_RANGES.map((r) => (
              <Link
                key={r}
                href={rangeHrefs[r]}
                aria-current={r === range ? "page" : undefined}
                scroll={false}
                className={cn(
                  "flex h-9 items-center rounded-md px-4 text-label",
                  r === range ? "bg-muted" : "hover:bg-muted",
                  focusRing,
                )}
              >
                {RANGE_LABEL[r]}
              </Link>
            ))}
          </nav>
          {owner && staff.length > 1 && (
            <div className="relative flex h-11 items-center gap-1 rounded-lg border border-input bg-card pl-3 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
              <label htmlFor={`${id}-staff`} className="text-body-sm text-muted-foreground">
                Staff
              </label>
              <select
                id={`${id}-staff`}
                value={staffId ?? ""}
                onChange={(event) =>
                  router.push(staffHrefs[event.target.value] ?? rangeHrefs[range], {
                    scroll: false,
                  })
                }
                className="h-full appearance-none bg-transparent pr-8 pl-1 text-label outline-none"
              >
                <option value="">All</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className="pointer-events-none absolute right-3 size-4 text-muted-foreground"
              >
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {!data.hasBookings ? (
        <section className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-xl bg-primary-tint text-primary-tint-foreground">
            <ChartLine aria-hidden className="size-6" />
          </span>
          <h2 className="text-title">No insights yet</h2>
          <p className="max-w-lg text-body text-muted-foreground">
            {owner
              ? "Once bookings come in you'll see them week by week here: revenue, busiest hours, where customers book from and your top services."
              : "Once you have bookings, your weeks, busiest hours and top services appear here."}
          </p>
          {owner && <CopyLinkButton url={bookingUrl} variant="default" />}
        </section>
      ) : (
        <>
          <ul aria-label="Totals" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Kpi label={`Bookings, ${label}`} value={String(totals.bookings)} />
            <Kpi
              label={`Est. revenue, ${label}`}
              value={formatAmount(totals.revenueCents, currency)}
            />
            <Kpi
              label="No-show rate"
              value={rate ?? "–"}
              note={rate ? `${totals.noShows} of ${totals.marked} marked` : "Nothing marked yet"}
            />
            <Kpi
              label="Booked by the AI receptionist"
              value={percent(totals.ai, totals.bookings)}
            />
          </ul>

          <WeeklyChart weeks={data.weeks} mondays={mondays} currency={currency} />

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Heatmap heat={data.heat} openingHours={openingHours} range={label} />
            <Sources bySource={data.bySource} total={totals.bookings} />
          </div>

          <TopServices services={data.topServices} total={totals.bookings} currency={currency} />
        </>
      )}
    </main>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 sm:p-6">
      <p className="text-body-sm text-muted-foreground">{label}</p>
      <p className="font-mono text-heading tabular-nums sm:text-display">{value}</p>
      {note && <p className="text-body-sm text-muted-foreground">{note}</p>}
    </li>
  );
}

/** Four gridline steps of a round size (1, 2 or 5 × 10ⁿ) that reach the data's top. */
function niceStep(top: number): number {
  const raw = Math.max(1, top) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const step of [1, 2, 5, 10]) if (step * power >= raw) return Math.max(1, step * power);
  return 10 * power;
}

function TableToggle({
  shown,
  onToggle,
  controls,
}: {
  shown: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={shown}
      aria-controls={controls}
      onClick={onToggle}
      className={cn("min-h-11 rounded text-label text-primary hover:underline", focusRing)}
    >
      {shown ? "View as chart" : "View as table"}
    </button>
  );
}

function WeeklyChart({
  weeks,
  mondays,
  currency,
}: {
  weeks: Insights["weeks"];
  mondays: string[];
  currency: string;
}) {
  const id = useId();
  const [table, setTable] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const n = weeks.length;
  const values = weeks.map((w) => w.bookings);
  const step = niceStep(Math.max(...values, 0));
  const max = step * 4;
  const thisWeek = values.at(-1) ?? 0;
  const change = n > 1 ? weekChange(thisWeek, values.at(-2) ?? 0) : null;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / max) * 100;
  const points = values.map((v, i) => `${x(i) * 10},${y(v) * 10}`).join(" ");
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);
  // About eight week labels on wide screens, four on phones; the last week is always labelled.
  const labelled = (i: number, every: number) =>
    i === n - 1 || (i % every === 0 && n - 1 - i >= every);
  const wide = Math.ceil(n / 8);
  const narrow = Math.ceil(n / 4);

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setActive(n === 1 ? 0 : Math.round(fraction * (n - 1)));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft"
        ? (active ?? n) - 1
        : event.key === "ArrowRight"
          ? (active ?? -1) + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? n - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(n - 1, next)));
  };
  const read = (i: number) =>
    `Week of ${weekLabel(mondays[i]!)}: ${values[i]} ${values[i] === 1 ? "booking" : "bookings"}`;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-xl border bg-card p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-title">
            Bookings per week
          </h2>
          <p className="flex flex-wrap items-center gap-x-1.5 text-body text-muted-foreground">
            <span>
              <span className="font-mono text-foreground tabular-nums">{thisWeek}</span> this week
            </span>
            {change !== null && (
              <>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-mono tabular-nums",
                    change >= 0 ? "text-success-text" : "text-foreground",
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
                <span>vs last week</span>
              </>
            )}
          </p>
        </div>
        <TableToggle shown={table} onToggle={() => setTable((t) => !t)} controls={`${id}-body`} />
      </div>

      <div id={`${id}-body`}>
        {table ? (
          <div
            role="region"
            aria-label="Bookings per week, table"
            tabIndex={0}
            className={cn("relative overflow-x-auto rounded-sm", focusRing)}
          >
            <table className="w-full min-w-[32rem] border-collapse text-left text-body">
              <caption className="sr-only">Bookings, revenue and no-shows per week</caption>
              <thead>
                <tr className="border-b text-body-sm text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Week of
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">
                    Bookings
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">
                    Est. revenue
                  </th>
                  <th scope="col" className="py-2 pl-3 text-right font-normal">
                    No-shows
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w, i) => (
                  <tr key={mondays[i]} className="border-b last:border-b-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      {weekLabel(mondays[i]!)}
                    </th>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{w.bookings}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatAmount(w.revenueCents, currency)}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono tabular-nums">{w.noShows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2">
            <div aria-hidden className="relative h-56">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute right-0 -translate-y-1/2 font-mono text-caption text-muted-foreground tabular-nums"
                  style={{ top: `${y(t)}%` }}
                >
                  {t}
                </span>
              ))}
            </div>
            <div
              role="img"
              tabIndex={0}
              aria-label={`Bookings per week, ${weekLabel(mondays[0]!)} to ${weekLabel(mondays.at(-1)!)}: from ${values[0]} to ${values.at(-1)}, highest ${Math.max(...values)}. Arrow keys read each week; View as table lists them all.`}
              onPointerMove={pick}
              onPointerLeave={() => setActive(null)}
              onKeyDown={keys}
              onFocus={() => setActive((a) => a ?? n - 1)}
              onBlur={() => setActive(null)}
              className={cn("relative h-56 touch-none rounded-sm", focusRing)}
            >
              {ticks.map((t) => (
                <span
                  key={t}
                  aria-hidden
                  className="absolute inset-x-0 h-px bg-border"
                  style={{ top: `${y(t)}%` }}
                />
              ))}
              <svg
                aria-hidden
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className="absolute inset-0 size-full overflow-visible"
              >
                <polyline
                  points={points}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              <Dot left={x(n - 1)} top={y(thisWeek)} />
              {active !== null && (
                <>
                  <span
                    aria-hidden
                    className="absolute inset-y-0 w-px border-l border-dashed border-muted-foreground"
                    style={{ left: `${x(active)}%` }}
                  />
                  <Dot left={x(active)} top={y(values[active]!)} ring />
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute top-0 z-10 rounded-lg border bg-popover px-3 py-2 text-body-sm whitespace-nowrap text-popover-foreground shadow-md",
                      x(active) > 60 ? "-translate-x-[calc(100%+0.75rem)]" : "translate-x-3",
                    )}
                    style={{ left: `${x(active)}%` }}
                  >
                    <span className="block text-muted-foreground">
                      Week of {weekLabel(mondays[active]!)}
                    </span>
                    <span className="block">
                      <span className="font-mono text-label tabular-nums">{values[active]}</span>{" "}
                      {values[active] === 1 ? "booking" : "bookings"}
                    </span>
                  </div>
                </>
              )}
            </div>
            <div aria-hidden />
            <div aria-hidden className="relative mt-2 h-5">
              {mondays.map((m, i) =>
                labelled(i, wide) || labelled(i, narrow) ? (
                  <span
                    key={m}
                    className={cn(
                      "absolute text-caption whitespace-nowrap text-muted-foreground",
                      i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2",
                      !labelled(i, narrow) && "hidden sm:inline",
                      !labelled(i, wide) && "sm:hidden",
                    )}
                    style={{ left: `${x(i)}%` }}
                  >
                    {weekLabel(m)}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {active !== null ? read(active) : ""}
      </p>
    </section>
  );
}

function Dot({ left, top, ring }: { left: number; top: number; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute size-2.5 -translate-1/2 rounded-full bg-primary",
        ring && "ring-2 ring-card",
      )}
      style={{ left: `${left}%`, top: `${top}%` }}
    />
  );
}

function Heatmap({
  heat,
  openingHours,
  range,
}: {
  heat: Insights["heat"];
  openingHours: OpeningRange[] | null;
  range: string;
}) {
  const id = useId();
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<{ weekday: number; hour: number; count: number } | null>(null);
  const count = (weekday: number, hour: number) =>
    heat.find((h) => h.weekday === weekday && h.hour === hour)?.bookings ?? 0;
  const max = Math.max(0, ...heat.map((h) => h.bookings));

  // Hours worth a column: opening hours and any hour that has bookings. 09–17 by default.
  const hours = new Set<number>();
  for (const o of openingHours ?? []) {
    for (let m = minutesOf(o.start); m < minutesOf(o.end); m += 60) hours.add(Math.floor(m / 60));
  }
  for (const h of heat) hours.add(h.hour);
  if (hours.size === 0) for (let h = 9; h < 18; h++) hours.add(h);
  const lo = Math.min(...hours);
  const hi = Math.max(...hours);
  const columns = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  // isodow 1–7 (Monday first); opening hours use 0 = Sunday.
  const closed = (isodow: number) =>
    !!openingHours &&
    !openingHours.some((o) => o.weekday === isodow % 7) &&
    !heat.some((h) => h.weekday === isodow);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-title">
            Busiest hours
          </h2>
          <p className="text-body text-muted-foreground">Bookings starting in each hour, {range}</p>
        </div>
        <TableToggle shown={table} onToggle={() => setTable((t) => !t)} controls={`${id}-body`} />
      </div>
      <div id={`${id}-body`}>
        {table ? (
          <div
            role="region"
            aria-label="Busiest hours, table"
            tabIndex={0}
            className={cn("relative overflow-x-auto rounded-sm", focusRing)}
          >
            <table className="w-full border-collapse text-center text-body-sm">
              <caption className="sr-only">Bookings starting in each hour, by weekday</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 text-left font-normal">
                    Day
                  </th>
                  {columns.map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-1 py-2 font-mono font-normal tabular-nums"
                    >
                      {pad(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WEEKDAYS.map((day, i) => (
                  <tr key={day} className="border-b last:border-b-0">
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      {WEEKDAYS_LONG[i]}
                    </th>
                    {columns.map((h) => (
                      <td key={h} className="px-1 py-2 font-mono tabular-nums">
                        {count(i + 1, h)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div aria-hidden>
            <div
              className="grid gap-0.5 sm:gap-1"
              style={{ gridTemplateColumns: `2.5rem repeat(${columns.length}, minmax(0, 1fr))` }}
            >
              <span />
              {columns.map((h) => (
                <span
                  key={h}
                  className="text-center font-mono text-caption text-muted-foreground tabular-nums"
                >
                  {pad(h)}
                </span>
              ))}
              {WEEKDAYS.map((day, i) => (
                <div key={day} className="contents">
                  <span className="self-center text-body-sm text-muted-foreground">{day}</span>
                  {closed(i + 1) ? (
                    <span
                      className="flex h-9 items-center justify-center rounded-md bg-[repeating-linear-gradient(135deg,var(--color-border)_0_6px,transparent_6px_12px)] text-body-sm text-foreground"
                      style={{ gridColumn: `span ${columns.length}` }}
                    >
                      <span className="rounded bg-card px-1.5">Closed</span>
                    </span>
                  ) : (
                    columns.map((h) => {
                      const c = count(i + 1, h);
                      const level = heatLevel(c, max);
                      const lit = hover?.weekday === i + 1 && hover.hour === h;
                      return (
                        <span
                          key={h}
                          onPointerEnter={() => setHover({ weekday: i + 1, hour: h, count: c })}
                          onPointerLeave={() => setHover(null)}
                          className={cn("h-9 rounded-md", lit && "ring-2 ring-foreground")}
                          style={{
                            background:
                              level === 0
                                ? "var(--color-muted)"
                                : `color-mix(in oklch, var(--color-primary) ${HEAT_MIX[level]}%, var(--color-card))`,
                          }}
                        />
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {!table && (
        <div
          aria-hidden
          className="flex flex-wrap items-center justify-between gap-3 text-body-sm text-muted-foreground"
        >
          <span className="flex items-center gap-1.5">
            Quiet
            {HEAT_MIX.map((mix, level) => (
              <span
                key={level}
                className="h-3.5 w-6 rounded"
                style={{
                  background:
                    level === 0
                      ? "var(--color-muted)"
                      : `color-mix(in oklch, var(--color-primary) ${mix}%, var(--color-card))`,
                }}
              />
            ))}
            Busiest
          </span>
          <span className="text-foreground">
            {hover
              ? `${WEEKDAYS[hover.weekday - 1]} ${pad(hover.hour)}:00–${pad(hover.hour + 1)}:00 · ${hover.count} ${hover.count === 1 ? "booking" : "bookings"}`
              : "Hover a cell to see the hour"}
          </span>
        </div>
      )}
    </section>
  );
}

function Sources({ bySource, total }: { bySource: Insights["bySource"]; total: number }) {
  const id = useId();
  const order = ["page", "widget", "ai", "manual"] as const;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-5 rounded-xl border bg-card p-6"
    >
      <div>
        <h2 id={`${id}-title`} className="text-title">
          Bookings by source
        </h2>
        <p className="text-body text-muted-foreground">
          Where the <span className="font-mono tabular-nums">{total}</span> bookings came from
        </p>
      </div>
      <ul className="flex flex-col gap-5">
        {order.map((source) => {
          const n = bySource.find((s) => s.source === source)?.bookings ?? 0;
          const share = total > 0 ? n / total : 0;
          return (
            <li key={source} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3 text-body">
                <span>{SOURCE_LABEL[source]}</span>
                <span>
                  <span className="font-mono text-label tabular-nums">{n}</span>{" "}
                  <span className="font-mono text-body-sm text-muted-foreground tabular-nums">
                    {percent(n, total)}
                  </span>
                </span>
              </div>
              <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${share * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TopServices({
  services,
  total,
  currency,
}: {
  services: Insights["topServices"];
  total: number;
  currency: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h2 id={`${id}-title`} className="text-title">
        Top services
      </h2>
      <div
        role="region"
        aria-label="Top services, table"
        tabIndex={0}
        className={cn("relative overflow-x-auto rounded-xl border bg-card", focusRing)}
      >
        <table className="w-full min-w-[40rem] border-collapse text-left text-body">
          <thead>
            <tr className="border-b text-body-sm text-muted-foreground">
              <th scope="col" className="py-3 pl-6 font-normal">
                Service
              </th>
              <th scope="col" className="px-3 py-3 text-right font-normal">
                Price
              </th>
              <th scope="col" className="px-3 py-3 text-right font-normal">
                Bookings
              </th>
              <th scope="col" className="px-3 py-3 font-normal">
                Share of bookings
              </th>
              <th scope="col" className="py-3 pr-6 text-right font-normal">
                Est. revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-b last:border-b-0">
                <th scope="row" className="py-4 pl-6 text-left text-label">
                  {s.name}
                </th>
                <td className="px-3 py-4 text-right font-mono tabular-nums">
                  {formatPrice(s.priceCents, currency)}
                </td>
                <td className="px-3 py-4 text-right font-mono tabular-nums">{s.bookings}</td>
                <td className="px-3 py-4">
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="h-2 w-full max-w-60 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${total > 0 ? (s.bookings / total) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="w-10 text-right font-mono text-body-sm text-muted-foreground tabular-nums">
                      {percent(s.bookings, total)}
                    </span>
                  </span>
                </td>
                <td className="py-4 pr-6 text-right font-mono tabular-nums">
                  {formatAmount(s.revenueCents, currency)}
                </td>
              </tr>
            ))}
            {services.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-body text-muted-foreground">
                  No bookings in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
