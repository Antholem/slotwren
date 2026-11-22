"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { Result } from "@/lib/result";
import { getDashboardContext, setCurrentBusiness } from "@/server/auth/dashboard";
import {
  type BookingError,
  cancelBooking,
  recordOutcome,
  type RecordedOutcome,
} from "@/server/booking/service";
import { saveProfileName } from "@/server/catalog/profile";
import { type PaletteResults, paletteSearch } from "@/server/db/queries/customers";

/** Business switcher: remember the choice if the user belongs to that business. */
export async function switchBusiness(businessId: unknown) {
  const id = z.uuid().parse(businessId);
  const { businesses } = await getDashboardContext();
  if (!businesses.some((b) => b.id === id)) return;
  await setCurrentBusiness(id);
  refresh();
}

/** Profile dialog (account menu): the name the dashboard shows for you. */
export async function saveProfileAction(input: unknown) {
  const { claims } = await getDashboardContext();
  const result = await saveProfileName(claims, input);
  if (result.ok) refresh();
  return result;
}

/*
 * Today's quick actions. Who is acting comes from the session, never the
 * client; the change goes through src/server/booking/service.ts, and a
 * success refreshes the page so the optimistic state settles on saved data.
 */

async function actor() {
  const { claims, business, role } = await getDashboardContext();
  return { claims, businessId: business.id, role };
}

export async function recordOutcomeAction(
  bookingId: string,
  outcome: unknown,
): Promise<Result<RecordedOutcome, BookingError>> {
  const result = await recordOutcome(await actor(), bookingId, { outcome });
  if (result.ok) refresh();
  return result;
}

export async function cancelFromTodayAction(
  bookingId: string,
  notify: unknown,
): Promise<Result<{ notified: boolean | null }, BookingError>> {
  const result = await cancelBooking(
    { kind: "member", actor: await actor(), bookingId },
    {},
    { notify: notify === true },
  );
  if (!result.ok) return result;
  refresh();
  return { ok: true, data: { notified: result.data.notified } };
}

/** ⌘K: customers and booking codes in the current business. */
export async function paletteSearchAction(query: unknown): Promise<PaletteResults> {
  const parsed = z.string().max(100).safeParse(query);
  if (!parsed.success) return { customers: [], bookings: [] };
  const { claims, business } = await getDashboardContext();
  return paletteSearch(claims, business.id, parsed.data);
}
