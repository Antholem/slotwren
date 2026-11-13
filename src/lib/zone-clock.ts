/*
 * Fast wall-clock conversion for one IANA zone, for hot loops like the slot
 * engine. Same answers as zonedInstant/zonedParts (src/lib/time-off.ts), but
 * one Intl formatter per zone and offsets memoised per quarter hour (every
 * modern offset change falls on one), instead of building a TZDate each time.
 */

const MIN = 60_000;
const QUARTER = 15 * MIN;
const pad = (n: number) => String(n).padStart(2, "0");

export type ZoneClock = {
  zone: string;
  /** Minutes east of UTC at `instant` (New York in winter: -300). */
  offsetMin(instant: number): number;
  /** Local "YYYY-MM-DD", "HH:MM" and minutes past midnight. */
  parts(instant: number): { date: string; time: string; minutes: number };
  /**
   * The instant a local date and "HH:MM" names. A time the clocks repeat gives
   * the first; a time they skip moves forward by the gap (02:30 → 03:30), as
   * TZDate does.
   */
  instant(date: string, time: string): number;
};

const clocks = new Map<string, ZoneClock>();

export function zoneClock(zone: string): ZoneClock {
  const existing = clocks.get(zone);
  if (existing) return existing;

  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const offsets = new Map<number, number>();

  function offsetMin(instant: number): number {
    const key = Math.floor(instant / QUARTER);
    const cached = offsets.get(key);
    if (cached !== undefined) return cached;
    const at = key * QUARTER;
    const p: Record<string, number> = {};
    for (const { type, value } of format.formatToParts(at)) p[type] = Number(value);
    const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
    const offset = Math.round((wall - at) / MIN);
    offsets.set(key, offset);
    return offset;
  }

  function parts(instant: number) {
    const local = new Date(instant + offsetMin(instant) * MIN);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    return {
      date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
      time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
      minutes,
    };
  }

  function instant(date: string, time: string): number {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const [h, min] = time.split(":").map(Number) as [number, number];
    const wall = Date.UTC(y, m - 1, d, h, min);
    // The offsets in force either side of any change near this wall time.
    const before = offsetMin(wall - 18 * 60 * MIN);
    const after = offsetMin(wall + 18 * 60 * MIN);
    const valid = [wall - before * MIN, wall - after * MIN].filter(
      (candidate) => offsetMin(candidate) * MIN === wall - candidate,
    );
    if (valid.length > 0) return Math.min(...valid);
    return wall - before * MIN; // skipped: move forward by the gap
  }

  const clock = { zone, offsetMin, parts, instant };
  clocks.set(zone, clock);
  return clock;
}
