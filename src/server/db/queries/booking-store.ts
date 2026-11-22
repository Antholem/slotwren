import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import type { BookingStatus, SlotBusiness, SlotService, SlotStaff } from "@/server/booking/slots";

import type { Transaction } from "../client";
import {
  availabilityRules,
  bookingEvents,
  bookings,
  businesses,
  customers,
  manageTokens,
  services,
  staff,
  staffServices,
  timeOff,
} from "../schema";

/*
 * Every read and write the booking service (src/server/booking/service.ts)
 * makes, bound to one transaction and one business: each query filters by
 * `businessId`. Two doors open it: withPublicBookings (adminDb, no user:
 * booking page, manage links, AI) in ./public/bookings.ts, and
 * withMemberBookings (withRls, the dashboard) in ./bookings.ts, where RLS
 * applies on top.
 */

export const BLOCKING_STATUSES = ["pending", "confirmed"] as const satisfies BookingStatus[];

export type SlotContext = {
  business: SlotBusiness & { name: string; slug: string; cancellationWindowHours: number };
  service: SlotService & {
    name: string;
    priceCents: number;
    active: boolean;
    archived: boolean;
  };
  staff: (SlotStaff & { name: string; color: "teal" | "violet" | "pink" })[];
};

export type LockedBooking = {
  id: string;
  code: string;
  serviceId: string;
  staffId: string;
  customerId: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
};

export type BookingSummary = {
  id: string;
  businessId: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
  customerTimezone: string | null;
  serviceName: string;
  staffId: string;
  staffName: string;
  customerName: string;
  customerEmail: string;
  businessName: string;
  businessSlug: string;
  businessTimezone: string;
  status: BookingStatus;
  source: "page" | "widget" | "ai" | "manual";
  priceCents: number;
  durationMin: number;
  customerPhone: string | null;
  customerNotes: string | null;
  createdAt: Date;
  businessBrandColor: string;
  businessAddress: string | null;
  businessLogoUrl: string | null;
  businessContactEmail: string | null;
  businessCurrency: string;
  cancellationWindowHours: number;
  /** settings.notifications.ownerNewBookingEmail; on unless turned off. */
  ownerNewBookingEmail: boolean;
};

export type BookingInsert = {
  serviceId: string;
  staffId: string;
  customerId: string;
  startsAt: Date;
  endsAt: Date;
  bufferedStart: Date;
  bufferedEnd: Date;
  source: "page" | "widget" | "ai" | "manual";
  priceCents: number;
  code: string;
  customerName: string;
  customerPhone: string | null;
  customerNotes: string | null;
  customerTimezone: string | null;
  createdByUserId: string | null;
  aiConversationId: string | null;
};

export function bookingStore(tx: Transaction, businessId: string) {
  return {
    businessId,

    /** The rules a change is checked against (cancellation window). */
    async rules(): Promise<{ cancellationWindowHours: number } | null> {
      const [row] = await tx
        .select({ cancellationWindowHours: businesses.cancellationWindowHours })
        .from(businesses)
        .where(eq(businesses.id, businessId));
      return row ?? null;
    },

    /**
     * What the slot engine needs to judge starts in `[from, to)`: the business
     * rules, the service, and every staff member with their hours, time off and
     * blocking bookings near the window. Null if the service isn't this
     * business's. `excludeBookingId` leaves a booking out (one being moved).
     */
    async loadSlotContext({
      serviceId,
      from,
      to,
      excludeBookingId,
    }: {
      serviceId: string;
      from: Date;
      to: Date;
      excludeBookingId?: string;
    }): Promise<SlotContext | null> {
      const [business] = await tx
        .select({
          name: businesses.name,
          slug: businesses.slug,
          timezone: businesses.timezone,
          minNoticeMin: businesses.minNoticeMin,
          maxDaysAhead: businesses.maxDaysAhead,
          slotIntervalMin: businesses.slotIntervalMin,
          cancellationWindowHours: businesses.cancellationWindowHours,
        })
        .from(businesses)
        .where(eq(businesses.id, businessId));
      const [service] = await tx
        .select({
          id: services.id,
          name: services.name,
          durationMin: services.durationMin,
          priceCents: services.priceCents,
          bufferBeforeMin: services.bufferBeforeMin,
          bufferAfterMin: services.bufferAfterMin,
          active: services.active,
          archivedAt: services.archivedAt,
        })
        .from(services)
        .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)));
      if (!business || !service) return null;

      // A day either side covers the local date of any start in the window
      // (for "any" assignment) and every buffer.
      const near = {
        from: new Date(from.getTime() - 86_400_000),
        to: new Date(to.getTime() + 86_400_000),
      };
      const [people, offers, rules, away, busy] = await Promise.all([
        tx
          .select({
            id: staff.id,
            name: staff.name,
            color: staff.color,
            active: staff.active,
            sortOrder: staff.sortOrder,
          })
          .from(staff)
          .where(eq(staff.businessId, businessId))
          .orderBy(staff.sortOrder, staff.createdAt),
        tx
          .select({ staffId: staffServices.staffId })
          .from(staffServices)
          .where(
            and(eq(staffServices.businessId, businessId), eq(staffServices.serviceId, serviceId)),
          ),
        tx
          .select({
            staffId: availabilityRules.staffId,
            weekday: availabilityRules.weekday,
            startTime: availabilityRules.startTime,
            endTime: availabilityRules.endTime,
          })
          .from(availabilityRules)
          .where(eq(availabilityRules.businessId, businessId)),
        tx
          .select({ staffId: timeOff.staffId, startsAt: timeOff.startsAt, endsAt: timeOff.endsAt })
          .from(timeOff)
          .where(
            and(
              eq(timeOff.businessId, businessId),
              lt(timeOff.startsAt, near.to),
              gt(timeOff.endsAt, near.from),
            ),
          ),
        tx
          .select({
            staffId: bookings.staffId,
            bufferedStart: bookings.bufferedStart,
            bufferedEnd: bookings.bufferedEnd,
            status: bookings.status,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.businessId, businessId),
              inArray(bookings.status, BLOCKING_STATUSES),
              lt(bookings.bufferedStart, near.to),
              gt(bookings.bufferedEnd, near.from),
              excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined,
            ),
          ),
      ]);

      const offering = new Set(offers.map((o) => o.staffId));
      return {
        business,
        service: {
          ...service,
          archived: service.archivedAt !== null,
        },
        staff: people.map((person) => ({
          ...person,
          serviceIds: offering.has(person.id) ? [serviceId] : [],
          hours: rules.filter((r) => r.staffId === person.id),
          timeOff: away.filter((t) => t.staffId === person.id),
          bookings: busy.filter((b) => b.staffId === person.id),
        })),
      };
    },

    /**
     * The customer with this email (case-insensitive), created if new.
     *
     * From the public page (`updateExisting: false`) an existing customer is
     * used exactly as the business has them: anyone can type any email, so a
     * booking must never rename, re-phone or re-zone someone. What was typed is
     * kept on the booking instead. The team (`updateExisting: true`) may fill a
     * missing phone and update the last-seen timezone.
     */
    async upsertCustomer(
      values: { name: string; email: string; phone: string | null; timezone: string | null },
      { updateExisting }: { updateExisting: boolean },
    ): Promise<string> {
      if (updateExisting) {
        const rows = await tx.execute<{ id: string }>(sql`
          insert into ${customers} (business_id, name, email, phone, timezone)
          values (${businessId}, ${values.name}, ${values.email}, ${values.phone}, ${values.timezone})
          on conflict (business_id, lower(email)) do update
            set timezone = coalesce(excluded.timezone, ${customers.timezone}),
                phone = coalesce(${customers.phone}, excluded.phone),
                updated_at = now()
          returning id
        `);
        return rows[0]!.id;
      }
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into ${customers} (business_id, name, email, phone, timezone)
        values (${businessId}, ${values.name}, ${values.email}, ${values.phone}, ${values.timezone})
        on conflict (business_id, lower(email)) do nothing
        returning id
      `);
      if (inserted[0]) return inserted[0].id;
      const [existing] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, businessId),
            sql`lower(${customers.email}) = lower(${values.email})`,
          ),
        );
      return existing!.id;
    },

    async insertBooking(values: BookingInsert): Promise<string> {
      const id = randomUUID();
      await tx.insert(bookings).values({ id, businessId, status: "confirmed", ...values });
      return id;
    },

    /**
     * Lock a booking row for a change. Null if it isn't this business's, or
     * (under RLS) the member may see it but not change it: `visible` says which.
     */
    async lockBooking(
      bookingId: string,
    ): Promise<{ booking: LockedBooking | null; visible: boolean }> {
      const columns = {
        id: bookings.id,
        code: bookings.code,
        serviceId: bookings.serviceId,
        staffId: bookings.staffId,
        customerId: bookings.customerId,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        status: bookings.status,
      };
      const where = and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId));
      const [locked] = await tx.select(columns).from(bookings).where(where).for("update");
      if (locked) return { booking: locked, visible: true };
      const [seen] = await tx.select({ id: bookings.id }).from(bookings).where(where);
      return { booking: null, visible: !!seen };
    },

    /** A booking as it is now, without locking it (reads: who else could take it). */
    async findBooking(bookingId: string): Promise<LockedBooking | null> {
      const [row] = await tx
        .select({
          id: bookings.id,
          code: bookings.code,
          serviceId: bookings.serviceId,
          staffId: bookings.staffId,
          customerId: bookings.customerId,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          status: bookings.status,
        })
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)));
      return row ?? null;
    },

    /** Move a booking. False if nothing was updated (RLS filtered it). */
    async moveBooking(
      bookingId: string,
      values: {
        staffId: string;
        startsAt: Date;
        endsAt: Date;
        bufferedStart: Date;
        bufferedEnd: Date;
      },
    ): Promise<boolean> {
      const rows = await tx
        .update(bookings)
        .set(values)
        .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)))
        .returning({ id: bookings.id });
      return rows.length > 0;
    },

    /**
     * Issue a manage link: store the token's hash through
     * private.mint_manage_token(), which checks a signed-in member may change
     * this booking and sets the expiry to the appointment's end.
     */
    async mintManageToken(
      bookingId: string,
      tokenHash: string,
      purpose: "created" | "rescheduled" | "reminder",
    ) {
      await tx.execute(
        sql`select private.mint_manage_token(${bookingId}, ${tokenHash}, ${purpose}::public.manage_token_purpose)`,
      );
    },

    /**
     * Retire every live manage link for a booking (a customer moved it: the
     * new email carries the only link). Server paths only: members can't
     * write manage_tokens, so under RLS this changes nothing.
     */
    async revokeManageTokens(bookingId: string, at: Date) {
      await tx
        .update(manageTokens)
        .set({ revokedAt: at })
        .where(
          and(
            eq(manageTokens.bookingId, bookingId),
            eq(manageTokens.businessId, businessId),
            isNull(manageTokens.revokedAt),
          ),
        );
    },

    async cancelBooking(
      bookingId: string,
      values: { cancelledAt: Date; cancelledBy: "customer" | "staff"; cancelReason: string | null },
    ): Promise<boolean> {
      const rows = await tx
        .update(bookings)
        .set({ status: "cancelled", ...values })
        .where(
          and(
            eq(bookings.id, bookingId),
            eq(bookings.businessId, businessId),
            inArray(bookings.status, BLOCKING_STATUSES),
          ),
        )
        .returning({ id: bookings.id });
      return rows.length > 0;
    },

    /**
     * Record how an active booking went (completed or no-show). False if
     * nothing was updated: it changed meanwhile, or RLS filtered it.
     */
    async setOutcome(bookingId: string, outcome: "completed" | "no_show"): Promise<boolean> {
      const rows = await tx
        .update(bookings)
        .set({ status: outcome })
        .where(
          and(
            eq(bookings.id, bookingId),
            eq(bookings.businessId, businessId),
            inArray(bookings.status, BLOCKING_STATUSES),
          ),
        )
        .returning({ id: bookings.id });
      return rows.length > 0;
    },

    /**
     * Append to the audit trail. Under withRls a trigger records the signed-in
     * member as the actor whatever is passed here.
     */
    async addEvent(event: {
      bookingId: string;
      type: "created" | "rescheduled" | "cancelled" | "completed" | "no_show";
      actor: "customer" | "staff" | "ai" | "system";
      data: Record<string, unknown>;
    }) {
      await tx.insert(bookingEvents).values({ businessId, ...event });
    },

    /** What a confirmation or cancellation email shows. */
    async summary(bookingId: string): Promise<BookingSummary | null> {
      const [row] = await tx
        .select({
          id: bookings.id,
          businessId: bookings.businessId,
          code: bookings.code,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          customerTimezone: bookings.customerTimezone,
          serviceName: services.name,
          staffId: bookings.staffId,
          staffName: staff.name,
          // What the customer typed on this booking, not the business's record.
          customerName: bookings.customerName,
          customerEmail: customers.email,
          businessName: businesses.name,
          businessSlug: businesses.slug,
          businessTimezone: businesses.timezone,
          status: bookings.status,
          source: bookings.source,
          priceCents: bookings.priceCents,
          durationMin: services.durationMin,
          customerPhone: bookings.customerPhone,
          customerNotes: bookings.customerNotes,
          createdAt: bookings.createdAt,
          businessBrandColor: businesses.brandColor,
          businessAddress: businesses.address,
          businessLogoUrl: businesses.logoUrl,
          businessContactEmail: businesses.contactEmail,
          businessCurrency: businesses.currency,
          cancellationWindowHours: businesses.cancellationWindowHours,
          ownerNewBookingEmail: sql<boolean>`coalesce((${businesses.settings} -> 'notifications' ->> 'ownerNewBookingEmail')::boolean, true)`,
        })
        .from(bookings)
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
        .innerJoin(businesses, eq(businesses.id, bookings.businessId))
        .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)));
      return row ?? null;
    },
  };
}

export type BookingStore = ReturnType<typeof bookingStore>;
