"use server";

import { err, ok, type Result } from "@/lib/result";
import { SLUG_PATTERN } from "@/lib/slug";
import { BOOKING_MESSAGES, type BookingError, createBooking } from "@/server/booking/service";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";

/*
 * The booking page's Confirm. All checks happen in createBooking (the one write
 * path): the slot is re-checked, and the database decides a race.
 */

export async function bookAction(
  slug: string,
  input: unknown,
): Promise<Result<{ bookingId: string; manageToken: string }, BookingError>> {
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  if (!business) return err("not_found", BOOKING_MESSAGES.serviceGone);
  const result = await createBooking(
    { kind: "public", businessId: business.id, source: "page" },
    input,
  );
  // The manage token goes back to this customer once; only its hash is stored.
  return result.ok
    ? ok({ bookingId: result.data.id, manageToken: result.data.manageToken })
    : result;
}
