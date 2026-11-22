"use client";

import { AppWindow, Globe, Pencil, Sparkle } from "lucide-react";
import { useEffect, useState } from "react";

import type { AppointmentStatus } from "@/lib/today";
import { cn } from "@/lib/utils";
import type { MemberSlot } from "@/server/booking/service";

import { memberSlotsAction } from "../booking-actions";

export type StaffColor = "teal" | "violet" | "pink";

export const STAFF_DOT: Record<StaffColor, string> = {
  teal: "bg-staff-teal",
  violet: "bg-staff-violet",
  pink: "bg-staff-pink",
};

/** Calendar blocks: the staff colour's soft fill, its text colour and its border. */
export const STAFF_BLOCK: Record<StaffColor, string> = {
  teal: "bg-staff-teal-soft text-staff-teal-text border-staff-teal",
  violet: "bg-staff-violet-soft text-staff-violet-text border-staff-violet",
  pink: "bg-staff-pink-soft text-staff-pink-text border-staff-pink",
};

export function StaffName({ name, color }: { name: string; color: StaffColor }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STAFF_DOT[color])} />
      {name}
    </span>
  );
}

const STATUS: Record<AppointmentStatus, { label: string; style: string }> = {
  pending: { label: "Pending", style: "bg-warning-soft text-warning-text" },
  confirmed: { label: "Confirmed", style: "bg-primary-tint text-primary-tint-foreground" },
  completed: { label: "Completed", style: "border border-border bg-card text-foreground" },
  no_show: { label: "No-show", style: "bg-danger-soft text-danger-text" },
  cancelled: { label: "Cancelled", style: "border border-border bg-card text-muted-foreground" },
};

export const STATUS_LABEL = Object.fromEntries(
  Object.entries(STATUS).map(([key, value]) => [key, value.label]),
) as Record<AppointmentStatus, string>;

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { label, style } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-body-sm whitespace-nowrap",
        style,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

const SOURCE = {
  page: { label: "Page", icon: Globe },
  widget: { label: "Widget", icon: AppWindow },
  manual: { label: "Manual", icon: Pencil },
  ai: { label: "AI", icon: Sparkle },
} as const;

/** Where a booking came from: outlined, except the AI receptionist's (tinted, as in the mockups). */
export function SourceBadge({ source }: { source: keyof typeof SOURCE }) {
  const { label, icon: Icon } = SOURCE[source];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-body-sm whitespace-nowrap",
        source === "ai"
          ? "bg-primary-tint text-primary-tint-foreground"
          : "border border-muted-foreground text-foreground",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">Booked through: </span>
      {label}
    </span>
  );
}

export type SlotsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; slots: MemberSlot[] }
  | { status: "error"; message: string };

/**
 * Times the team may book for a service, staff choice and business-local
 * date. `version` reloads after "That time was just taken".
 */
export function useMemberSlots(
  query: {
    serviceId: string;
    staffId: string;
    date: string;
    excludeBookingId?: string;
  } | null,
  version = 0,
): SlotsState {
  const key = query ? JSON.stringify(query) : null;
  const [state, setState] = useState<{ key: string | null; value: SlotsState }>({
    key: null,
    value: { status: "idle" },
  });

  useEffect(() => {
    if (!key) return;
    let live = true;
    memberSlotsAction(JSON.parse(key))
      .then((result) => {
        if (!live) return;
        setState({
          key,
          value: result.ok
            ? { status: "ready", slots: result.data.slots }
            : { status: "error", message: result.error.message },
        });
      })
      .catch(() => {
        if (live) {
          setState({ key, value: { status: "error", message: "Couldn't load times. Try again." } });
        }
      });
    return () => {
      live = false;
    };
  }, [key, version]);

  if (!key) return { status: "idle" };
  return state.key === key ? state.value : { status: "loading" };
}

/** Times as radio chips (arrow keys move between them, as with any radio group). */
export function TimeChips({
  name,
  legend,
  state,
  value,
  onChange,
  staffNames,
  emptyText,
}: {
  name: string;
  legend: string;
  state: SlotsState;
  value: string | null;
  onChange: (slot: MemberSlot) => void;
  /** Show who each time is with ("Anyone available"). */
  staffNames?: Record<string, string>;
  emptyText: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-label">{legend}</legend>
      {state.status === "idle" && (
        <p className="text-body-sm text-muted-foreground">Pick a service and date first.</p>
      )}
      {state.status === "loading" && (
        <div aria-busy="true" aria-label="Loading times" className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="h-11 w-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-body-sm text-danger-text">
          {state.message}
        </p>
      )}
      {state.status === "ready" && state.slots.length === 0 && (
        <p className="text-body-sm text-muted-foreground">{emptyText}</p>
      )}
      {state.status === "ready" && state.slots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {state.slots.map((slot) => {
            const checked = value === slot.start;
            const who = staffNames?.[slot.staffId];
            return (
              <label
                key={`${slot.start}-${slot.staffId}`}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg border px-3 py-1 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={slot.start}
                  checked={checked}
                  onChange={() => onChange(slot)}
                  className="sr-only"
                />
                <span className="font-mono text-body tabular-nums">
                  {slot.time}
                  {slot.repeated && (
                    <span className="text-caption">
                      {slot.repeated === "first" ? " (1st)" : " (2nd)"}
                    </span>
                  )}
                </span>
                {who && <span className="text-caption">{who}</span>}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
