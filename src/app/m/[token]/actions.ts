"use server";

import { ok, type Result } from "@/lib/result";
import { type BookingError, cancelBooking, rescheduleBooking } from "@/server/booking/service";

/*
 * The manage page's changes. The token is the customer's authority; the rules
 * (cancellation window, slot re-check, the database's last word on a race)
 * are all in booking/service.ts.
 */

export async function moveAction(
  token: string,
  startsAt: string,
): Promise<Result<{ manageToken: string }, BookingError>> {
  const result = await rescheduleBooking({ kind: "customer", manageToken: token }, { startsAt });
  if (!result.ok) return result;
  // A customer's change rotates the link; the old token no longer works.
  return ok({ manageToken: result.data.manageToken ?? token });
}

export async function cancelAction(token: string): Promise<Result<{ id: string }, BookingError>> {
  const result = await cancelBooking({ kind: "customer", manageToken: token }, {});
  return result.ok ? ok({ id: result.data.id }) : result;
}
