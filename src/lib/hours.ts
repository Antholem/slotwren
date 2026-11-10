import { z } from "zod";

/*
 * Weekly hours as edited in onboarding and the staff hours editor. Times are
 * local wall-clock "HH:MM" in the business timezone, on the business's slot
 * grid (15 or 30 min). Weekdays use JS getDay numbering: 0 = Sunday … 6 = Saturday.
 */

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Display order: the week starts on Monday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const MAX_RANGES_PER_DAY = 4;

/** Every start time on a grid of `intervalMin` minutes: "00:00", "00:30", … */
export function timeOptions(intervalMin: number): string[] {
  return Array.from({ length: (24 * 60) / intervalMin }, (_, i) => timeOf(i * intervalMin));
}

export type TimeRange = { start: string; end: string };
export type DayHours = { weekday: number; open: boolean; ranges: TimeRange[] };

export const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** "09:00" → "9:00" for prose. */
export const prettyTime = (time: string) => time.replace(/^0(\d)/, "$1");

/** 570 → "09:30" */
export function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export const isOnGrid = (time: string, intervalMin: number) => minutesOf(time) % intervalMin === 0;

/**
 * A range moved onto the grid without growing it: the start rounds later and
 * the end earlier, so nobody ends up booked outside the hours they set.
 * Null when nothing is left (09:10 – 09:50 on a 30-minute grid).
 */
export function roundRangeInward(range: TimeRange, intervalMin: number): TimeRange | null {
  const start = Math.ceil(minutesOf(range.start) / intervalMin) * intervalMin;
  const end = Math.floor(minutesOf(range.end) / intervalMin) * intervalMin;
  return end > start ? { start: timeOf(start), end: timeOf(end) } : null;
}

/** Every range rounded inward; an open day left without hours closes. */
export function roundWeekInward(days: DayHours[], intervalMin: number): DayHours[] {
  return days.map((day) => {
    if (!day.open) return day;
    const ranges = day.ranges
      .map((range) => roundRangeInward(range, intervalMin))
      .filter((range): range is TimeRange => range !== null);
    return ranges.length > 0 ? { ...day, ranges } : { ...day, open: false, ranges: day.ranges };
  });
}

/** Whether every range of every open day sits on the grid. */
export const weekOnGrid = (days: DayHours[], intervalMin: number) =>
  days.every(
    (day) =>
      !day.open ||
      day.ranges.every((r) => isOnGrid(r.start, intervalMin) && isOnGrid(r.end, intervalMin)),
  );

/** Mon–Fri 9:00–17:00, weekends closed. */
export function defaultWeek(): DayHours[] {
  return WEEK_ORDER.map((weekday) => ({
    weekday,
    open: weekday >= 1 && weekday <= 5,
    ranges: [{ start: "09:00", end: "17:00" }],
  }));
}

const gridMessage = (intervalMin: number) =>
  intervalMin === 30
    ? "Pick a time on the hour or half hour."
    : `Pick a time on the ${intervalMin}-minute grid.`;

/**
 * A week of hours on the business's slot grid: each weekday once, every
 * range ending after it starts, no overlaps within a day. Businesses need at
 * least one open day (`requireOpenDay`); a staff member may be off all week.
 */
export function weekSchemaFor({
  intervalMin = 30,
  requireOpenDay = true,
}: { intervalMin?: number; requireOpenDay?: boolean } = {}) {
  const options = new Set(timeOptions(intervalMin));
  const timeSchema = z.string().refine((t) => options.has(t), gridMessage(intervalMin));
  const daySchema = z.object({
    weekday: z.number().int().min(0).max(6),
    open: z.boolean(),
    ranges: z
      .array(z.object({ start: timeSchema, end: timeSchema }))
      .max(MAX_RANGES_PER_DAY, `Up to ${MAX_RANGES_PER_DAY} ranges a day.`),
  });

  return z
    .array(daySchema)
    .length(7)
    .superRefine((days, ctx) => {
      if (new Set(days.map((d) => d.weekday)).size !== 7) {
        ctx.addIssue({ code: "custom", message: "Each weekday must appear once." });
        return;
      }
      if (requireOpenDay && !days.some((d) => d.open)) {
        ctx.addIssue({ code: "custom", message: "Open at least one day so customers can book." });
      }
      days.forEach((day, dayIndex) => {
        if (!day.open) return;
        if (day.ranges.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: [dayIndex, "ranges"],
            message: `Add hours for ${WEEKDAY_NAMES[day.weekday]} or mark it closed.`,
          });
        }
        day.ranges.forEach((range, rangeIndex) => {
          if (minutesOf(range.end) <= minutesOf(range.start)) {
            ctx.addIssue({
              code: "custom",
              path: [dayIndex, "ranges", rangeIndex, "end"],
              message: "End after it starts.",
            });
          }
        });
        const sorted = [...day.ranges].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
        for (let i = 1; i < sorted.length; i++) {
          if (minutesOf(sorted[i]!.start) < minutesOf(sorted[i - 1]!.end)) {
            ctx.addIssue({
              code: "custom",
              path: [dayIndex, "ranges"],
              message: `${WEEKDAY_NAMES[day.weekday]}'s hours overlap.`,
            });
            break;
          }
        }
      });
    });
}

/** Onboarding's "When are you open?": half-hour grid, at least one open day. */
export const weekSchema = weekSchemaFor();

/** Minutes a day's ranges add up to (closed days count 0). */
export function dayMinutes(day: DayHours): number {
  if (!day.open) return 0;
  return day.ranges.reduce((sum, r) => sum + Math.max(0, minutesOf(r.end) - minutesOf(r.start)), 0);
}

/** "9 h", "4 h 30 min", "–" */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "–";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : null, m ? `${m} min` : null].filter(Boolean).join(" ");
}

export type OpeningRange = { weekday: number; start: string; end: string };

/**
 * Staff hours that fall outside the business's opening hours: a soft check,
 * shown as a warning (people do prep before opening). One message per day.
 */
export function hoursOutsideOpening(days: DayHours[], opening: OpeningRange[]): string[] {
  const warnings: string[] = [];
  for (const weekday of WEEK_ORDER) {
    const day = days.find((d) => d.weekday === weekday);
    if (!day?.open || day.ranges.length === 0) continue;
    const open = opening.filter((o) => o.weekday === weekday);
    const name = WEEKDAY_NAMES[weekday];
    if (open.length === 0) {
      warnings.push(`${name}: the business is closed that day.`);
      continue;
    }
    // Every minute of every staff range must sit inside some opening range.
    const outside = day.ranges.some((range) => {
      let cursor = minutesOf(range.start);
      const end = minutesOf(range.end);
      const sorted = [...open].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
      for (const o of sorted) {
        if (minutesOf(o.start) <= cursor && minutesOf(o.end) > cursor) cursor = minutesOf(o.end);
        if (cursor >= end) return false;
      }
      return cursor < end;
    });
    if (outside) {
      const hours = open.map((o) => `${o.start} – ${o.end}`).join(", ");
      warnings.push(`${name}: outside opening hours (${hours}).`);
    }
  }
  return warnings;
}

/** Opening ranges as editor days, or null when the business hasn't set any. */
export function openingWeek(opening: OpeningRange[] | null | undefined): DayHours[] | null {
  if (!opening || opening.length === 0) return null;
  return fromAvailabilityRows(
    opening.map((o) => ({ weekday: o.weekday, startTime: o.start, endTime: o.end })),
  );
}

/** "6 days open. Mondays closed." */
export function summarizeWeek(days: DayHours[]): string {
  const open = days.filter((d) => d.open);
  if (open.length === 0) return "Closed every day.";
  const count = `${open.length} ${open.length === 1 ? "day" : "days"} open.`;
  if (open.length === 7) return "Open every day.";
  const closed = WEEK_ORDER.filter((w) => !open.some((d) => d.weekday === w)).map(
    (w) => `${WEEKDAY_NAMES[w]}s`,
  );
  const list =
    closed.length === 1
      ? closed[0]
      : `${closed.slice(0, -1).join(", ")} and ${closed[closed.length - 1]}`;
  return `${count} ${list} closed.`;
}

/** Open weekdays as "Tue – Sun", "Mon – Fri", "Mon, Wed, Fri" or "Every day". */
export function describeOpenDays(days: DayHours[]): string {
  const openSet = new Set(days.filter((d) => d.open).map((d) => d.weekday));
  if (openSet.size === 7) return "Every day";
  if (openSet.size === 0) return "";
  const flags = WEEK_ORDER.map((w) => openSet.has(w));
  // Runs of consecutive open days in Monday-first order.
  const runs: [number, number][] = [];
  flags.forEach((isOpen, i) => {
    if (!isOpen) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  });
  const name = (i: number) => SHORT[WEEK_ORDER[i]!];
  return runs
    .map(([from, to]) =>
      from === to
        ? name(from)
        : to === from + 1
          ? `${name(from)}, ${name(to)}`
          : `${name(from)} – ${name(to)}`,
    )
    .join(", ");
}

/**
 * "9:00 – 18:00" when every open day shares the same hours, else null.
 * `padded` keeps "09:00" for monospaced, tabular places.
 */
export function sharedHours(days: DayHours[], { padded = false } = {}): string | null {
  const open = days.filter((d) => d.open && d.ranges.length > 0);
  if (open.length === 0) return null;
  const key = (d: DayHours) => d.ranges.map((r) => `${r.start}-${r.end}`).join(",");
  if (!open.every((d) => key(d) === key(open[0]!))) return null;
  const time = padded ? (t: string) => t : prettyTime;
  return open[0]!.ranges.map((r) => `${time(r.start)} – ${time(r.end)}`).join(", ");
}

/** Flatten to availability_rules rows. */
export function toAvailabilityRows(days: DayHours[]) {
  return days.flatMap((day) =>
    day.open
      ? day.ranges.map((r) => ({ weekday: day.weekday, startTime: r.start, endTime: r.end }))
      : [],
  );
}

/** Rebuild the editor's week from availability_rules rows ("09:00:00" or "09:00"). */
export function fromAvailabilityRows(
  rows: { weekday: number; startTime: string; endTime: string }[],
): DayHours[] {
  if (rows.length === 0) return defaultWeek();
  return WEEK_ORDER.map((weekday) => {
    const ranges = rows
      .filter((r) => r.weekday === weekday)
      .map((r) => ({ start: r.startTime.slice(0, 5), end: r.endTime.slice(0, 5) }))
      .sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
    return ranges.length > 0
      ? { weekday, open: true, ranges }
      : { weekday, open: false, ranges: [{ start: "09:00", end: "17:00" }] };
  });
}

/** "Open Tue – Sun · 9:00 – 18:00" for previews and the "You're live" page. */
export function openingSummary(days: DayHours[]): string {
  const when = describeOpenDays(days);
  if (!when) return "Closed";
  return `Open ${when} · ${sharedHours(days) ?? "hours vary by day"}`;
}

/**
 * A staff card's hours, grouping consecutive days that share hours:
 * "Tue – Sun · 09:00 – 18:00" when every open day matches, otherwise
 * "Tue – Sat 09:00 – 18:00 · Sun 09:00 – 13:00". Times stay "HH:MM" for
 * the mono column.
 */
export function weeklyHoursLabel(days: DayHours[]): string {
  const open = days.filter((d) => d.open && d.ranges.length > 0);
  if (open.length === 0) return "No hours set";
  const short = (weekday: number) => WEEKDAY_NAMES[weekday]!.slice(0, 3);
  const hoursOf = (d: DayHours) => d.ranges.map((r) => `${r.start} – ${r.end}`).join(", ");

  // Runs of consecutive (Monday-first) open days with identical hours.
  const runs: { from: number; to: number; hours: string }[] = [];
  for (const weekday of WEEK_ORDER) {
    const day = open.find((d) => d.weekday === weekday);
    const last = runs.at(-1);
    const previous = WEEK_ORDER[WEEK_ORDER.indexOf(weekday) - 1];
    if (day && last && last.to === previous && last.hours === hoursOf(day)) last.to = weekday;
    else if (day) runs.push({ from: weekday, to: weekday, hours: hoursOf(day) });
  }
  const span = (run: (typeof runs)[number]) =>
    run.from === run.to ? short(run.from) : `${short(run.from)} – ${short(run.to)}`;

  if (new Set(runs.map((r) => r.hours)).size === 1 && runs.length === 1) {
    return `${span(runs[0]!)} · ${runs[0]!.hours}`;
  }
  return runs.map((run) => `${span(run)} ${run.hours}`).join(" · ");
}
