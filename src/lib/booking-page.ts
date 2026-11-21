import type { Route } from "next";

import { formatInZone } from "@/lib/dates";
import { nextDate } from "@/lib/time-off";
import { zoneClock } from "@/lib/zone-clock";

/*
 * The public booking page (/b/[slug]): its data shapes, which are all public
 * fields (tests/integration/public-data.test.ts), and its URL state. Every
 * choice lives in the query string, so Back, reload and shared links work:
 *
 *   ?step=time&service=<id>&staff=<id|any>&date=2026-11-24&start=<ISO>
 *
 * `date` is a date in the customer's timezone; `start` is an instant.
 */

export type PublicBusinessProfile = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
  address: string | null;
  timezone: string;
  currency: string;
  cancellationWindowHours: number;
  maxDaysAhead: number;
  /** Opening hours for display ("Open today 9:00 – 18:00"). */
  openingHours: { weekday: number; start: string; end: string }[];
};

export type PublicService = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

export type PublicStaff = {
  id: string;
  name: string;
  title: string | null;
  color: "teal" | "violet" | "pink";
  /** Bookable services this person performs. */
  serviceIds: string[];
};

export type BookingPageData = {
  business: PublicBusinessProfile;
  services: PublicService[];
  staff: PublicStaff[];
};

/** A start time as the customer's clock shows it. */
export type SlotChip = {
  start: string;
  end: string;
  /** Who it would be with; null on taken times. */
  staffId: string | null;
  date: string;
  time: string;
  /** "+08:00" */
  offset: string;
  /** "GMT+8", "EDT" */
  zone: string;
  /** The night the clocks go back, "01:30" happens twice. */
  repeated: "first" | "second" | null;
};

export type DaySlots = { available: SlotChip[]; taken: SlotChip[] };

/** GET /api/slots/[slug]: a window of days in the customer's timezone. */
export type SlotsResponse = {
  /** By customer-local date. Dates with no hours at all are absent. */
  days: Record<string, DaySlots>;
  /** The first opening at or after the window's end, within the booking window. */
  next: SlotChip | null;
};

export type PublicBookingConfirmation = {
  id: string;
  code: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  startsAt: Date;
  endsAt: Date;
  serviceName: string;
  durationMin: number;
  staffName: string;
  priceCents: number;
};

export const STEPS = ["service", "staff", "time", "details"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  service: "Service",
  staff: "Staff",
  time: "Date and time",
  details: "Your details",
};

export type BookingState = {
  step: Step;
  serviceId: string | null;
  /** A staff ID or "any" ("Anyone available", the default). */
  staffId: string;
  /** Customer-local "YYYY-MM-DD" being looked at on the time step. */
  date: string | null;
  /** The chosen start instant (ISO). */
  start: string | null;
  /** A start that was just taken (shows the "just taken" panel). */
  taken: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value.length <= 64 ? value : null;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isInstant = (value: string | null): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && !Number.isNaN(Date.parse(value));

/**
 * The booking state in a URL, checked against what this business offers. A
 * step whose earlier choices are missing falls back to the first missing one,
 * and anything unknown (an archived service, someone who left) is dropped.
 */
export function parseBookingState(params: SearchParams, data: BookingPageData): BookingState {
  const serviceParam = one(params.service);
  const service = data.services.find((s) => s.id === serviceParam) ?? null;
  const staffParam = one(params.staff);
  const staffId =
    service && staffParam && staffParam !== "any"
      ? (data.staff.find((p) => p.id === staffParam && p.serviceIds.includes(service.id))?.id ??
        "any")
      : "any";
  const dateParam = one(params.date);
  const date = dateParam && DATE.test(dateParam) ? dateParam : null;
  const startParam = one(params.start);
  const start = isInstant(startParam) ? new Date(startParam).toISOString() : null;
  const takenParam = one(params.taken);
  const taken = isInstant(takenParam) ? new Date(takenParam).toISOString() : null;

  const wanted = STEPS.includes(params.step as Step) ? (params.step as Step) : "service";
  let step: Step = wanted;
  if (!service) step = "service";
  else if (wanted === "details" && !start) step = "time";

  return { step, serviceId: service?.id ?? null, staffId, date, start, taken };
}

/** The query string for a booking state (only what's set). */
export function bookingSearch(state: Partial<BookingState>): string {
  const params = new URLSearchParams();
  if (state.step && state.step !== "service") params.set("step", state.step);
  if (state.serviceId) params.set("service", state.serviceId);
  if (state.serviceId && state.staffId) params.set("staff", state.staffId);
  if (state.date) params.set("date", state.date);
  if (state.start) params.set("start", state.start);
  if (state.taken) params.set("taken", state.taken);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const bookingHref = (slug: string, state: Partial<BookingState>) =>
  `/b/${slug}${bookingSearch(state)}` as Route;

export type Period = "morning" | "afternoon" | "evening";
export const PERIODS: { id: Period; label: string }[] = [
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
];

/** Morning before 12:00, afternoon until 17:00, evening after. */
export function periodOf(time: string): Period {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/**
 * The `count` openings closest to `target` (an instant), in time order: what
 * to offer when the time a customer picked was just taken.
 */
export function nearestOpenings(slots: SlotChip[], target: string, count = 3): SlotChip[] {
  const at = Date.parse(target);
  return [...slots]
    .filter((slot) => slot.start !== target)
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.start) - at) - Math.abs(Date.parse(b.start) - at) ||
        Date.parse(a.start) - Date.parse(b.start),
    )
    .slice(0, count)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** "01:30", or "01:30 EDT" on the night the clocks go back. */
export const chipLabel = (slot: Pick<SlotChip, "time" | "zone" | "repeated">) =>
  slot.repeated ? `${slot.time} ${slot.zone}` : slot.time;

/** "Free cancellation up to 24 h before" */
export function cancellationPolicy(hours: number): string {
  if (hours <= 0) return "Free cancellation until your appointment starts";
  if (hours % 24 === 0 && hours >= 48) return `Free cancellation up to ${hours / 24} days before`;
  return `Free cancellation up to ${hours} h before`;
}

/**
 * "Today", "Tomorrow", "Tue" (within the week) or "Tue 3 Nov", for an
 * instant on the customer's clock relative to `now`.
 */
export function relativeDay(instant: string | Date, zone: string, now: Date): string {
  const clock = zoneClock(zone);
  const day = clock.parts(new Date(instant).getTime()).date;
  const today = clock.parts(now.getTime()).date;
  if (day === today) return "Today";
  if (day === nextDate(today)) return "Tomorrow";
  const date = new Date(instant);
  return day < nextDate(today, 7)
    ? formatInZone(date, zone, "EEE")
    : formatInZone(date, zone, "EEE d MMM");
}

// ── The manage page (/m/[token]) ────────────────────────────────────────

export type ManageStep = "view" | "time" | "confirm";

export type ManageState = {
  step: ManageStep;
  /** Customer-local date on the time step. */
  date: string | null;
  /** The new start being confirmed. */
  start: string | null;
  /** A start that was just taken. */
  taken: string | null;
  /** Banners after a change: "moved" or "cancelled". */
  done: "moved" | "cancelled" | null;
};

/** The manage page's URL state. Confirm without a start falls back to the times. */
export function parseManageState(params: SearchParams): ManageState {
  const stepParam = one(params.step);
  const dateParam = one(params.date);
  const startParam = one(params.start);
  const takenParam = one(params.taken);
  const doneParam = one(params.done);
  const start = isInstant(startParam) ? new Date(startParam).toISOString() : null;
  let step: ManageStep = stepParam === "time" || stepParam === "confirm" ? stepParam : "view";
  if (step === "confirm" && !start) step = "time";
  return {
    step,
    date: dateParam && DATE.test(dateParam) ? dateParam : null,
    start,
    taken: isInstant(takenParam) ? new Date(takenParam).toISOString() : null,
    done: doneParam === "moved" || doneParam === "cancelled" ? doneParam : null,
  };
}

/** A manage-page URL. The time picker's "details" step is our "confirm". */
export function manageHref(
  token: string,
  state: Partial<Omit<ManageState, "step">> & { step?: ManageStep | Step },
): Route {
  const params = new URLSearchParams();
  const step = state.step === "details" ? "confirm" : state.step;
  if (step === "time" || step === "confirm") params.set("step", step);
  if (state.date) params.set("date", state.date);
  if (state.start && step === "confirm") params.set("start", state.start);
  if (state.taken) params.set("taken", state.taken);
  if (state.done) params.set("done", state.done);
  const query = params.toString();
  return `/m/${token}${query ? `?${query}` : ""}` as Route;
}

/** "about 22 h from now", "about 3 days from now", "in less than an hour". */
export function fromNow(instant: Date, now: Date): string {
  const minutes = (instant.getTime() - now.getTime()) / 60_000;
  if (minutes < 60) return "in less than an hour";
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `about ${hours} h from now`;
  return `about ${Math.round(hours / 24)} days from now`;
}

/**
 * The last date, on the customer's clock, that can hold a bookable time. The
 * business takes bookings up to `maxDaysAhead` days after its own today
 * (server/booking/slots.ts), so a customer ahead of or behind it may see that
 * last day end a calendar day later or earlier.
 */
export function lastBookableDate(
  now: Date,
  business: { timezone: string; maxDaysAhead: number },
  customerZone: string,
): string {
  const clock = zoneClock(business.timezone);
  const lastDate = nextDate(clock.parts(now.getTime()).date, business.maxDaysAhead);
  const lastInstant = clock.instant(nextDate(lastDate, 1), "00:00") - 1;
  return zoneClock(customerZone).parts(lastInstant).date;
}
