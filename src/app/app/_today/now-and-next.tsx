"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { appointmentState, type AppointmentState } from "@/lib/today";
import { cn } from "@/lib/utils";
import { zoneClock } from "@/lib/zone-clock";
import type { TodayStaff } from "@/server/db/queries/today";

import { STAFF_DOT } from "./staff-colors";
import { STATE_LABEL } from "./timeline";
import type { BoardAppointment } from "./today-board";

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * "Now and next": every appointment still to settle today, in order. That
 * includes ones that ended without being marked. Complete and No-show unlock
 * when an appointment starts; Cancel is always there. On phones, chips filter
 * by staff member and "Earlier today" holds what's settled (the timeline
 * shows it on wider screens).
 */
export function NowAndNext({
  zone,
  now,
  staff,
  appointments,
  onMark,
  onCancel,
  className,
}: {
  zone: string;
  now: Date;
  staff: TodayStaff[];
  appointments: BoardAppointment[];
  onMark: (appointment: BoardAppointment, outcome: "completed" | "no_show") => void;
  onCancel: (appointment: BoardAppointment) => void;
  className?: string;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const earlierId = useId();
  const time = (date: Date) => zoneClock(zone).parts(date.getTime()).time;

  const visible = appointments.filter((a) => !filter || a.staffId === filter);
  const open = visible.filter((a) => a.status === "pending" || a.status === "confirmed");
  const settled = visible.filter((a) => a.status === "completed" || a.status === "no_show");
  const done = settled.filter((a) => a.status === "completed").length;
  const noShows = settled.length - done;

  return (
    <section
      aria-labelledby="now-next"
      className={cn("flex flex-col gap-4 md:rounded-xl md:border md:bg-card md:p-6", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="now-next" className="text-title">
          Now and next
        </h2>
        {staff.length > 1 && (
          <div role="group" aria-label="Show staff" className="flex flex-wrap gap-2 md:hidden">
            {[{ id: null, name: "All" }, ...staff].map((person) => (
              <button
                key={person.id ?? "all"}
                type="button"
                aria-pressed={filter === person.id}
                onClick={() => setFilter(person.id)}
                className={cn(
                  "min-h-11 rounded-full border px-4 text-label",
                  filter === person.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-muted-foreground bg-card text-foreground",
                  focusRing,
                )}
              >
                {person.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {open.length === 0 ? (
        <p className="rounded-xl border bg-card p-5 text-body text-muted-foreground md:border-0 md:p-0">
          {settled.length > 0 ? "All done for today." : "Nothing else today."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3 md:gap-0">
          {open.map((a) => (
            <Item
              key={a.id}
              appointment={a}
              state={appointmentState(a, now)}
              time={time}
              onMark={onMark}
              onCancel={onCancel}
            />
          ))}
        </ul>
      )}

      {settled.length > 0 && (
        <div className="md:hidden">
          <button
            type="button"
            aria-expanded={earlierOpen}
            aria-controls={earlierId}
            onClick={() => setEarlierOpen((v) => !v)}
            className={cn(
              "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border bg-card px-5 text-left text-body",
              focusRing,
            )}
          >
            <span>
              Earlier today · {done} done
              {noShows > 0 && ` · ${noShows} no-show`}
            </span>
            <ChevronDown
              aria-hidden
              className={cn("size-5 shrink-0 transition-transform", earlierOpen && "rotate-180")}
            />
          </button>
          <ul id={earlierId} hidden={!earlierOpen} className="mt-3 flex flex-col gap-3">
            {settled.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-body tabular-nums">
                    {time(a.startsAt)} – {time(a.endsAt)}
                  </span>
                  <Badge state={a.status === "completed" ? "done" : "no_show"} status={a.status} />
                </div>
                <span className="text-label">{a.customerName}</span>
                <ServiceLine appointment={a} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Item({
  appointment: a,
  state,
  time,
  onMark,
  onCancel,
}: {
  appointment: BoardAppointment;
  state: AppointmentState;
  time: (date: Date) => string;
  onMark: (appointment: BoardAppointment, outcome: "completed" | "no_show") => void;
  onCancel: (appointment: BoardAppointment) => void;
}) {
  const id = useId();
  const locked = state === "upcoming";
  const start = time(a.startsAt);
  return (
    <li className="flex flex-col gap-4 rounded-xl border bg-card p-5 md:rounded-none md:border-0 md:border-t md:bg-transparent md:px-0 md:py-5">
      <div className="flex items-start justify-between gap-3 md:grid md:grid-cols-[9rem_minmax(0,1fr)_auto]">
        <span id={id} className="sr-only">
          {a.customerName}, {a.serviceName} with {a.staffName}, {start} to {time(a.endsAt)}
        </span>
        <span className="font-mono text-title tabular-nums md:text-body">
          {start} – {time(a.endsAt)}
        </span>
        <span className="hidden min-w-0 md:flex md:flex-col">
          <span className="text-label">{a.customerName}</span>
          <ServiceLine appointment={a} />
        </span>
        <Badge state={state} status={a.status} />
      </div>
      <div className="-mt-3 flex flex-col md:hidden">
        <span className="text-label">{a.customerName}</span>
        <ServiceLine appointment={a} />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap md:pl-[9.75rem]">
        <Button
          type="button"
          variant="secondary"
          disabled={locked}
          aria-describedby={id}
          onClick={() => onMark(a, "completed")}
          className="h-11 px-4 text-label"
        >
          <Check aria-hidden className="hidden sm:block" />
          Complete
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={locked}
          aria-describedby={id}
          onClick={() => onMark(a, "no_show")}
          className="h-11 px-4 text-label"
        >
          No-show
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-describedby={id}
          onClick={() => onCancel(a)}
          className="h-11 px-4 text-label text-danger-text hover:text-danger-text"
        >
          Cancel
        </Button>
      </div>
      {locked && (
        <p className="text-body-sm text-muted-foreground md:pl-[9.75rem]">
          Complete and No-show unlock at <span className="font-mono tabular-nums">{start}</span>
        </p>
      )}
    </li>
  );
}

function ServiceLine({ appointment: a }: { appointment: BoardAppointment }) {
  return (
    <span className="flex items-center gap-1.5 text-body text-muted-foreground">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STAFF_DOT[a.staffColor])} />
      <span className="truncate">
        {a.serviceName} · {a.staffName}
      </span>
    </span>
  );
}

function Badge({ state, status }: { state: AppointmentState; status: BoardAppointment["status"] }) {
  const label =
    state === "upcoming" ? (status === "pending" ? "Pending" : "Confirmed") : STATE_LABEL[state];
  const style =
    state === "in_progress"
      ? "bg-primary text-primary-foreground"
      : state === "upcoming"
        ? status === "pending"
          ? "bg-warning-soft text-warning-text"
          : "bg-primary-tint text-primary-tint-foreground"
        : state === "unmarked"
          ? "border border-warning-text bg-card text-warning-text"
          : state === "no_show"
            ? "bg-danger-soft text-danger-text"
            : "border border-border bg-card text-foreground";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-body-sm whitespace-nowrap",
        style,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
