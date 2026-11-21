"use server";

import { headers } from "next/headers";

import type { Result } from "@/lib/result";
import { bookFromPage } from "@/server/booking/public-booking";
import type { BookingError } from "@/server/booking/service";
import { clientIp } from "@/server/rate-limit";

/*
 * The booking page's Confirm. Rate limits, then createBooking (the one write
 * path): the slot is re-checked, and the database decides a race.
 */

export async function bookAction(
  slug: string,
  input: unknown,
): Promise<Result<{ bookingId: string; manageToken: string }, BookingError | "rate_limited">> {
  return bookFromPage({ slug, input, ip: clientIp(await headers()) });
}
