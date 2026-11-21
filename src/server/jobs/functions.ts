import "server-only";

import { sendCancellationEmail } from "@/server/booking/cancellation-emails";
import { sendReminder } from "@/server/booking/reminders";

import {
  CANCELLATION_EMAILS_EVENT,
  cancellationEmailsSchema,
  inngest,
  REMINDER_EVENT,
  reminderEventSchema,
} from "./client";

/**
 * Waits until the planned time, then sends the reminder (if the booking still
 * wants one). A newer plan for the same booking (it moved or was cancelled)
 * cancels this run while it waits; sendReminder() checks again anyway.
 */
export const bookingReminder = inngest.createFunction(
  {
    id: "booking-reminder",
    name: "Booking reminder",
    triggers: [{ event: REMINDER_EVENT }],
    cancelOn: [
      {
        event: REMINDER_EVENT,
        if: "async.data.bookingId == event.data.bookingId && async.data.revision != event.data.revision",
      },
    ],
    retries: 3,
  },
  async ({ event, step }) => {
    const data = reminderEventSchema.parse(event.data);
    if (!data.sendAt) return { skipped: "nothing to send" };
    await step.sleepUntil("wait-until-reminder-time", data.sendAt);
    return step.run("send-reminder", () => sendReminder(data));
  },
);

/**
 * The customers' emails after the team cancels several bookings at once.
 * One step per booking: a retry never sends the same email twice.
 */
export const cancellationEmails = inngest.createFunction(
  {
    id: "booking-cancellation-emails",
    name: "Cancellation emails",
    triggers: [{ event: CANCELLATION_EMAILS_EVENT }],
    retries: 3,
  },
  async ({ event, step }) => {
    const data = cancellationEmailsSchema.parse(event.data);
    let sent = 0;
    for (const bookingId of data.bookingIds) {
      const delivered = await step.run(`email-${bookingId}`, () =>
        sendCancellationEmail(data.businessId, bookingId, data.message),
      );
      if (delivered) sent++;
    }
    return { sent, of: data.bookingIds.length };
  },
);

export const functions = [bookingReminder, cancellationEmails];
