import "server-only";

import { env } from "@/env";
import { BookingCancelledEmail } from "@/emails/booking-cancelled";
import { BookingConfirmedEmail } from "@/emails/booking-confirmed";
import { BookingRescheduledEmail } from "@/emails/booking-rescheduled";
import type { BookingEmailData } from "@/emails/components/booking-details";
import { OwnerNewBookingEmail } from "@/emails/owner-new-booking";
import { buildIcs, type CalendarEvent, googleCalendarUrl } from "@/lib/calendar";
import { formatInZone } from "@/lib/dates";
import { formatPrice } from "@/lib/money";
import { timeZoneLabel } from "@/lib/timezones";
import type { BookingSummary } from "@/server/db/queries/booking-store";
import { getOwnerEmails } from "@/server/db/queries/system/owners";
import { type EmailAttachment, sendEmail } from "@/server/email/send";

/*
 * Booking emails, sent by booking/service.ts after a change commits:
 * confirmed (with the .ics attached), rescheduled, cancelled, and the
 * owner's "new booking". A booking never fails because email did: every
 * function here catches, logs and reports whether the customer's email went.
 * Times are on the customer's clock (their timezone at booking time), the
 * owner's on the business's.
 */

const absolute = (path: string) => new URL(path, env.NEXT_PUBLIC_APP_URL).toString();
export const manageUrl = (token: string) => absolute(`/m/${token}`);

const SOURCES = {
  page: "Booking page",
  widget: "Website widget",
  ai: "AI receptionist",
  manual: "Dashboard",
} as const;

const zoneOf = (s: BookingSummary) => s.customerTimezone ?? s.businessTimezone;

function data(s: BookingSummary, zone = zoneOf(s)): BookingEmailData {
  return {
    business: {
      name: s.businessName,
      brandColor: s.businessBrandColor,
      address: s.businessAddress,
      logoUrl: s.businessLogoUrl,
    },
    customerName: s.customerName,
    serviceName: s.serviceName,
    durationMin: s.durationMin,
    staffName: s.staffName,
    price: formatPrice(s.priceCents, s.businessCurrency),
    code: s.code,
    date: formatInZone(s.startsAt, zone, "EEEE, d MMMM"),
    range: `${formatInZone(s.startsAt, zone, "HH:mm")} – ${formatInZone(s.endsAt, zone, "HH:mm")}`,
    zoneNote: zone !== s.businessTimezone ? `Times in ${timeZoneLabel(zone, s.startsAt)}` : null,
    mapsUrl: s.businessAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.businessAddress)}`
      : null,
  };
}

/** The same event the confirmation page offers, so re-adding updates it. */
export function calendarEvent(s: BookingSummary, sequence = 0): CalendarEvent {
  return {
    uid: `${s.id}@slotwren`,
    start: s.startsAt,
    end: s.endsAt,
    title: `${s.serviceName} at ${s.businessName}`,
    description: `With ${s.staffName}. Booking code ${s.code}.`,
    location: s.businessAddress,
    url: absolute(`/b/${s.businessSlug}/booked/${s.id}`),
    sequence,
  };
}

function calendar(s: BookingSummary, now: Date, sequence = 0) {
  const event = calendarEvent(s, sequence);
  const ics: EmailAttachment = {
    filename: `${s.businessSlug}-${s.code}.ics`,
    content: buildIcs(event, now),
    contentType: "text/calendar; charset=utf-8; method=PUBLISH",
  };
  return {
    googleUrl: googleCalendarUrl(event),
    icsUrl: absolute(`/b/${s.businessSlug}/booked/${s.id}/event.ics`),
    attachment: ics,
  };
}

function policy(s: BookingSummary) {
  const hours = s.cancellationWindowHours;
  if (hours <= 0) return "Free cancellation until your appointment starts.";
  const until = new Date(s.startsAt.getTime() - hours * 3_600_000);
  return `Free cancellation until ${formatInZone(until, zoneOf(s), "EEE d MMM, HH:mm")} (up to ${hours} h before). After that, contact ${s.businessName} to change your booking.`;
}

/** "Sat 31 Oct at 10:30" for subject lines. */
const short = (s: BookingSummary, zone = zoneOf(s)) =>
  formatInZone(s.startsAt, zone, "EEE d MMM 'at' HH:mm");

async function safely(label: string, send: () => Promise<boolean>): Promise<boolean> {
  try {
    return await send();
  } catch (error) {
    console.error(`[email] ${label} failed`, error);
    return false;
  }
}

/** After createBooking: the customer's confirmation, and the owners' heads-up. */
export async function notifyBookingCreated(
  s: BookingSummary,
  manageToken: string,
  now = new Date(),
): Promise<boolean> {
  const customer = safely("booking confirmation", async () => {
    const zone = zoneOf(s);
    const cal = calendar(s, now);
    const via =
      s.source === "ai"
        ? `Booked with ${s.businessName}'s AI receptionist`
        : s.source === "manual"
          ? `Booked by ${s.businessName}`
          : "Booked online";
    const result = await sendEmail({
      to: s.customerEmail,
      subject: `Booked: ${s.serviceName}, ${short(s)}`,
      fromName: s.businessName,
      replyTo: s.businessContactEmail,
      attachments: [cal.attachment],
      react: BookingConfirmedEmail({
        ...data(s),
        manageUrl: manageUrl(manageToken),
        googleUrl: cal.googleUrl,
        icsUrl: cal.icsUrl,
        policy: policy(s),
        bookedVia: `${via} on ${formatInZone(s.createdAt, zone, "EEE d MMM 'at' HH:mm")}.`,
      }),
      logLines: [`Booking ${s.code} confirmed. Manage link: ${manageUrl(manageToken)}`],
    });
    return result.delivered;
  });

  // Owners hear about bookings customers made, unless they've turned it off.
  const owners =
    s.source !== "manual" && s.ownerNewBookingEmail
      ? safely("owner new booking", async () => {
          const to = await getOwnerEmails({ businessId: s.businessId });
          if (to.length === 0) return false;
          const zone = s.businessTimezone;
          const result = await sendEmail({
            to,
            subject: `New booking: ${s.customerName}, ${s.serviceName} ${short(s, zone)}`,
            replyTo: s.customerEmail,
            react: OwnerNewBookingEmail({
              business: data(s, zone).business,
              customer: { name: s.customerName, email: s.customerEmail, phone: s.customerPhone },
              notes: s.customerNotes,
              serviceName: s.serviceName,
              durationMin: s.durationMin,
              staffName: s.staffName,
              price: formatPrice(s.priceCents, s.businessCurrency),
              code: s.code,
              date: formatInZone(s.startsAt, zone, "EEEE, d MMMM"),
              range: `${formatInZone(s.startsAt, zone, "HH:mm")} – ${formatInZone(s.endsAt, zone, "HH:mm")}`,
              source: SOURCES[s.source],
              dashboardUrl: absolute("/app"),
            }),
            logLines: [`New booking ${s.code} for the owners of ${s.businessName}`],
          });
          return result.delivered;
        })
      : Promise.resolve(false);

  const [sent] = await Promise.all([customer, owners]);
  return sent;
}

/** After rescheduleBooking: the new time and a fresh manage link. */
export async function notifyBookingRescheduled(
  s: BookingSummary,
  {
    previousStart,
    manageToken,
    byCustomer,
  }: { previousStart: Date; manageToken: string; byCustomer: boolean },
  now = new Date(),
): Promise<boolean> {
  return safely("reschedule email", async () => {
    // A fresh SEQUENCE per change, so calendars update the event they have.
    const cal = calendar(s, now, Math.floor(now.getTime() / 1000));
    const result = await sendEmail({
      to: s.customerEmail,
      subject: `Moved: ${s.serviceName}, now ${short(s)}`,
      fromName: s.businessName,
      replyTo: s.businessContactEmail,
      attachments: [cal.attachment],
      react: BookingRescheduledEmail({
        ...data(s),
        previous: formatInZone(previousStart, zoneOf(s), "EEE d MMM, HH:mm"),
        manageUrl: manageUrl(manageToken),
        googleUrl: cal.googleUrl,
        icsUrl: cal.icsUrl,
        policy: policy(s),
        movedByBusiness: !byCustomer,
      }),
      logLines: [`Booking ${s.code} moved. Manage link: ${manageUrl(manageToken)}`],
    });
    return result.delivered;
  });
}

/** After cancelBooking: the business's notice, or the customer's own receipt. */
export async function notifyBookingCancelled(
  s: BookingSummary,
  { byBusiness, message }: { byBusiness: boolean; message: string | null },
): Promise<boolean> {
  return safely("cancellation email", async () => {
    const result = await sendEmail({
      to: s.customerEmail,
      subject: `Cancelled: ${s.serviceName}, ${short(s)}`,
      fromName: s.businessName,
      replyTo: s.businessContactEmail,
      react: BookingCancelledEmail({
        ...data(s),
        byBusiness,
        message: byBusiness ? message : null,
        bookAgainUrl: absolute(`/b/${s.businessSlug}`),
      }),
      logLines: [`Booking ${s.code} cancelled`],
    });
    return result.delivered;
  });
}
