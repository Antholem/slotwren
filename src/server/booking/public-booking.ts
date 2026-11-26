import "server-only";

import { err, ok, type Result } from "@/lib/result";
import { SLUG_PATTERN } from "@/lib/slug";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { rateLimit } from "@/server/rate-limit";

import { BOOKING_MESSAGES, type BookingError, createBooking } from "./service";

/**
 * A booking from the public page: rate-limited per IP and per business, then
 * createBooking (the one write path). The page's server action passes the
 * request's IP; it's here, not in the action, so tests can call it and so the
 * browser can't choose its own IP.
 */
export async function bookFromPage({
  slug,
  input,
  ip,
  source = "page",
  now = new Date(),
}: {
  slug: string;
  input: unknown;
  ip: string;
  /** "widget" when booked inside the website widget. */
  source?: "page" | "widget";
  now?: Date;
}): Promise<Result<{ bookingId: string; manageToken: string }, BookingError | "rate_limited">> {
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  if (!business) return err("not_found", BOOKING_MESSAGES.serviceGone);

  const limited = await rateLimit("book", { ip, businessId: business.id }, now.getTime());
  if (!limited.ok) return err("rate_limited", limited.message);

  const result = await createBooking({ kind: "public", businessId: business.id, source }, input, {
    now,
  });
  // The manage token goes back to this customer once; only its hash is stored.
  return result.ok
    ? ok({ bookingId: result.data.id, manageToken: result.data.manageToken })
    : result;
}
