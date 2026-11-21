import "server-only";

import { Inngest } from "inngest";
import { z } from "zod";

import { env } from "@/env";

/*
 * Inngest, for work that happens later (reminders). Locally, INNGEST_DEV=1
 * points it at the dev server (`pnpm jobs:dev`); in production the Vercel
 * integration sets INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY.
 */

export const inngest = new Inngest({
  id: "slotwren",
  // env.ts refuses INNGEST_DEV=1 on production; this holds even if validation is skipped.
  isDev: env.INNGEST_DEV === "1" && env.VERCEL_ENV !== "production",
  eventKey: env.INNGEST_EVENT_KEY,
  signingKey: env.INNGEST_SIGNING_KEY,
});

/** Booking created, moved or cancelled: (re)plan its reminder. */
export const REMINDER_EVENT = "booking/reminder.schedule" as const;

export const reminderEventSchema = z.object({
  bookingId: z.uuid(),
  businessId: z.uuid(),
  /** The start this plan was made for: a later move makes it stale. */
  startsAt: z.iso.datetime(),
  /** When to send, or null to clear (cancelled, or nothing to send). */
  sendAt: z.iso.datetime().nullable(),
  /** Each plan's own ID: a newer plan cancels the older ones (cancelOn). */
  revision: z.string().min(1),
});
export type ReminderEventData = z.infer<typeof reminderEventSchema>;

/** The team cancelled several bookings at once (time off): email each customer. */
export const CANCELLATION_EMAILS_EVENT = "booking/cancellation.emails" as const;

export const cancellationEmailsSchema = z.object({
  businessId: z.uuid(),
  bookingIds: z.array(z.uuid()).min(1),
  /** What the customers are told; the team's reason stays with the team. */
  message: z.string().nullable(),
});
export type CancellationEmailsData = z.infer<typeof cancellationEmailsSchema>;

export type JobEvent =
  | { name: typeof REMINDER_EVENT; data: ReminderEventData }
  | { name: typeof CANCELLATION_EMAILS_EVENT; data: CancellationEmailsData };

const configured = () =>
  env.NODE_ENV !== "test" && (Boolean(env.INNGEST_EVENT_KEY) || env.INNGEST_DEV === "1");

/**
 * Send events to Inngest. Like email, never fails the caller: without keys
 * (or in tests) it skips, and errors are logged and reported as false.
 */
export async function sendJobEvents(events: JobEvent[]): Promise<boolean> {
  if (events.length === 0) return true;
  if (!configured()) {
    if (env.NODE_ENV === "development") {
      console.info(`[jobs] Inngest not configured; not sending ${events.map((e) => e.name)}.`);
    }
    return false;
  }
  try {
    await inngest.send(events);
    return true;
  } catch (error) {
    console.error("[jobs] Sending events to Inngest failed", error);
    return false;
  }
}
