import { timeOf } from "./hours";
import { addDays, weekdayOf } from "./today";
import { zoneClock } from "./zone-clock";

/*
 * Layout maths for the calendar (src/app/app/calendar). Pure and client-safe.
 *
 * A column is one local day, cut into rows of the business's slot interval.
 * Two ways to cut it:
 * - realTimeColumn (day view): rows follow real time, so the night the clocks
 *   go back has its repeated hour twice (25 hours), and the night they go
 *   forward skips one (23 hours). Every booking has its own place.
 * - wallClockColumn (week view): every day shares one time axis. A wall time
 *   the clocks skip has a row that doesn't exist (nothing can be booked
 *   there); the repeated hour shares rows with the first one, and bookings in
 *   both sit side by side like any other overlap.
 */

const MIN = 60_000;

export type Row = {
  /** Local "HH:MM". */
  time: string;
  /** The instant the row starts; null for a wall time the clocks skip. */
  start: Date | null;
  /** The second pass through a repeated wall time (clocks going back). */
  repeated: boolean;
};

export type Column = {
  date: string;
  rows: Row[];
  intervalMin: number;
  /** Minutes from the top of the column to `instant` (may be outside the column). */
  offsetOf(instant: Date): number;
  /** The column's length in minutes. */
  lengthMin: number;
};

export type Range = { start: number; end: number };

/** Monday-first dates of the week containing `date`. */
export function weekDates(date: string): string[] {
  const monday = addDays(date, -((weekdayOf(date) + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Minutes in a local day: 1440, or 1380 / 1500 on DST change days. */
export function dayLengthMin(date: string, zone: string): number {
  const clock = zoneClock(zone);
  return (clock.instant(addDays(date, 1), "00:00") - clock.instant(date, "00:00")) / MIN;
}

/** Day view: rows in real time from `range.start` to `range.end` (local minutes). */
export function realTimeColumn(
  date: string,
  zone: string,
  range: Range,
  intervalMin: number,
): Column {
  const clock = zoneClock(zone);
  const at = (minutes: number) =>
    minutes >= 24 * 60
      ? clock.instant(addDays(date, 1), timeOf(minutes - 24 * 60))
      : clock.instant(date, timeOf(minutes));
  const first = at(range.start);
  const last = at(range.end);
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let t = first; t < last; t += intervalMin * MIN) {
    const { time } = clock.parts(t);
    rows.push({ time, start: new Date(t), repeated: seen.has(time) });
    seen.add(time);
  }
  return {
    date,
    rows,
    intervalMin,
    lengthMin: (last - first) / MIN,
    offsetOf: (instant) => (instant.getTime() - first) / MIN,
  };
}

/** Week view: rows on the wall clock, the same for every day. */
export function wallClockColumn(
  date: string,
  zone: string,
  range: Range,
  intervalMin: number,
): Column {
  const clock = zoneClock(zone);
  const dayStart = clock.instant(date, "00:00");
  const dayEnd = clock.instant(addDays(date, 1), "00:00");
  const rows: Row[] = [];
  for (let m = range.start; m < range.end; m += intervalMin) {
    const time = timeOf(m);
    const instant = clock.instant(date, time);
    const exists = clock.parts(instant).time === time && instant >= dayStart && instant < dayEnd;
    rows.push({ time, start: exists ? new Date(instant) : null, repeated: false });
  }
  return {
    date,
    rows,
    intervalMin,
    lengthMin: range.end - range.start,
    offsetOf(instant) {
      const t = instant.getTime();
      if (t <= dayStart) return -range.start + (t - dayStart) / MIN;
      if (t >= dayEnd) return 24 * 60 - range.start + (t - dayEnd) / MIN;
      return clock.parts(t).minutes - range.start;
    },
  };
}

/** Where an event sits in a column, in minutes, clipped; null if it's outside. */
export function place(
  event: { startsAt: Date; endsAt: Date },
  column: Column,
): { top: number; height: number } | null {
  const rawTop = column.offsetOf(event.startsAt);
  let rawBottom = column.offsetOf(event.endsAt);
  // On the wall clock, a booking running through the repeated hour can read
  // as ending before it starts: give it the rest of the column.
  if (rawBottom < rawTop && event.endsAt > event.startsAt) rawBottom = column.lengthMin;
  const top = Math.max(0, rawTop);
  const bottom = Math.min(column.lengthMin, rawBottom);
  if (bottom <= top) return null;
  return { top, height: bottom - top };
}

export type Laid = { lane: number; lanes: number };

/**
 * Side by side for overlapping events: each cluster of events that overlap
 * (directly or through a chain) shares its width between as many lanes as it
 * needs; an event takes the first lane free at its start.
 */
export function layoutOverlaps<T extends { id: string; top: number; height: number }>(
  events: T[],
): Map<string, Laid> {
  const sorted = [...events].sort((a, b) => a.top - b.top || b.height - a.height);
  const result = new Map<string, Laid>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const close = () => {
    for (const item of cluster) result.set(item.id, { lane: item.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const event of sorted) {
    const end = event.top + event.height;
    if (event.top >= clusterEnd) close();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= event.top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    cluster.push({ id: event.id, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  close();
  return result;
}

/** The row a local minute falls in (week view), or -1. */
export function rowIndexAt(column: Column, offsetMin: number): number {
  if (offsetMin < 0 || offsetMin >= column.lengthMin) return -1;
  return Math.floor(offsetMin / column.intervalMin);
}
