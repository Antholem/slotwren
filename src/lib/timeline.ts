import { minutesOf, timeOf } from "./hours";
import { zoneClock } from "./zone-clock";

/*
 * Geometry for the Today timeline: where appointments, working hours and time
 * off fall on one local day, in minutes past local midnight. Pure and
 * client-safe. A DST day is drawn on its wall clock (the hour the clocks skip
 * or repeat is not stretched), which is what the owner reads on the wall.
 */

export type Span = { start: number; end: number };

const DAY_MIN = 24 * 60;

/** An instant range as local minutes on the day [dayStart, dayEnd), clipped to it. */
export function localSpan(
  range: { startsAt: Date; endsAt: Date },
  day: { dayStart: Date; dayEnd: Date },
  zone: string,
): Span {
  const clock = zoneClock(zone);
  const at = (date: Date, edge: "start" | "end") => {
    if (date.getTime() <= day.dayStart.getTime()) return 0;
    if (date.getTime() >= day.dayEnd.getTime()) return DAY_MIN;
    const { minutes } = clock.parts(date.getTime());
    return edge === "end" && minutes === 0 ? DAY_MIN : minutes;
  };
  return { start: at(range.startsAt, "start"), end: at(range.endsAt, "end") };
}

/**
 * Whole hours that hold everything worth drawing: opening hours, working
 * hours and appointments. 09:00–18:00 when there is nothing to go on.
 */
export function gridBounds(spans: Span[]): Span {
  const real = spans.filter((s) => s.end > s.start);
  if (real.length === 0) return { start: 9 * 60, end: 18 * 60 };
  const start = Math.min(...real.map((s) => s.start));
  const end = Math.max(...real.map((s) => s.end));
  return {
    start: Math.max(0, Math.floor(start / 60) * 60),
    end: Math.min(DAY_MIN, Math.max(Math.ceil(end / 60) * 60, Math.floor(start / 60) * 60 + 60)),
  };
}

/** "HH:MM" working ranges as spans. */
export function hoursToSpans(hours: { start: string; end: string }[]): Span[] {
  return hours.map((h) => ({
    start: minutesOf(h.start),
    end: h.end === "00:00" ? DAY_MIN : minutesOf(h.end),
  }));
}

/** `spans` minus `holes`, merged and sorted. */
export function subtract(spans: Span[], holes: Span[]): Span[] {
  let result = merge(spans);
  for (const hole of holes) {
    result = result.flatMap((s) => {
      if (hole.end <= s.start || hole.start >= s.end) return [s];
      const parts: Span[] = [];
      if (hole.start > s.start) parts.push({ start: s.start, end: hole.start });
      if (hole.end < s.end) parts.push({ start: hole.end, end: s.end });
      return parts;
    });
  }
  return result;
}

/** Overlapping or touching spans joined, sorted by start. */
export function merge(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export type OffSegment = Span & { label: string | null };

/**
 * The parts of the grid someone isn't working, to hatch. Labelled when that
 * says something: "Off today", or "Off from 13:00" when they leave early.
 */
export function offSegments(working: Span[], grid: Span): OffSegment[] {
  const off = subtract([grid], working);
  const worked = merge(working).filter((s) => s.end > grid.start && s.start < grid.end);
  if (worked.length === 0) return off.map((s) => ({ ...s, label: "Off today" }));
  return off.map((s) => ({
    ...s,
    label: s.end === grid.end && s.start > grid.start ? `Off from ${timeOf(s.start)}` : null,
  }));
}

/** When someone stops working, if that's before the grid ends ("until 13:00"). */
export function workingUntil(working: Span[], grid: Span): string | null {
  const merged = merge(working);
  const last = merged.at(-1);
  if (!last || last.end >= grid.end) return null;
  return timeOf(last.end);
}

/** A span's left offset and width as percentages of the grid. */
export function placement(span: Span, grid: Span): { left: number; width: number } {
  const total = grid.end - grid.start;
  const start = Math.max(span.start, grid.start);
  const end = Math.min(span.end, grid.end);
  return {
    left: ((start - grid.start) / total) * 100,
    width: (Math.max(0, end - start) / total) * 100,
  };
}
