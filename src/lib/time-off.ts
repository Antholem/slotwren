import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";

import { minutesOf, timeOptions } from "@/lib/hours";

/*
 * Time off is stored as UTC instants (timestamptz) but entered and shown in
 * the business's timezone. All-day time off runs from local midnight on the
 * first day to local midnight after the last, so a day with a DST change is
 * 23 or 25 hours long, not 24.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-06" + "13:30" in `zone` → the UTC instant. */
export function zonedInstant(date: string, time: string, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  return new Date(new TZDate(y, m - 1, d, h, min, zone).getTime());
}

/** An instant as local date and time in `zone`. */
export function zonedParts(instant: Date, zone: string): { date: string; time: string } {
  const local = new TZDate(instant.getTime(), zone);
  return { date: format(local, "yyyy-MM-dd"), time: format(local, "HH:mm") };
}

/** "2026-11-06" → "2026-11-07": calendar arithmetic, no timezone involved. */
export function nextDate(date: string, days = 1): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A local wall-clock time that exists exactly once in `zone` on `date`. */
function existsOnce(date: string, time: string, zone: string): boolean {
  const instant = zonedInstant(date, time, zone);
  const back = zonedParts(instant, zone);
  if (back.date !== date || back.time !== time) return false; // skipped (spring forward)
  // Repeated (fall back): the same wall time an hour later is also this time.
  const later = zonedParts(new Date(instant.getTime() + 3_600_000), zone);
  return !(later.date === date && later.time === time);
}

const isRealDate = (value: string) => {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

export type TimeOffValues = {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reason: string | null;
};

/**
 * The "Add time off" form, converted to instants in `zone`. All day: a date
 * range (inclusive). Part of a day: one date, a start and an end time on the
 * business's slot grid.
 */
export function timeOffSchemaFor(zone: string, intervalMin = 30) {
  const grid = new Set(timeOptions(intervalMin));
  return z
    .object({
      allDay: z.boolean(),
      startDate: z.string().refine(isRealDate, "Pick a date."),
      endDate: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      reason: z
        .string()
        .trim()
        .max(80, "Keep the reason under 80 characters.")
        .transform((value) => value || null),
    })
    .superRefine((v, ctx) => {
      if (v.allDay) {
        if (!isRealDate(v.endDate)) {
          ctx.addIssue({ code: "custom", path: ["endDate"], message: "Pick a date." });
        } else if (v.endDate < v.startDate) {
          ctx.addIssue({
            code: "custom",
            path: ["endDate"],
            message: "End on or after the first day.",
          });
        } else if (v.endDate > nextDate(v.startDate, 365)) {
          ctx.addIssue({ code: "custom", path: ["endDate"], message: "Keep it under a year." });
        }
        return;
      }
      for (const key of ["startTime", "endTime"] as const) {
        if (!grid.has(v[key])) {
          ctx.addIssue({ code: "custom", path: [key], message: "Pick a time from the list." });
        }
      }
      if (!grid.has(v.startTime) || !grid.has(v.endTime) || !isRealDate(v.startDate)) return;
      if (minutesOf(v.endTime) <= minutesOf(v.startTime)) {
        ctx.addIssue({ code: "custom", path: ["endTime"], message: "End after it starts." });
        return;
      }
      for (const key of ["startTime", "endTime"] as const) {
        if (!existsOnce(v.startDate, v[key], zone)) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "The clocks change at that time on this date. Pick another time.",
          });
        }
      }
    })
    .transform((v): TimeOffValues =>
      v.allDay
        ? {
            allDay: true,
            startsAt: zonedInstant(v.startDate, "00:00", zone),
            endsAt: zonedInstant(nextDate(v.endDate), "00:00", zone),
            reason: v.reason,
          }
        : {
            allDay: false,
            startsAt: zonedInstant(v.startDate, v.startTime, zone),
            endsAt: zonedInstant(v.startDate, v.endTime, zone),
            reason: v.reason,
          },
    );
}

export type TimeOffInput = z.input<ReturnType<typeof timeOffSchemaFor>>;

/** A stored range back into form values, in `zone`. */
export function toTimeOffInput(
  entry: { startsAt: Date; endsAt: Date; allDay: boolean; reason: string | null },
  zone: string,
): TimeOffInput {
  const start = zonedParts(entry.startsAt, zone);
  const end = zonedParts(entry.endsAt, zone);
  return {
    allDay: entry.allDay,
    startDate: start.date,
    // All-day ranges end at the next midnight: the last day off is the day before.
    endDate: entry.allDay
      ? zonedParts(new Date(entry.endsAt.getTime() - 1), zone).date
      : start.date,
    startTime: entry.allDay ? "09:00" : start.time,
    endTime: entry.allDay ? "17:00" : end.time,
    reason: entry.reason ?? "",
  };
}

/** "Fri 6 Nov · All day", "Thu 24 – Sat 26 Dec", "Fri 6 Nov · 13:00 – 17:00". */
export function timeOffLabel(
  entry: { startsAt: Date; endsAt: Date; allDay: boolean },
  zone: string,
): string {
  const start = new TZDate(entry.startsAt.getTime(), zone);
  if (!entry.allDay) {
    const end = new TZDate(entry.endsAt.getTime(), zone);
    return `${format(start, "EEE d MMM")} · ${format(start, "HH:mm")} – ${format(end, "HH:mm")}`;
  }
  const last = new TZDate(entry.endsAt.getTime() - 1, zone);
  if (format(start, "yyyy-MM-dd") === format(last, "yyyy-MM-dd")) {
    return `${format(start, "EEE d MMM")} · All day`;
  }
  const sameMonth = format(start, "yyyy-MM") === format(last, "yyyy-MM");
  return `${format(start, sameMonth ? "EEE d" : "EEE d MMM")} – ${format(last, "EEE d MMM")}`;
}

/** Today's date in `zone` ("2026-11-07"), for defaults and the past/upcoming split. */
export const todayIn = (zone: string, now: Date) => zonedParts(now, zone).date;
