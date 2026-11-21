import { Fragment } from "react";

import { timeOf } from "@/lib/hours";
import {
  hoursToSpans,
  localSpan,
  offSegments,
  placement,
  type Span,
  subtract,
  workingUntil,
} from "@/lib/timeline";
import { appointmentState, type AppointmentState } from "@/lib/today";
import { cn } from "@/lib/utils";
import { zoneClock } from "@/lib/zone-clock";
import type { TodayStaff } from "@/server/db/queries/today";

import type { BoardAppointment } from "./today-board";
import { STAFF_AVATAR } from "./staff-colors";

/** Hatched time off gets its label only when there's room for it. */
const MIN_LABEL_MIN = 90;

const BLOCK: Record<AppointmentState, string> = {
  done: "border-transparent bg-muted text-foreground",
  in_progress: "border-primary bg-primary text-primary-foreground",
  upcoming: "border-border bg-card text-foreground",
  unmarked: "border-dashed border-warning-text bg-card text-foreground",
  no_show: "border-danger-text bg-danger-soft text-danger-text line-through",
  cancelled: "hidden",
};

export const STATE_LABEL: Record<AppointmentState, string> = {
  done: "Done",
  in_progress: "In progress",
  upcoming: "Upcoming",
  unmarked: "Not marked yet",
  no_show: "No-show",
  cancelled: "Cancelled",
};

const LEGEND: { state: AppointmentState; swatch: string }[] = [
  { state: "done", swatch: "bg-muted border-transparent" },
  { state: "in_progress", swatch: "bg-primary border-primary" },
  { state: "upcoming", swatch: "bg-card border-muted-foreground" },
  { state: "no_show", swatch: "bg-danger-soft border-danger-text" },
];

/** Today as a timeline per staff member, with a "now" line (desktop and tablet). */
export function Timeline({
  zone,
  now,
  day,
  grid,
  staff,
  appointments,
  mine,
}: {
  zone: string;
  now: Date;
  day: { dayStart: Date; dayEnd: Date };
  grid: Span;
  staff: TodayStaff[];
  appointments: BoardAppointment[];
  mine: boolean;
}) {
  const clock = zoneClock(zone);
  const hours: number[] = [];
  for (let m = grid.start; m <= grid.end; m += 60) hours.push(m);
  const nowMin =
    now >= day.dayStart && now < day.dayEnd ? clock.parts(now.getTime()).minutes : null;
  const nowVisible = nowMin !== null && nowMin >= grid.start && nowMin <= grid.end;
  const nowLeft = nowVisible ? placement({ start: nowMin, end: nowMin }, grid).left : 0;
  const anyUnmarked = appointments.some((a) => appointmentState(a, now) === "unmarked");

  return (
    <section
      aria-labelledby="timeline-title"
      className="hidden flex-col gap-6 rounded-xl border bg-card p-6 md:flex"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="timeline-title" className="text-title">
          {mine ? "Your appointments today" : "Today’s appointments"}
        </h2>
        <ul aria-label="Legend" className="flex flex-wrap gap-x-5 gap-y-1">
          {LEGEND.map(({ state, swatch }) => (
            <li key={state} className="flex items-center gap-2 text-body-sm text-muted-foreground">
              <span aria-hidden className={cn("size-3.5 rounded border", swatch)} />
              {STATE_LABEL[state]}
            </li>
          ))}
          {anyUnmarked && (
            <li className="flex items-center gap-2 text-body-sm text-muted-foreground">
              <span
                aria-hidden
                className="size-3.5 rounded border border-dashed border-warning-text bg-card"
              />
              {STATE_LABEL.unmarked}
            </li>
          )}
        </ul>
      </div>

      <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* Staff labels */}
        <div aria-hidden className="h-8" />
        <div className="relative h-8" aria-hidden>
          {hours.map((m, i) => (
            <span
              key={m}
              className={cn(
                "absolute top-0 font-mono text-caption text-muted-foreground tabular-nums",
                i === 0 ? "" : i === hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${placement({ start: m, end: m }, grid).left}%` }}
            >
              {timeOf(m)}
            </span>
          ))}
        </div>

        {staff.map((person) => {
          const theirs = appointments.filter((a) => a.staffId === person.id);
          const away = person.timeOff.map((t) => localSpan(t, day, zone));
          const working = subtract(hoursToSpans(person.hours), away);
          const until = workingUntil(working, grid);
          const count = `${theirs.length} ${theirs.length === 1 ? "booking" : "bookings"}`;
          const off = offSegments(working, grid);
          return (
            <Fragment key={person.id}>
              <div className="flex h-24 items-center gap-3 border-t">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full text-label",
                    STAFF_AVATAR[person.color],
                  )}
                >
                  {person.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-label">{person.name}</span>
                  <span className="block text-body-sm text-muted-foreground">
                    {count}
                    {until && ` · until ${until}`}
                    {working.length === 0 && " · off today"}
                  </span>
                </span>
              </div>
              <div className="relative h-24 border-t">
                {hours.slice(1, -1).map((m) => (
                  <span
                    key={m}
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-border"
                    style={{ left: `${placement({ start: m, end: m }, grid).left}%` }}
                  />
                ))}
                {off.map((segment) => {
                  const { left, width } = placement(segment, grid);
                  return (
                    <div
                      key={segment.start}
                      className="absolute inset-y-2 flex items-center overflow-hidden rounded-md bg-[repeating-linear-gradient(135deg,var(--color-border)_0_6px,transparent_6px_12px)] px-3"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      {segment.label && segment.end - segment.start >= MIN_LABEL_MIN && (
                        <span className="rounded bg-card px-1 text-body-sm whitespace-nowrap text-foreground">
                          {segment.label}
                        </span>
                      )}
                    </div>
                  );
                })}
                <ul aria-label={`${person.name}'s appointments`}>
                  {theirs.map((a) => {
                    const span = localSpan(a, day, zone);
                    const { left, width } = placement(span, grid);
                    const state = appointmentState(a, now);
                    const time = `${timeOf(span.start)} – ${timeOf(span.end === 1440 ? 0 : span.end)}`;
                    return (
                      <li
                        key={a.id}
                        className={cn(
                          "absolute inset-y-2 overflow-hidden rounded-md border px-2 py-1.5 text-body-sm",
                          BLOCK[state],
                        )}
                        style={{ left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)` }}
                      >
                        <span className="sr-only">
                          {a.customerName}, {a.serviceName}, {time}, {STATE_LABEL[state]}
                        </span>
                        <span aria-hidden className="flex flex-col">
                          <span className="overflow-hidden font-mono whitespace-nowrap tabular-nums">
                            {time}
                          </span>
                          <span className="overflow-hidden text-label whitespace-nowrap">
                            {a.customerName}
                          </span>
                          <span className="overflow-hidden whitespace-nowrap">{a.serviceName}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Fragment>
          );
        })}

        {/* The "now" line spans every row; its label sits under the last one. */}
        <div aria-hidden />
        <div className="relative h-8">
          {nowVisible && (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-full w-0.5 -translate-x-1/2 bg-danger"
                style={{ left: `${nowLeft}%`, height: `${staff.length * 6 + 0.25}rem` }}
              />
              <span
                className="absolute top-1 -translate-x-1/2 rounded-full bg-danger-soft px-2 font-mono text-body-sm whitespace-nowrap text-danger-text tabular-nums"
                style={{ left: `${nowLeft}%` }}
              >
                Now {clock.parts(now.getTime()).time}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
