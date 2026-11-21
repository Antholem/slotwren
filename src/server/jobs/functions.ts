import "server-only";

import { sendReminder } from "@/server/booking/reminders";

import { inngest, REMINDER_EVENT, reminderEventSchema } from "./client";

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

export const functions = [bookingReminder];
