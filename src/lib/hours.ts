import { z } from "zod";

/*
 * Weekly working hours as edited in onboarding (and later the staff hours
 * editor). Times are local wall-clock "HH:MM" in the business timezone, on the
 * half hour. Weekdays use JS getDay numbering: 0 = Sunday … 6 = Saturday.
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

/** "00:00", "00:30", … "23:30" */
export const HALF_HOURS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

export type TimeRange = { start: string; end: string };
export type DayHours = { weekday: number; open: boolean; ranges: TimeRange[] };

export const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** "09:00" → "9:00" for prose. */
export const prettyTime = (time: string) => time.replace(/^0(\d)/, "$1");

/** Mon–Fri 9:00–17:00, weekends closed. */
export function defaultWeek(): DayHours[] {
  return WEEK_ORDER.map((weekday) => ({
    weekday,
    open: weekday >= 1 && weekday <= 5,
    ranges: [{ start: "09:00", end: "17:00" }],
  }));
}

const timeSchema = z
  .string()
  .refine((t) => HALF_HOURS.includes(t), "Pick a time on the hour or half hour.");

const daySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  open: z.boolean(),
  ranges: z
    .array(z.object({ start: timeSchema, end: timeSchema }))
    .max(MAX_RANGES_PER_DAY, `Up to ${MAX_RANGES_PER_DAY} ranges a day.`),
});

export const weekSchema = z
  .array(daySchema)
  .length(7)
  .superRefine((days, ctx) => {
    if (new Set(days.map((d) => d.weekday)).size !== 7) {
      ctx.addIssue({ code: "custom", message: "Each weekday must appear once." });
      return;
    }
    if (!days.some((d) => d.open)) {
      ctx.addIssue({ code: "custom", message: "Open at least one day so customers can book." });
    }
    days.forEach((day, dayIndex) => {
      if (!day.open) return;
      if (day.ranges.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: [dayIndex, "ranges"],
          message: `Add opening hours for ${WEEKDAY_NAMES[day.weekday]} or mark it closed.`,
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

/** "9:00 – 18:00" when every open day shares the same hours, else null. */
export function sharedHours(days: DayHours[]): string | null {
  const open = days.filter((d) => d.open && d.ranges.length > 0);
  if (open.length === 0) return null;
  const key = (d: DayHours) => d.ranges.map((r) => `${r.start}-${r.end}`).join(",");
  if (!open.every((d) => key(d) === key(open[0]!))) return null;
  return open[0]!.ranges.map((r) => `${prettyTime(r.start)} – ${prettyTime(r.end)}`).join(", ");
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
