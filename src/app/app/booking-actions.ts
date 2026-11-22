"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { err, ok, type Result } from "@/lib/result";
import { getDashboardContext } from "@/server/auth/dashboard";
import {
  type BookingError,
  createBooking,
  type FreeStaff,
  freeStaffFor,
  type MemberSlot,
  memberSlots,
  rescheduleBooking,
} from "@/server/booking/service";
import {
  type BookingDetail,
  type CustomerMatch,
  getBookingDetail,
  searchCustomers,
} from "@/server/db/queries/calendar";

/*
 * The manual-booking sheet and the booking drawer (calendar and Today). Who
 * is acting and in which business comes from the session, never the client;
 * every change goes through src/server/booking/service.ts, and a success
 * refreshes the page so it shows the saved state.
 */

async function actor() {
  const { claims, business, role } = await getDashboardContext();
  return { claims, businessId: business.id, role, timezone: business.timezone };
}

/** Times the team may book on a business-local date. */
export async function memberSlotsAction(
  input: unknown,
): Promise<Result<{ slots: MemberSlot[] }, BookingError>> {
  const me = await actor();
  return memberSlots(me, me.timezone, input);
}

export async function searchCustomersAction(query: unknown): Promise<CustomerMatch[]> {
  const parsed = z.string().max(100).safeParse(query);
  if (!parsed.success) return [];
  const { claims, businessId } = await actor();
  return searchCustomers(claims, businessId, parsed.data);
}

export async function createManualBookingAction(
  input: unknown,
): Promise<Result<{ id: string; code: string }, BookingError>> {
  const result = await createBooking({ kind: "member", actor: await actor() }, input);
  if (!result.ok) return result;
  refresh();
  // The manage token goes to the customer by email, not to the dashboard.
  return ok({ id: result.data.id, code: result.data.code });
}

export async function bookingDetailAction(
  bookingId: unknown,
): Promise<Result<BookingDetail, "not_found">> {
  const id = z.uuid().safeParse(bookingId);
  const missing = err("not_found", "We couldn't find that booking. It may have been removed.");
  if (!id.success) return missing;
  const { claims, businessId } = await actor();
  const detail = await getBookingDetail(claims, businessId, id.data);
  return detail ? ok(detail) : missing;
}

/** Who else could take this booking at its current time. */
export async function freeStaffAction(bookingId: unknown): Promise<FreeStaff[]> {
  const id = z.uuid().safeParse(bookingId);
  if (!id.success) return [];
  const me = await actor();
  if (me.role !== "owner") return []; // staff can't hand a booking to someone else (RLS)
  return (await freeStaffFor(me, [id.data]))[id.data] ?? [];
}

export async function rescheduleAction(
  bookingId: string,
  input: unknown,
): Promise<Result<{ startsAt: Date; staffId: string }, BookingError>> {
  const result = await rescheduleBooking(
    { kind: "member", actor: await actor(), bookingId },
    input,
  );
  if (!result.ok) return result;
  refresh();
  return ok({ startsAt: result.data.startsAt, staffId: result.data.staffId });
}
