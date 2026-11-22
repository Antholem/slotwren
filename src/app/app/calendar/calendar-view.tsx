"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type Column,
  layoutOverlaps,
  place,
  realTimeColumn,
  wallClockColumn,
} from "@/lib/calendar-grid";
import { formatInZone } from "@/lib/dates";
import { minutesOf } from "@/lib/hours";
import { hoursToSpans, type Span } from "@/lib/timeline";
import { weekdayOf } from "@/lib/today";
import { cn } from "@/lib/utils";
import { zoneClock } from "@/lib/zone-clock";
import type { BookingOptions, CalendarBooking, CalendarStaff } from "@/server/db/queries/calendar";

import { BookingDrawer } from "../_booking/booking-drawer";
import { type SheetStart, BookingSheet } from "../_booking/booking-sheet";
import { STAFF_BLOCK, STAFF_DOT, STATUS_LABEL } from "../_booking/booking-ui";

/** Pixels per minute: a 30-minute row is 48 px, a 15-minute row 24 px. */
const PX = 1.6;
const TICK_MS = 30_000;
const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

type Links = {
  prev: Route;
  next: Route;
  today: Route;
  day: Route;
  week: Route;
  dayOf: Record<string, Route>;
};

type Lane = { date: string; column: Column; person: CalendarStaff; index: number };

type CellState =
  | { kind: "booking"; booking: CalendarBooking }
  | { kind: "free" }
  | { kind: "past" }
  | { kind: "off"; why: string };

export function CalendarView({
  view,
  dates,
  today,
  zone,
  now: serverNow,
  range,
  intervalMin,
  staff,
  bookings,
  options,
  role,
  currency,
  title,
  links,
}: {
  view: "day" | "week";
  dates: string[];
  today: string;
  zone: string;
  now: Date;
  range: Span;
  intervalMin: number;
  staff: CalendarStaff[];
  bookings: CalendarBooking[];
  options: BookingOptions;
  role: "owner" | "staff";
  currency: string;
  title: string;
  links: Links;
}) {
  const now = useNow(serverNow);
  const router = useRouter();
  const clock = zoneClock(zone);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = staff.filter((s) => !hidden.has(s.id));
  const [sheet, setSheet] = useState<{ open: boolean; start: SheetStart }>({
    open: false,
    start: { date: today },
  });
  const [drawer, setDrawer] = useState<string | null>(null);

  const columns = useMemo(
    () =>
      dates.map((date) =>
        view === "day"
          ? realTimeColumn(date, zone, range, intervalMin)
          : wallClockColumn(date, zone, range, intervalMin),
      ),
    [dates, view, zone, range, intervalMin],
  );
  const lanes: Lane[] = columns.flatMap((column, d) =>
    visible.map((person, s) => ({
      date: dates[d]!,
      column,
      person,
      index: d * visible.length + s,
    })),
  );
  const rowCount = columns[0]?.rows.length ?? 0;
  const rowPx = intervalMin * PX;

  /** What a cell is: a booking, free to book, past, or nobody working. */
  function cellState(lane: Lane, row: number): CellState {
    const r = lane.column.rows[row]!;
    if (!r.start) return { kind: "off", why: "this time doesn't exist (clocks go forward)" };
    const start = r.start.getTime();
    const end = start + intervalMin * 60_000;
    const covering = bookings
      .filter(
        (b) =>
          b.staffId === lane.person.id && b.startsAt.getTime() < end && b.endsAt.getTime() > start,
      )
      .sort((a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled"));
    if (covering[0]) return { kind: "booking", booking: covering[0] };
    if (end <= now.getTime()) return { kind: "past" };
    const weekday = weekdayOf(lane.date);
    const minute = minutesOf(r.time);
    const working = hoursToSpans(lane.person.hours.filter((h) => h.weekday === weekday)).some(
      (h) => h.start <= minute && minute + intervalMin <= h.end,
    );
    if (!working) return { kind: "off", why: `${lane.person.name} isn't working` };
    const away = lane.person.timeOff.some(
      (t) => t.startsAt.getTime() < end && t.endsAt.getTime() > start,
    );
    if (away) return { kind: "off", why: `${lane.person.name} has time off` };
    return { kind: "free" };
  }

  const mayBook = (lane: Lane) => role === "owner" || lane.person.isMe;

  function activate(lane: Lane, row: number) {
    const state = cellState(lane, row);
    if (state.kind === "booking") {
      setDrawer(state.booking.id);
    } else if (state.kind === "free" && mayBook(lane)) {
      setSheet({
        open: true,
        start: { date: lane.date, time: lane.column.rows[row]!.time, staffId: lane.person.id },
      });
    }
  }

  // Roving focus: one tab stop in the grid, arrow keys move between cells.
  const gridRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(() =>
    initialFocus(columns, dates, today, now, visible.length),
  );
  const laneCount = lanes.length;
  const at = {
    lane: Math.min(focus.lane, Math.max(0, laneCount - 1)),
    row: Math.min(focus.row, Math.max(0, rowCount - 1)),
  };

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    let next: { lane: number; row: number } | null = null;
    if (event.key in step) {
      const [dl, dr] = step[event.key]!;
      next = {
        lane: Math.max(0, Math.min(laneCount - 1, at.lane + dl)),
        row: Math.max(0, Math.min(rowCount - 1, at.row + dr)),
      };
    } else if (event.key === "Home") {
      next = { lane: at.lane, row: 0 };
    } else if (event.key === "End") {
      next = { lane: at.lane, row: rowCount - 1 };
    }
    if (!next) return;
    event.preventDefault();
    setFocus(next);
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${next.lane}-${next.row}"]`)
      ?.focus();
  }

  const nowParts = clock.parts(now.getTime());
  const nowLabel = nowParts.time;

  return (
    <main
      aria-label="Calendar"
      className="flex w-full min-w-0 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-heading sm:text-display">{title}</h1>
        <nav aria-label="Dates" className="flex items-center gap-2">
          <NavLink href={links.prev} label={view === "week" ? "Previous week" : "Previous day"}>
            <ChevronLeft aria-hidden className="size-5" />
          </NavLink>
          <Link
            href={links.today}
            className={cn(
              "flex h-11 items-center rounded-lg border bg-card px-4 text-label hover:bg-muted",
              focusRing,
            )}
          >
            Today
          </Link>
          <NavLink href={links.next} label={view === "week" ? "Next week" : "Next day"}>
            <ChevronRight aria-hidden className="size-5" />
          </NavLink>
        </nav>
        <nav aria-label="View" className="flex rounded-lg border bg-card p-1">
          {(["day", "week"] as const).map((v) => (
            <Link
              key={v}
              href={links[v]}
              aria-current={view === v ? "page" : undefined}
              className={cn(
                "flex h-9 items-center rounded-md px-4 text-label",
                view === v ? "bg-muted" : "hover:bg-muted",
                focusRing,
              )}
            >
              {v === "day" ? "Day" : "Week"}
            </Link>
          ))}
        </nav>
        <div className="flex w-full flex-wrap items-center justify-between gap-3 2xl:ml-auto 2xl:w-auto">
          {staff.length > 1 && (
            <div role="group" aria-label="Show staff" className="flex flex-wrap gap-2">
              {staff.map((person) => {
                const shown = !hidden.has(person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    aria-pressed={shown}
                    onClick={() =>
                      setHidden((current) => {
                        const next = new Set(current);
                        if (shown) next.add(person.id);
                        else next.delete(person.id);
                        // Someone always stays on the calendar.
                        return next.size === staff.length ? current : next;
                      })
                    }
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-full border px-4 text-label",
                      shown
                        ? "border-foreground bg-card"
                        : "border-dashed border-muted-foreground bg-transparent text-muted-foreground",
                      focusRing,
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 rounded-full",
                        shown ? STAFF_DOT[person.color] : "border border-muted-foreground",
                      )}
                    />
                    {person.name}
                  </button>
                );
              })}
            </div>
          )}
          <Button
            type="button"
            className="h-11 px-5 text-label"
            onClick={() =>
              setSheet({
                open: true,
                start: { date: dates.includes(today) ? today : dates[0]! },
              })
            }
          >
            <Plus aria-hidden />
            New booking
          </Button>
        </div>
      </div>

      {staff.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-8 text-center text-body text-muted-foreground">
          Add your team on the Staff page and their days appear here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <div
            className="grid min-w-[44rem]"
            style={{
              gridTemplateColumns: `4rem repeat(${lanes.length}, minmax(${view === "week" ? "2.75rem" : "8rem"}, 1fr))`,
            }}
          >
            {/* Headers: one per day (week), or one per staff member (day). */}
            <div className="sticky left-0 z-20 border-b bg-card" />
            {view === "week"
              ? dates.map((date) => {
                  const isToday = date === today;
                  const label = formatInZone(new Date(`${date}T12:00:00Z`), "UTC", "EEE");
                  return (
                    <Link
                      key={date}
                      href={links.dayOf[date] ?? links.day}
                      className={cn(
                        "flex flex-col items-center justify-center border-b border-l py-2 text-center hover:bg-muted",
                        isToday &&
                          "bg-primary-tint text-primary-tint-foreground hover:bg-primary-tint",
                        focusRing,
                      )}
                      style={{ gridColumn: `span ${visible.length}` }}
                      aria-label={`${formatInZone(new Date(`${date}T12:00:00Z`), "UTC", "EEEE d MMMM")}${isToday ? ", today" : ""}: open day view`}
                    >
                      <span className="text-body-sm">{isToday ? "Today" : label}</span>
                      <span className="text-title">{Number(date.slice(8))}</span>
                    </Link>
                  );
                })
              : visible.map((person) => (
                  <div
                    key={person.id}
                    className="flex items-center justify-center gap-2 border-b border-l py-3 text-label"
                  >
                    <span
                      aria-hidden
                      className={cn("size-2.5 rounded-full", STAFF_DOT[person.color])}
                    />
                    {person.name}
                  </div>
                ))}

            {/* Time gutter */}
            <div className="sticky left-0 z-20 border-r bg-card" aria-hidden>
              {columns[0]!.rows.map((row, i) => (
                <div
                  key={i}
                  className="relative pr-2 text-right font-mono text-caption text-muted-foreground tabular-nums"
                  style={{ height: rowPx }}
                >
                  {(row.time.endsWith(":00") || i === 0) && (
                    <span className="absolute -top-2 right-2">
                      {row.time}
                      {row.repeated && "²"}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Lanes */}
            <div
              ref={gridRef}
              role="group"
              aria-label={`${title}: ${view === "week" ? "week" : "day"} grid`}
              aria-describedby="calendar-keys"
              onKeyDown={move}
              className="contents"
            >
              {lanes.map((lane) => (
                <LaneColumn
                  key={`${lane.date}-${lane.person.id}`}
                  lane={lane}
                  zone={zone}
                  now={now}
                  rowPx={rowPx}
                  bookings={bookings.filter((b) => b.staffId === lane.person.id)}
                  isToday={lane.date === today}
                  firstOfDay={lane.index % visible.length === 0}
                  focus={at}
                  onFocusCell={(row) => setFocus({ lane: lane.index, row })}
                  cellState={(row) => cellState(lane, row)}
                  mayBook={mayBook(lane)}
                  onActivate={(row) => activate(lane, row)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <p id="calendar-keys" className="sr-only">
        Arrow keys move between times and staff; Home and End jump to the first and last time. Enter
        opens a booking, or books a free time.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm text-muted-foreground">
        <span>Each staff member has a lane and a colour; blocks name the customer.</span>
        {dates.includes(today) && (
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-5 bg-danger" />
            Now <span className="font-mono tabular-nums">{nowLabel}</span>
          </span>
        )}
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-3.5 rounded border border-dashed border-muted-foreground"
          />
          Pending
        </span>
        <span>Struck through: cancelled or no-show</span>
        <span>Times in {zone.replaceAll("_", " ")}</span>
      </div>

      <BookingSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        start={sheet.start}
        options={options}
        currency={currency}
        staffOnly={role === "staff"}
      />
      <BookingDrawer
        bookingId={drawer}
        onClose={() => {
          setDrawer(null);
          router.refresh();
        }}
        zone={zone}
        currency={currency}
        role={role}
        options={options}
      />
    </main>
  );
}

function LaneColumn({
  lane,
  zone,
  now,
  rowPx,
  bookings,
  isToday,
  firstOfDay,
  focus,
  onFocusCell,
  cellState,
  mayBook,
  onActivate,
}: {
  lane: Lane;
  zone: string;
  now: Date;
  rowPx: number;
  bookings: CalendarBooking[];
  isToday: boolean;
  firstOfDay: boolean;
  focus: { lane: number; row: number };
  onFocusCell: (row: number) => void;
  cellState: (row: number) => CellState;
  mayBook: boolean;
  onActivate: (row: number) => void;
}) {
  const { column, person } = lane;
  const clock = zoneClock(zone);
  const placed = bookings
    .map((booking) => ({ booking, at: place(booking, column) }))
    .filter((p): p is { booking: CalendarBooking; at: { top: number; height: number } } => !!p.at);
  const laid = layoutOverlaps(
    placed.map((p) => ({ id: p.booking.id, top: p.at.top, height: p.at.height })),
  );
  const nowOffset = isToday ? column.offsetOf(now) : -1;
  const dayLabel = formatInZone(new Date(`${lane.date}T12:00:00Z`), "UTC", "EEEE d MMMM");

  return (
    <div
      className={cn(
        "relative",
        firstOfDay ? "border-l" : "border-l border-l-border/40",
        isToday && "bg-primary-tint/25",
      )}
      style={{ height: column.rows.length * rowPx }}
    >
      {column.rows.map((row, i) => {
        const state = cellState(i);
        const label = describeCell(state, {
          day: dayLabel,
          time: `${row.time}${row.repeated ? " (second time)" : ""}`,
          staff: person.name,
          mayBook,
        });
        const actionable = state.kind === "booking" || (state.kind === "free" && mayBook);
        return (
          <button
            key={i}
            type="button"
            data-cell={`${lane.index}-${i}`}
            tabIndex={focus.lane === lane.index && focus.row === i ? 0 : -1}
            aria-label={label}
            aria-disabled={actionable ? undefined : true}
            onFocus={() => onFocusCell(i)}
            onClick={() => onActivate(i)}
            className={cn(
              "absolute inset-x-0 block w-full",
              row.time.endsWith(":00") && "border-t",
              state.kind === "off" &&
                "bg-[repeating-linear-gradient(135deg,var(--color-border)_0_5px,transparent_5px_10px)]",
              state.kind === "free" && mayBook && "hover:bg-muted",
              "focus-visible:z-30 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
            )}
            style={{ top: i * rowPx, height: rowPx }}
          />
        );
      })}

      {placed.map(({ booking, at: pos }) => {
        const slot = laid.get(booking.id) ?? { lane: 0, lanes: 1 };
        const settled = booking.status === "cancelled" || booking.status === "no_show";
        return (
          <div
            key={booking.id}
            aria-hidden
            className={cn(
              "pointer-events-none absolute z-10 overflow-hidden rounded-md border px-1 py-0.5 text-caption leading-tight",
              booking.status === "completed"
                ? "border-border bg-muted text-foreground"
                : STAFF_BLOCK[person.color],
              booking.status === "pending" && "border-dashed",
              settled && "bg-card line-through",
            )}
            style={{
              top: pos.top * PX + 1,
              height: Math.max(pos.height * PX - 2, 14),
              left: `calc(${(slot.lane / slot.lanes) * 100}% + 2px)`,
              width: `calc(${100 / slot.lanes}% - 4px)`,
            }}
          >
            <span className="block overflow-hidden font-mono whitespace-nowrap tabular-nums">
              {clock.parts(booking.startsAt.getTime()).time}
            </span>
            <span className="block overflow-hidden font-medium whitespace-nowrap">
              {booking.customerName}
            </span>
          </div>
        );
      })}

      {nowOffset >= 0 && nowOffset <= column.lengthMin && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-danger"
          style={{ top: nowOffset * PX }}
        >
          {firstOfDay && (
            <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-danger" />
          )}
        </div>
      )}
    </div>
  );
}

function describeCell(
  state: CellState,
  { day, time, staff, mayBook }: { day: string; time: string; staff: string; mayBook: boolean },
): string {
  const where = `${day}, ${time}, ${staff}`;
  switch (state.kind) {
    case "booking": {
      const b = state.booking;
      return `${where}: ${b.customerName}, ${b.serviceName}, ${STATUS_LABEL[b.status]}. Open booking`;
    }
    case "free":
      return mayBook ? `${where}: free. New booking` : `${where}: free`;
    case "past":
      return `${where}: past`;
    case "off":
      return `${where}: unavailable, ${state.why}`;
  }
}

function NavLink({
  href,
  label,
  children,
}: {
  href: Route;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "flex size-11 items-center justify-center rounded-lg border bg-card hover:bg-muted",
        focusRing,
      )}
    >
      {children}
    </Link>
  );
}

/** Start keyboard focus on today's first lane, at the row for the current time. */
function initialFocus(
  columns: Column[],
  dates: string[],
  today: string,
  now: Date,
  laneCount: number,
): { lane: number; row: number } {
  const d = Math.max(0, dates.indexOf(today));
  const column = columns[d];
  if (!column) return { lane: 0, row: 0 };
  const offset = column.offsetOf(now);
  const row = dates[d] === today ? Math.floor(offset / column.intervalMin) : 0;
  return {
    lane: d * Math.max(1, laneCount),
    row: Math.max(0, Math.min(column.rows.length - 1, row)),
  };
}

/** The current time, the server's first (so hydration matches), then ticking. */
function useNow(initial: Date): Date {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
