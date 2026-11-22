import { addDays, weekdayOf } from "./today";
import { zoneClock } from "./zone-clock";

/*
 * Insights (src/app/app/insights): which weeks a range covers, as business-
 * local Mondays and the instants between them. Every boundary is local
 * midnight through zoneClock, so a week with a DST change is 167 or 169 hours
 * long and still holds exactly its own seven days. Client-safe and pure.
 */

export const INSIGHT_RANGES = ["4w", "12w", "year"] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];

export const RANGE_LABEL: Record<InsightRange, string> = {
  "4w": "4 weeks",
  "12w": "12 weeks",
  year: "This year",
};

export type InsightWeeks = {
  /** Monday of each week, oldest first, "YYYY-MM-DD". */
  mondays: string[];
  /** Week boundaries: mondays.length + 1 instants, the last one next Monday. */
  bounds: Date[];
};

/** The weeks a range covers, ending with the week that contains `today`. */
export function insightWeeks(range: InsightRange, today: string, zone: string): InsightWeeks {
  const thisMonday = addDays(today, -((weekdayOf(today) + 6) % 7));
  let count: number;
  if (range === "4w") count = 4;
  else if (range === "12w") count = 12;
  else {
    // From the week holding 1 January to this one.
    const jan1 = `${today.slice(0, 4)}-01-01`;
    const firstMonday = addDays(jan1, -((weekdayOf(jan1) + 6) % 7));
    count = Math.round(daysBetween(firstMonday, thisMonday) / 7) + 1;
  }
  const mondays = Array.from({ length: count }, (_, i) => addDays(thisMonday, (i - count + 1) * 7));
  const clock = zoneClock(zone);
  const bounds = [...mondays, addDays(thisMonday, 7)].map(
    (date) => new Date(clock.instant(date, "00:00")),
  );
  return { mondays, bounds };
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/** Heatmap intensity 0 (none) to 4 (the busiest cell). */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4;
}

/** Share as a whole percent ("41%"), or "–" with nothing to share. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}
