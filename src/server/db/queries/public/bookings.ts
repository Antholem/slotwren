import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";

import { adminQuery, type TenantScoped, tenantLookup } from "../../admin";
import { manageTokens } from "../../schema";
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
 * The booking a manage link points at, by the SHA-256 of its token: only a
 * live token (not revoked, not past the appointment's end at `now`). Returns
 * the two IDs only; everything else is read inside the business's store.
 */
export const findBookingByManageToken = tenantLookup(
  "byManageTokenHash",
  async (
    db,
    { tokenHash, now }: { tokenHash: string; now: Date },
  ): Promise<{ businessId: string; bookingId: string } | null> => {
    const [row] = await db
      .select({ businessId: manageTokens.businessId, bookingId: manageTokens.bookingId })
      .from(manageTokens)
      .where(liveToken(tokenHash, now))
      .limit(1);
    return row ?? null;
  },
);

/** A manage token that still opens its booking. */
export const liveToken = (tokenHash: string, now: Date) =>
  and(
    eq(manageTokens.tokenHash, tokenHash),
    isNull(manageTokens.revokedAt),
    gt(manageTokens.expiresAt, now),
  );
