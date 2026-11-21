import "server-only";

import { randomUUID } from "node:crypto";

import { planReminder } from "@/lib/reminders";
import type { BookingSummary } from "@/server/db/queries/booking-store";
import { withJobBookings } from "@/server/db/queries/system/jobs";
import { REMINDER_EVENT, type ReminderEventData, sendJobEvents } from "@/server/jobs/client";

import { notifyBookingReminder } from "./notify";
import { generateToken, hashToken } from "./tokens";

/*
 * Reminders (docs/adr/0004-reminders.md). booking/service.ts plans one after
 * every change; the booking-reminder job (src/server/jobs/functions.ts) waits
 * until then and calls sendReminder(), which checks the booking again first.
 */

type Plannable = Pick<
  BookingSummary,
  "id" | "businessId" | "startsAt" | "businessTimezone" | "cancellationWindowHours"
>;

/** The event that (re)plans a booking's reminder; `sendAt` null clears it. */
export function reminderEvent(s: Plannable, now: Date, clear = false) {
  const plan = clear
    ? null
    : planReminder({
        startsAt: s.startsAt,
        cancellationWindowHours: s.cancellationWindowHours,
        timezone: s.businessTimezone,
        now,
      });
  const data: ReminderEventData = {
    bookingId: s.id,
    businessId: s.businessId,
    startsAt: s.startsAt.toISOString(),
    sendAt: plan?.send ? plan.at.toISOString() : null,
    revision: randomUUID(),
  };
  return { name: REMINDER_EVENT, data };
}

/** After a booking is made or moved. Never fails the caller. */
export const scheduleReminder = (s: Plannable, now = new Date()) =>
  sendJobEvents([reminderEvent(s, now)]);

/** After a booking is cancelled: any planned reminder is dropped. */
export const clearReminder = (s: Plannable, now = new Date()) =>
  sendJobEvents([reminderEvent(s, now, true)]);

export type ReminderOutcome =
  | { sent: true; delivered: boolean }
  | { sent: false; skipped: "not_found" | "not_active" | "moved" | "past" };

/**
 * Send the reminder planned in `data`, if it still applies: the booking is
 * pending or confirmed, hasn't moved since, and hasn't started. It carries a
 * freshly minted manage link (one more live link; the others keep working).
 */
export async function sendReminder(
  data: ReminderEventData,
  now = new Date(),
): Promise<ReminderOutcome> {
  const token = generateToken();
  type Checked =
    { skip: "not_found" | "not_active" | "moved" | "past" } | { summary: BookingSummary };
  const checked = await withJobBookings(data.businessId, async (store): Promise<Checked> => {
    const summary = await store.summary(data.bookingId);
    if (!summary) return { skip: "not_found" };
    if (summary.status !== "pending" && summary.status !== "confirmed") {
      return { skip: "not_active" };
    }
    if (summary.startsAt.toISOString() !== data.startsAt) return { skip: "moved" };
    if (summary.startsAt <= now) return { skip: "past" };
    await store.mintManageToken(summary.id, hashToken(token), "reminder");
    return { summary };
  });
  if ("skip" in checked) return { sent: false, skipped: checked.skip };
  const delivered = await notifyBookingReminder(checked.summary, token, now);
  return { sent: true, delivered };
}
