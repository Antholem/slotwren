import "server-only";

import { z } from "zod";

import { env } from "@/env";
import type { BookingPageData, PublicBookingConfirmation } from "@/lib/booking-page";
import type { CalendarEvent } from "@/lib/calendar";
import { SLUG_PATTERN } from "@/lib/slug";
import { getBookingConfirmation, getBookingPage } from "@/server/db/queries/public/booking-page";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";

/*
 * The confirmation page (/b/[slug]/booked/[bookingId]) and its .ics download:
 * a booking found by its unguessable ID, within the business its slug names.
 */

export type Confirmation = {
  data: BookingPageData;
  booking: PublicBookingConfirmation;
  /** Absolute URL of the confirmation page. */
  url: string;
  event: CalendarEvent;
};

export async function loadConfirmation(
  slug: string,
  bookingId: string,
): Promise<Confirmation | null> {
  if (!SLUG_PATTERN.test(slug) || !z.uuid().safeParse(bookingId).success) return null;
  const business = await getPublicBusinessBySlug(slug);
  if (!business) return null;
  const [data, booking] = await Promise.all([
    getBookingPage(business.id),
    getBookingConfirmation({ businessId: business.id, bookingId }),
  ]);
  if (!data || !booking) return null;

  const url = new URL(`/b/${slug}/booked/${bookingId}`, env.NEXT_PUBLIC_APP_URL).toString();
  return {
    data,
    booking,
    url,
    event: {
      uid: `${booking.id}@slotwren`,
      start: booking.startsAt,
      end: booking.endsAt,
      title: `${booking.serviceName} at ${data.business.name}`,
      description: `With ${booking.staffName}. Booking code ${booking.code}.`,
      location: data.business.address,
      url,
    },
  };
}
