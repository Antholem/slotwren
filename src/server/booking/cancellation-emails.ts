import "server-only";

import { withJobBookings } from "@/server/db/queries/system/jobs";
import {
  CANCELLATION_EMAILS_EVENT,
  type CancellationEmailsData,
  sendJobEvents,
} from "@/server/jobs/client";

import { notifyBookingCancelled } from "./notify";

/*
 * Emails for bookings the team cancelled in bulk (time off over a busy day).
 * booking/service.ts queues one Inngest event after the cancellations commit;
 * the cancellation-emails job (src/server/jobs/functions.ts) sends one email
 * per booking. Without Inngest the service sends them itself, after the
 * response.
 */

/** Queue the emails. False when Inngest isn't configured or refused the event. */
export const queueCancellationEmails = (data: CancellationEmailsData) =>
  sendJobEvents([{ name: CANCELLATION_EMAILS_EVENT, data }]);

/** One customer's "your booking was cancelled", if it still is. */
export async function sendCancellationEmail(
  businessId: string,
  bookingId: string,
  message: string | null,
): Promise<boolean> {
  const summary = await withJobBookings(businessId, (store) => store.summary(bookingId));
  if (summary?.status !== "cancelled") return false;
  return notifyBookingCancelled(summary, { byBusiness: true, message });
}
