import "server-only";

import { eq } from "drizzle-orm";

import { adminQuery, type TenantScoped, tenantLookup } from "../../admin";
import { bookings } from "../../schema";
import { type BookingStore, bookingStore } from "../booking-store";

/*
 * Booking writes without a signed-in user: the public page, the embed, the AI
 * receptionist's Confirm, and manage links. Only src/server/booking/service.ts
 * calls these; the store filters every query by `businessId`.
 */

/** Run `work` in one adminDb transaction against one business's bookings. */
export function withPublicBookings<T>(
  businessId: string,
  work: (store: BookingStore) => Promise<T>,
): Promise<T> {
  const run = adminQuery((db, args: TenantScoped) =>
    db.transaction((tx) => work(bookingStore(tx, args.businessId))),
  );
  return run({ businessId });
}

/**
 * The booking a manage link points at, by the SHA-256 of its token. Returns
 * the two IDs only; everything else is read inside the business's store.
 */
export const findBookingByManageToken = tenantLookup(
  "byManageTokenHash",
  async (
    db,
    { tokenHash }: { tokenHash: string },
  ): Promise<{ businessId: string; bookingId: string } | null> => {
    const [row] = await db
      .select({ businessId: bookings.businessId, bookingId: bookings.id })
      .from(bookings)
      .where(eq(bookings.manageTokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  },
);
