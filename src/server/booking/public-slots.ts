import "server-only";

import type { SlotChip, SlotsResponse } from "@/lib/booking-page";
import { nextDate } from "@/lib/time-off";
import { zoneClock } from "@/lib/zone-clock";
import type { SlotContext } from "@/server/db/queries/booking-store";
import { withPublicBookings } from "@/server/db/queries/public/bookings";

import { getSlotGrid, type Slot } from "./slots";

/*
 * Availability for the public booking page, read through the same slot engine
 * and data the booking service re-checks with. Returns public fields only:
 * start times, labels in the customer's timezone, and who a time is with.
 */

const DAY_MS = 86_400_000;
/** How far each look-ahead reads at a time when searching for the next opening. */
const CHUNK_DAYS = 14;

type Window = { from: Date; to: Date };

/** The slot context for a window, or null if the service isn't publicly bookable. */
async function context(
  businessId: string,
  serviceId: string,
  window: Window,
  excludeBookingId?: string,
): Promise<SlotContext | null> {
  const loaded = await withPublicBookings(businessId, (store) =>
    store.loadSlotContext({ serviceId, ...window, excludeBookingId }),
  );
  if (!loaded || !loaded.service.active || loaded.service.archived) return null;
  return loaded;
}

const chip = (slot: Slot, staffId: string | null): SlotChip => ({
  start: slot.start.toISOString(),
  end: slot.end.toISOString(),
  staffId,
  ...slot.local,
});

/** The last instant anyone may book: the end of the booking window's last local day. */
function bookableUntil(ctx: SlotContext, now: Date): Date {
  const clock = zoneClock(ctx.business.timezone);
  const today = clock.parts(now.getTime()).date;
  return new Date(clock.instant(nextDate(today, ctx.business.maxDaysAhead + 1), "00:00"));
}

/** First opening at or after `from`, read in chunks so a busy month stays cheap. */
async function firstOpening(
  businessId: string,
  serviceId: string,
  staffIds: string[],
  from: Date,
  now: Date,
  displayTimezone: string,
  excludeBookingId?: string,
): Promise<Map<string, Slot>> {
  const found = new Map<string, Slot>();
  let start = from;
  for (let i = 0; i < 30 && found.size < staffIds.length; i++) {
    const end = new Date(start.getTime() + CHUNK_DAYS * DAY_MS);
    const ctx = await context(businessId, serviceId, { from: start, to: end }, excludeBookingId);
    if (!ctx) return found;
    const limit = bookableUntil(ctx, now);
    for (const staffId of staffIds) {
      if (found.has(staffId)) continue;
      const { available } = getSlotGrid({
        business: ctx.business,
        service: ctx.service,
        staff: ctx.staff,
        staffId,
        from: start,
        to: end,
        now,
        displayTimezone,
      });
      if (available[0]) found.set(staffId, available[0]);
    }
    if (end >= limit) break;
    start = end;
  }
  return found;
}

/**
 * Available and taken times in `[from, to)`, grouped by the customer's local
 * date, plus the next opening after `to` when the window's last day has none.
 * Null if the service isn't bookable.
 */
export async function getPublicSlots({
  businessId,
  serviceId,
  staffId,
  from,
  to,
  timezone,
  now = new Date(),
  excludeBookingId,
}: {
  businessId: string;
  serviceId: string;
  staffId: string | "any";
  from: Date;
  to: Date;
  timezone: string;
  now?: Date;
  /** A booking being moved: its own time counts as free. */
  excludeBookingId?: string;
}): Promise<SlotsResponse | null> {
  const ctx = await context(businessId, serviceId, { from, to }, excludeBookingId);
  if (!ctx) return null;
  const { available, taken } = getSlotGrid({
    business: ctx.business,
    service: ctx.service,
    staff: ctx.staff,
    staffId,
    from,
    to,
    now,
    displayTimezone: timezone,
  });

  const days: SlotsResponse["days"] = {};
  const day = (date: string) => (days[date] ??= { available: [], taken: [] });
  for (const slot of available) day(slot.local.date).available.push(chip(slot, slot.staffId));
  for (const slot of taken) day(slot.local.date).taken.push(chip(slot, null));

  // The page shows `next` only when no day after the chosen one has times. With
  // times on the window's last day that never happens, and past the booking
  // window there's nothing to find: skip the look-ahead (M8).
  const lastDate = zoneClock(timezone).parts(to.getTime() - 1).date;
  if (days[lastDate]?.available.length || to >= bookableUntil(ctx, now)) {
    return { days, next: null };
  }
  const next = (
    await firstOpening(businessId, serviceId, [staffId], to, now, timezone, excludeBookingId)
  ).get(staffId);
  return { days, next: next ? chip(next, next.staffId) : null };
}

/**
 * The earliest opening for "anyone" and for each person (by ID), as
 * instants: the staff step's "Earliest Today 16:00" / "Next free Tue 10:00".
 */
export async function getNextOpenings({
  businessId,
  serviceId,
  staffIds,
  timezone,
  now = new Date(),
}: {
  businessId: string;
  serviceId: string;
  staffIds: string[];
  timezone: string;
  now?: Date;
}): Promise<Record<string, string | null>> {
  const ids = ["any", ...staffIds];
  const found = await firstOpening(businessId, serviceId, ids, now, now, timezone);
  return Object.fromEntries(ids.map((id) => [id, found.get(id)?.start.toISOString() ?? null]));
}
