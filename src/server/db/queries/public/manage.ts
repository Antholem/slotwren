import "server-only";

import { and, eq } from "drizzle-orm";

import { adminQuery, type TenantScoped, tenantLookup } from "../../admin";
import { bookings, businesses, customers, manageTokens, services, staff } from "../../schema";
import { liveToken } from "./bookings";

/*
 * The manage page (/m/[token]). Whoever holds the token is the customer, so
 * they see their own name and notes, but still never their email, phone,
 * the token hash or anything internal (tests/integration/public-data.test.ts).
 */

export type ManagedBooking = {
  businessId: string;
  id: string;
  code: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  startsAt: Date;
  endsAt: Date;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  staffId: string;
  staffName: string;
  staffColor: "teal" | "violet" | "pink";
  priceCents: number;
  customerName: string;
  customerNotes: string | null;
};

/** The booking a live manage link points at, by the SHA-256 of its token. */
export const getManagedBooking = tenantLookup(
  "byManageTokenHash",
  async (
    db,
    { tokenHash, now }: { tokenHash: string; now: Date },
  ): Promise<ManagedBooking | null> => {
    const [row] = await db
      .select({
        businessId: bookings.businessId,
        id: bookings.id,
        code: bookings.code,
        status: bookings.status,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        serviceId: bookings.serviceId,
        serviceName: services.name,
        durationMin: services.durationMin,
        staffId: bookings.staffId,
        staffName: staff.name,
        staffColor: staff.color,
        priceCents: bookings.priceCents,
        customerName: customers.name,
        customerNotes: bookings.customerNotes,
      })
      .from(manageTokens)
      .innerJoin(
        bookings,
        and(
          eq(bookings.id, manageTokens.bookingId),
          eq(bookings.businessId, manageTokens.businessId),
        ),
      )
      .innerJoin(
        services,
        and(eq(services.id, bookings.serviceId), eq(services.businessId, bookings.businessId)),
      )
      .innerJoin(
        staff,
        and(eq(staff.id, bookings.staffId), eq(staff.businessId, bookings.businessId)),
      )
      .innerJoin(
        customers,
        and(eq(customers.id, bookings.customerId), eq(customers.businessId, bookings.businessId)),
      )
      .where(liveToken(tokenHash, now))
      .limit(1);
    return row ?? null;
  },
);

/**
 * How a customer reaches the business once online changes have closed. The
 * one public query that returns the business's phone and email; customers
 * holding a booking are who it's for.
 */
export const getBusinessContact = adminQuery(
  async (
    db,
    { businessId }: TenantScoped,
  ): Promise<{ businessPhone: string | null; businessEmail: string | null }> => {
    const [row] = await db
      .select({ businessPhone: businesses.phone, businessEmail: businesses.contactEmail })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    return row ?? { businessPhone: null, businessEmail: null };
  },
);
