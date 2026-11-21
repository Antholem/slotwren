import "server-only";

import { and, asc, eq, exists, isNull, sql } from "drizzle-orm";
import { cache } from "react";

import type {
  BookingPageData,
  PublicBookingConfirmation,
  PublicService,
  PublicStaff,
} from "@/lib/booking-page";

import { adminQuery, type TenantScoped } from "../../admin";
import {
  availabilityRules,
  bookings,
  businesses,
  services,
  staff,
  staffServices,
} from "../../schema";

/*
 * What the public booking page (/b/[slug]) reads, by the business ID its slug
 * resolved to. Explicit public columns only: never contact details, settings
 * beyond opening hours, notes, customers or token hashes
 * (tests/integration/public-data.test.ts).
 */

/**
 * The business's public profile, the services customers can book (active, not
 * archived, with at least one active person assigned) and the people who do
 * them (active, assigned to at least one of those services).
 */
const loadBookingPage = adminQuery(
  async (db, { businessId }: TenantScoped): Promise<BookingPageData | null> => {
    const [business] = await db
      .select({
        id: businesses.id,
        slug: businesses.slug,
        name: businesses.name,
        logoUrl: businesses.logoUrl,
        brandColor: businesses.brandColor,
        address: businesses.address,
        timezone: businesses.timezone,
        currency: businesses.currency,
        cancellationWindowHours: businesses.cancellationWindowHours,
        maxDaysAhead: businesses.maxDaysAhead,
        // Only this key of settings is public.
        openingHours: sql<
          { weekday: number; start: string; end: string }[]
        >`coalesce(${businesses.settings} -> 'openingHours', '[]'::jsonb)`,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    if (!business) return null;

    const [serviceRows, staffRows, links] = await Promise.all([
      db
        .select({
          id: services.id,
          name: services.name,
          durationMin: services.durationMin,
          priceCents: services.priceCents,
        })
        .from(services)
        .where(
          and(
            eq(services.businessId, businessId),
            eq(services.active, true),
            isNull(services.archivedAt),
          ),
        )
        .orderBy(asc(services.sortOrder), asc(services.name)),
      db
        .select({ id: staff.id, name: staff.name, title: staff.title, color: staff.color })
        .from(staff)
        .where(
          and(
            eq(staff.businessId, businessId),
            eq(staff.active, true),
            // Someone with no working hours has no times: don't offer them (L6).
            exists(
              db
                .select({ one: sql`1` })
                .from(availabilityRules)
                .where(
                  and(
                    eq(availabilityRules.businessId, businessId),
                    eq(availabilityRules.staffId, staff.id),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(staff.sortOrder), asc(staff.createdAt)),
      db
        .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
        .from(staffServices)
        .where(eq(staffServices.businessId, businessId)),
    ]);

    const bookableServiceIds = new Set(serviceRows.map((s) => s.id));
    const activeStaffIds = new Set(staffRows.map((s) => s.id));
    const live = links.filter(
      (l) => bookableServiceIds.has(l.serviceId) && activeStaffIds.has(l.staffId),
    );
    const servicesList: PublicService[] = serviceRows.filter((s) =>
      live.some((l) => l.serviceId === s.id),
    );
    const staffList: PublicStaff[] = staffRows
      .map((person) => ({
        ...person,
        serviceIds: live.filter((l) => l.staffId === person.id).map((l) => l.serviceId),
      }))
      .filter((person) => person.serviceIds.length > 0);

    return { business, services: servicesList, staff: staffList };
  },
);

// Page, metadata and OG image share one load per request.
export const getBookingPage = cache((businessId: string) => loadBookingPage({ businessId }));

/**
 * A booking as its confirmation page shows it: no customer, no token, no
 * notes. Found by its (unguessable) ID within the business only.
 */
export const getBookingConfirmation = adminQuery(
  async (
    db,
    { businessId, bookingId }: TenantScoped & { bookingId: string },
  ): Promise<PublicBookingConfirmation | null> => {
    const [row] = await db
      .select({
        id: bookings.id,
        code: bookings.code,
        status: bookings.status,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        serviceName: services.name,
        durationMin: services.durationMin,
        staffName: staff.name,
        priceCents: bookings.priceCents,
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
      .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)));
    return row ?? null;
  },
);
