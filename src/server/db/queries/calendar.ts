import "server-only";

import { and, asc, desc, eq, gt, ilike, isNull, lt, or, sql } from "drizzle-orm";

import type { AppointmentStatus } from "@/lib/today";

import { type RlsClaims, withRls } from "../client";
import {
  availabilityRules,
  bookingEvents,
  bookings,
  businesses,
  customers,
  profiles,
  services,
  staff,
  staffServices,
  timeOff,
} from "../schema";

/*
 * The calendar, the booking drawer and the manual-booking sheet, as the
 * signed-in member (withRls), always filtered by business_id. Members see the
 * whole team's calendar (RLS: bookings are readable by every member); what
 * they may change is decided by the booking service and RLS.
 */

type StaffColor = "teal" | "violet" | "pink";
type Source = "page" | "widget" | "ai" | "manual";

export type CalendarStaff = {
  id: string;
  name: string;
  color: StaffColor;
  /** This row is the signed-in member. */
  isMe: boolean;
  /** Weekly hours, weekday 0 = Sunday, local "HH:MM". */
  hours: { weekday: number; start: string; end: string }[];
  timeOff: { startsAt: Date; endsAt: Date }[];
};

export type CalendarBooking = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  source: Source;
  staffId: string;
  customerName: string;
  serviceName: string;
};

export type CalendarData = { staff: CalendarStaff[]; bookings: CalendarBooking[] };

/** Staff, their hours and time off, and every booking overlapping `[from, to)`. */
export async function getCalendar(
  claims: RlsClaims,
  businessId: string,
  { from, to }: { from: Date; to: Date },
): Promise<CalendarData> {
  return withRls(claims, async (tx) => {
    const people = await tx
      .select({
        id: staff.id,
        name: staff.name,
        color: staff.color,
        active: staff.active,
        userId: staff.userId,
      })
      .from(staff)
      .where(eq(staff.businessId, businessId))
      .orderBy(asc(staff.sortOrder), asc(staff.createdAt));
    const rules = await tx
      .select({
        staffId: availabilityRules.staffId,
        weekday: availabilityRules.weekday,
        start: availabilityRules.startTime,
        end: availabilityRules.endTime,
      })
      .from(availabilityRules)
      .where(eq(availabilityRules.businessId, businessId))
      .orderBy(asc(availabilityRules.startTime));
    const away = await tx
      .select({ staffId: timeOff.staffId, startsAt: timeOff.startsAt, endsAt: timeOff.endsAt })
      .from(timeOff)
      .where(
        and(eq(timeOff.businessId, businessId), lt(timeOff.startsAt, to), gt(timeOff.endsAt, from)),
      );
    const booked = await tx
      .select({
        id: bookings.id,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        status: bookings.status,
        source: bookings.source,
        staffId: bookings.staffId,
        customerName: bookings.customerName,
        serviceName: services.name,
      })
      .from(bookings)
      .innerJoin(
        services,
        and(eq(services.id, bookings.serviceId), eq(services.businessId, bookings.businessId)),
      )
      .where(
        and(
          eq(bookings.businessId, businessId),
          lt(bookings.startsAt, to),
          gt(bookings.endsAt, from),
        ),
      )
      .orderBy(asc(bookings.startsAt), asc(bookings.id));

    const busy = new Set(booked.map((b) => b.staffId));
    return {
      staff: people
        .filter((person) => person.active || busy.has(person.id))
        .map((person) => ({
          id: person.id,
          name: person.name,
          color: person.color,
          isMe: person.userId === claims.sub,
          hours: rules
            .filter((r) => r.staffId === person.id)
            .map((r) => ({
              weekday: r.weekday,
              start: r.start.slice(0, 5),
              end: r.end.slice(0, 5),
            })),
          timeOff: away
            .filter((t) => t.staffId === person.id)
            .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
        })),
      bookings: booked,
    };
  });
}

export type BookingEventRow = {
  id: string;
  type: "created" | "rescheduled" | "cancelled" | "completed" | "no_show" | "reminder_sent";
  actor: "customer" | "staff" | "ai" | "system";
  /** The member who did it (profile name), when a member did. */
  actorName: string | null;
  data: Record<string, unknown> | null;
  createdAt: Date;
};

export type BookingDetail = {
  id: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  source: Source;
  priceCents: number;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  staffId: string;
  staffName: string;
  staffColor: StaffColor;
  /** The signed-in member is this booking's staff member. */
  isMine: boolean;
  customerId: string;
  /** As typed on the booking; the business's record has the email. */
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  notes: string | null;
  cancelReason: string | null;
  /** Customers may cancel or move it online until this many hours before. */
  cancellationWindowHours: number;
  events: BookingEventRow[];
};

/** One booking for the drawer, with its history (newest last). Null if not this business's. */
export async function getBookingDetail(
  claims: RlsClaims,
  businessId: string,
  bookingId: string,
): Promise<BookingDetail | null> {
  return withRls(claims, async (tx) => {
    const [row] = await tx
      .select({
        id: bookings.id,
        code: bookings.code,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        status: bookings.status,
        source: bookings.source,
        priceCents: bookings.priceCents,
        serviceId: bookings.serviceId,
        serviceName: services.name,
        durationMin: services.durationMin,
        staffId: bookings.staffId,
        staffName: staff.name,
        staffColor: staff.color,
        staffUserId: staff.userId,
        customerId: bookings.customerId,
        customerName: bookings.customerName,
        customerEmail: customers.email,
        customerPhone: sql<string | null>`coalesce(${bookings.customerPhone}, ${customers.phone})`,
        notes: bookings.customerNotes,
        cancelReason: bookings.cancelReason,
        cancellationWindowHours: businesses.cancellationWindowHours,
      })
      .from(bookings)
      .innerJoin(businesses, eq(businesses.id, bookings.businessId))
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
      .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)));
    if (!row) return null;

    const events = await tx
      .select({
        id: bookingEvents.id,
        type: bookingEvents.type,
        actor: bookingEvents.actor,
        actorName: profiles.fullName,
        data: bookingEvents.data,
        createdAt: bookingEvents.createdAt,
      })
      .from(bookingEvents)
      .leftJoin(profiles, eq(profiles.id, bookingEvents.actorUserId))
      .where(and(eq(bookingEvents.businessId, businessId), eq(bookingEvents.bookingId, bookingId)))
      .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id));

    const { staffUserId, ...detail } = row;
    return { ...detail, isMine: staffUserId === claims.sub, events };
  });
}

export type BookingOptions = {
  /** Not archived; "bookable online" off still bookable by the team. */
  services: { id: string; name: string; durationMin: number; priceCents: number }[];
  staff: { id: string; name: string; color: StaffColor; isMe: boolean; serviceIds: string[] }[];
};

/** What the manual-booking sheet offers: services, and active staff with what they do. */
export async function getBookingOptions(
  claims: RlsClaims,
  businessId: string,
): Promise<BookingOptions> {
  return withRls(claims, async (tx) => {
    const offered = await tx
      .select({
        id: services.id,
        name: services.name,
        durationMin: services.durationMin,
        priceCents: services.priceCents,
      })
      .from(services)
      .where(and(eq(services.businessId, businessId), isNull(services.archivedAt)))
      .orderBy(asc(services.sortOrder), asc(services.createdAt));
    const people = await tx
      .select({ id: staff.id, name: staff.name, color: staff.color, userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.businessId, businessId), eq(staff.active, true)))
      .orderBy(asc(staff.sortOrder), asc(staff.createdAt));
    const links = await tx
      .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
      .from(staffServices)
      .where(eq(staffServices.businessId, businessId));
    return {
      services: offered,
      staff: people.map((person) => ({
        id: person.id,
        name: person.name,
        color: person.color,
        isMe: person.userId === claims.sub,
        serviceIds: links.filter((l) => l.staffId === person.id).map((l) => l.serviceId),
      })),
    };
  });
}

export type CustomerMatch = { id: string; name: string; email: string; phone: string | null };

/** Customers whose name or email contains `query` (case-insensitive), at most 8. */
export async function searchCustomers(
  claims: RlsClaims,
  businessId: string,
  query: string,
): Promise<CustomerMatch[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return withRls(claims, (tx) =>
    tx
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
      })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, businessId),
          or(ilike(customers.name, pattern), ilike(customers.email, pattern)),
        ),
      )
      .orderBy(desc(customers.updatedAt))
      .limit(8),
  );
}
