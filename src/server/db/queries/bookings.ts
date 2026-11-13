import "server-only";

import { type RlsClaims, withRls } from "../client";
import { type BookingStore, bookingStore } from "./booking-store";

/**
 * Run `work` in one transaction as the signed-in member, so RLS applies on top
 * of the store's business_id filters: owners change any booking, staff only
 * their own (docs/adr/0002-rls-strategy.md). Only src/server/booking/service.ts
 * calls this.
 */
export function withMemberBookings<T>(
  claims: RlsClaims,
  businessId: string,
  work: (store: BookingStore) => Promise<T>,
): Promise<T> {
  return withRls(claims, (tx) => work(bookingStore(tx, businessId)));
}
