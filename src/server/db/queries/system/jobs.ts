import "server-only";

import { adminQuery, type TenantScoped } from "../../admin";
import { type BookingStore, bookingStore } from "../booking-store";

/**
 * Background jobs (reminders) read and change one business's bookings in a
 * transaction, through the same store as the booking service. No signed-in
 * user: adminDb, filtered by `businessId` in every query.
 */
export function withJobBookings<T>(
  businessId: string,
  work: (store: BookingStore) => Promise<T>,
): Promise<T> {
  const run = adminQuery((db, args: TenantScoped) =>
    db.transaction((tx) => work(bookingStore(tx, args.businessId))),
  );
  return run({ businessId });
}
