import { zoneClock } from "./zone-clock";

/*
 * The Today page's clock: business-local day and week boundaries as instants,
 * the greeting, and what state an appointment is in right now. Pure and
 * client-safe; every boundary goes through zoneClock, so a 23- or 25-hour DST
 * day still starts and ends at local midnight.
 */

const DAY_MS = 86_400_000;

/** "2026-11-03" plus `days` (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type TodayRanges = {
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  weekday: number;
  dayStart: Date;
  dayEnd: Date;
  /** This week, Monday 00:00 to next Monday 00:00, local. */
  weekStart: Date;
  weekEnd: Date;
  lastWeekStart: Date;
  /** For the no-show rate: the 30 days before `now`. */
  last30Start: Date;
};

/** Business-local boundaries around `now` in `zone`. */
export function todayRanges(now: Date, zone: string): TodayRanges {
  const clock = zoneClock(zone);
  const midnight = (date: string) => new Date(clock.instant(date, "00:00"));
  const date = clock.parts(now.getTime()).date;
  const weekday = weekdayOf(date);
  const monday = addDays(date, -((weekday + 6) % 7));
  return {
    date,
    weekday,
    dayStart: midnight(date),
    dayEnd: midnight(addDays(date, 1)),
    weekStart: midnight(monday),
    weekEnd: midnight(addDays(monday, 7)),
    lastWeekStart: midnight(addDays(monday, -7)),
    last30Start: new Date(now.getTime() - 30 * DAY_MS),
  };
}

/** "Good morning" before 12:00, "Good afternoon" before 18:00, then "Good evening". */
export function greetingAt(now: Date, zone: string): string {
  const { minutes } = zoneClock(zone).parts(now.getTime());
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 18 * 60) return "Good afternoon";
  return "Good evening";
}

export type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

/**
 * What the dashboard shows for an appointment at `now`:
 * done, no-show and cancelled are settled; an active one is upcoming, in
 * progress, or ended without being marked ("unmarked": it still needs Complete
 * or No-show).
 */
export type AppointmentState =
  "done" | "no_show" | "cancelled" | "upcoming" | "in_progress" | "unmarked";

export function appointmentState(
  appointment: { status: AppointmentStatus; startsAt: Date; endsAt: Date },
  now: Date,
): AppointmentState {
  switch (appointment.status) {
    case "completed":
      return "done";
    case "no_show":
      return "no_show";
    case "cancelled":
      return "cancelled";
    default: {
      const t = now.getTime();
      if (t < appointment.startsAt.getTime()) return "upcoming";
      if (t < appointment.endsAt.getTime()) return "in_progress";
      return "unmarked";
    }
  }
}

/** Week-on-week change in whole percent, or null with nothing to compare against. */
export function weekChange(thisWeek: number, lastWeek: number): number | null {
  if (lastWeek === 0) return null;
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
}

/** No-show rate as "3.1%", or null when nothing has been marked yet. */
export function noShowRate(noShows: number, marked: number): string | null {
  if (marked === 0) return null;
  return `${((noShows / marked) * 100).toFixed(1).replace(/\.0$/, "")}%`;
}
