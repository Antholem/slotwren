import "server-only";

import { z } from "zod";

import { env } from "@/env";
import { formatInZone } from "@/lib/dates";
import { err, ok, type Result } from "@/lib/result";
import { isValidTimeZone } from "@/lib/timezones";
import { zoneClock } from "@/lib/zone-clock";
import { BookingCancelledEmail } from "@/emails/booking-cancelled";
import type { Actor } from "@/server/catalog/services";
import { isUniqueViolation, pgError } from "@/server/db/errors";
import type { BookingStore, BookingSummary, SlotContext } from "@/server/db/queries/booking-store";
import { withMemberBookings } from "@/server/db/queries/bookings";
import { findBookingByManageToken, withPublicBookings } from "@/server/db/queries/public/bookings";
import { sendEmail } from "@/server/email/send";

import { generateBookingCode } from "./codes";
import { getAvailableSlots, labelFor, type Slot } from "./slots";
import { generateToken, hashToken } from "./tokens";

/*
 * THE booking write path (CLAUDE.md, rule 3). The public page, the embed, the
 * AI receptionist's Confirm button and the dashboard all create, move and
 * cancel bookings here, never anywhere else.
 *
 * - Every change runs in one transaction: re-check the slot with the slot
 *   engine, write the booking, append to booking_events.
 * - The slot check is a courtesy, not the guarantee: two customers can pass it
 *   at the same moment. The no_double_booking exclusion constraint decides,
 *   and its SQLSTATE 23P01 becomes "That time was just taken".
 * - Who may act: public creates are scoped to the business the slug resolved
 *   to; customers change a booking with its manage token; members act through
 *   withRls, so RLS decides whose bookings they may touch.
 * - Members (manual bookings, the team calendar) aren't held to minimum notice
 *   or the booking window, which are for customers. Nobody books the past.
 *
 * Tested in tests/integration/booking-service.test.ts.
 */

export type PublicSource = "page" | "widget" | "ai";

/** Who is creating a booking. */
export type BookingChannel =
  | { kind: "public"; businessId: string; source: PublicSource; aiConversationId?: string | null }
  | { kind: "member"; actor: Actor };

/** Who is changing a booking, and which one. */
export type BookingAccess =
  { kind: "customer"; manageToken: string } | { kind: "member"; actor: Actor; bookingId: string };

export type BookingError =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "slot_unavailable"
  | "slot_taken"
  | "not_active"
  | "too_late";

export const BOOKING_MESSAGES = {
  serviceGone: "That service isn't available to book any more.",
  bookingGone: "We couldn't find that booking. Check the link, or contact the business.",
  unavailable: "That time isn't available any more. Pick another time.",
  taken: "That time was just taken. Pick another time.",
  forbidden: "You can change only your own bookings. Ask an owner to change anyone else's.",
  notActive: "This booking is already cancelled, so it can't be changed.",
} as const;

const tooLate = (hours: number) =>
  `Online changes close ${hours} ${hours === 1 ? "hour" : "hours"} before the appointment. ` +
  "Contact the business to change it.";

const instant = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), "Pick a time.");

const staffChoice = z.union([z.literal("any"), z.uuid("Pick someone from the list.")]);

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => value || null);

const createSchema = z.object({
  serviceId: z.uuid("Pick a service."),
  staffId: staffChoice,
  startsAt: instant,
  customer: z.object({
    name: z
      .string()
      .trim()
      .min(1, "Enter your name.")
      .max(80, "Keep your name under 80 characters."),
    email: z
      .string()
      .trim()
      .max(254, "That email address is too long.")
      .pipe(z.email("Enter a valid email address.")),
    phone: optionalText(40, "That phone number is too long."),
  }),
  notes: optionalText(500, "Keep notes under 500 characters."),
  customerTimezone: z
    .string()
    .refine(isValidTimeZone, "Unknown timezone.")
    .optional()
    .transform((value) => value ?? null),
});

const rescheduleSchema = z.object({
  startsAt: instant,
  /** Default: keep the same staff member. */
  staffId: staffChoice.optional(),
});

const cancelSchema = z.object({
  /** Stored on the booking for the team. Never sent to the customer. */
  reason: optionalText(200, "Keep the reason under 200 characters."),
});

export type CreatedBooking = {
  id: string;
  code: string;
  /** The manage link's token. Returned once; only its hash is stored. */
  manageToken: string;
  startsAt: Date;
  endsAt: Date;
  staffId: string;
  staffName: string;
  serviceName: string;
  priceCents: number;
};

export type MovedBooking = { id: string; startsAt: Date; endsAt: Date; staffId: string };

export type CancelledBooking = {
  id: string;
  code: string;
  /** Null when no email was asked for; otherwise whether it went out. */
  notified: boolean | null;
};

const MIN = 60_000;

/** Ends the transaction (rolling back any writes) with an expected failure. */
class Rollback extends Error {
  constructor(readonly result: Result<never, BookingError>) {
    super(result.ok ? "rollback" : result.error.code);
  }
}

function invalid(error: z.ZodError): Result<never, BookingError> {
  const { fieldErrors, formErrors } = z.flattenError(error);
  const first = formErrors[0] ?? (Object.values(fieldErrors).flat()[0] as string | undefined);
  return err(
    "invalid_input",
    first ?? "Check the highlighted fields.",
    fieldErrors as Record<string, string[]>,
  );
}

/** Expected database refusals as values; anything else is a bug and throws. */
function settleError(error: unknown): Result<never, BookingError> {
  if (error instanceof Rollback) return error.result;
  const { code } = pgError(error);
  if (code === "23P01") return err("slot_taken", BOOKING_MESSAGES.taken);
  if (code === "42501") return err("forbidden", BOOKING_MESSAGES.forbidden);
  throw error;
}

/**
 * The slot the engine offers at exactly `startsAt`, or null. Members skip
 * minimum notice and get a year's window; nobody gets the past.
 */
function slotAt(
  context: SlotContext,
  {
    staffId,
    startsAt,
    now,
    member,
  }: { staffId: string; startsAt: Date; now: Date; member: boolean },
): Slot | null {
  const business = member
    ? { ...context.business, minNoticeMin: 0, maxDaysAhead: 365 }
    : context.business;
  const [slot] = getAvailableSlots({
    business,
    service: context.service,
    staff: context.staff,
    staffId,
    from: startsAt,
    to: new Date(startsAt.getTime() + 1),
    now,
  });
  return slot && slot.start.getTime() === startsAt.getTime() ? slot : null;
}

function buffered(context: SlotContext, slot: Slot) {
  return {
    bufferedStart: new Date(slot.start.getTime() - context.service.bufferBeforeMin * MIN),
    bufferedEnd: new Date(slot.end.getTime() + context.service.bufferAfterMin * MIN),
  };
}

// ── create ────────────────────────────────────────────────────────────

/**
 * Book `input.startsAt` for the customer. Re-checks the slot, creates or
 * reuses the customer by email, snapshots the price, and returns the manage
 * token once.
 */
export async function createBooking(
  channel: BookingChannel,
  input: unknown,
  { now = new Date() }: { now?: Date } = {},
): Promise<Result<CreatedBooking, BookingError>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const values = parsed.data;
  const member = channel.kind === "member";

  const work = async (store: BookingStore): Promise<CreatedBooking> => {
    const context = await store.loadSlotContext({
      serviceId: values.serviceId,
      from: values.startsAt,
      to: values.startsAt,
    });
    // "Bookable online" off still lets the team book it by hand.
    if (!context || context.service.archived || (!member && !context.service.active)) {
      throw new Rollback(err("not_found", BOOKING_MESSAGES.serviceGone));
    }
    const slot = slotAt(context, {
      staffId: values.staffId,
      startsAt: values.startsAt,
      now,
      member,
    });
    if (!slot) throw new Rollback(err("slot_unavailable", BOOKING_MESSAGES.unavailable));

    const customerId = await store.upsertCustomer({
      ...values.customer,
      timezone: values.customerTimezone,
    });
    const manageToken = generateToken();
    const code = generateBookingCode();
    const source = channel.kind === "public" ? channel.source : "manual";
    const id = await store.insertBooking({
      serviceId: context.service.id,
      staffId: slot.staffId,
      customerId,
      startsAt: slot.start,
      endsAt: slot.end,
      ...buffered(context, slot),
      source,
      priceCents: context.service.priceCents,
      code,
      manageTokenHash: hashToken(manageToken),
      customerNotes: values.notes,
      customerTimezone: values.customerTimezone,
      createdByUserId: channel.kind === "member" ? channel.actor.claims.sub : null,
      aiConversationId: channel.kind === "public" ? (channel.aiConversationId ?? null) : null,
    });
    await store.addEvent({
      bookingId: id,
      type: "created",
      // The customer confirmed it, even in the AI chat: the AI never writes.
      actor: member ? "staff" : "customer",
      data: { source, startsAt: slot.start.toISOString(), staffId: slot.staffId },
    });
    const person = context.staff.find((s) => s.id === slot.staffId)!;
    return {
      id,
      code,
      manageToken,
      startsAt: slot.start,
      endsAt: slot.end,
      staffId: slot.staffId,
      staffName: person.name,
      serviceName: context.service.name,
      priceCents: context.service.priceCents,
    };
  };

  // Booking codes are random; on the rare clash with an existing one, retry.
  for (let attempt = 1; ; attempt++) {
    try {
      const created =
        channel.kind === "public"
          ? await withPublicBookings(channel.businessId, work)
          : await withMemberBookings(channel.actor.claims, channel.actor.businessId, work);
      return ok(created);
    } catch (error) {
      if (attempt < 4 && isUniqueViolation(error, "bookings_business_code")) continue;
      return settleError(error);
    }
  }
}

// ── change: shared access ──────────────────────────────────────────────

type Opened = {
  bookingId: string;
  byCustomer: boolean;
  run<T>(work: (store: BookingStore) => Promise<T>): Promise<T>;
};

/** The store and booking a change applies to, or why there isn't one. */
async function open(access: BookingAccess): Promise<Opened | null> {
  if (access.kind === "member") {
    if (!z.uuid().safeParse(access.bookingId).success) return null;
    const { claims, businessId } = access.actor;
    return {
      bookingId: access.bookingId,
      byCustomer: false,
      run: (work) => withMemberBookings(claims, businessId, work),
    };
  }
  if (typeof access.manageToken !== "string" || access.manageToken.length < 20) return null;
  const found = await findBookingByManageToken({ tokenHash: hashToken(access.manageToken) });
  if (!found) return null;
  return {
    bookingId: found.bookingId,
    byCustomer: true,
    run: (work) => withPublicBookings(found.businessId, work),
  };
}

/** Lock the booking and check it may still change. Throws Rollback otherwise. */
async function lockForChange(store: BookingStore, opened: Opened, now: Date) {
  const { booking, visible } = await store.lockBooking(opened.bookingId);
  if (!booking) {
    throw new Rollback(
      visible
        ? err("forbidden", BOOKING_MESSAGES.forbidden)
        : err("not_found", BOOKING_MESSAGES.bookingGone),
    );
  }
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    throw new Rollback(err("not_active", BOOKING_MESSAGES.notActive));
  }
  if (opened.byCustomer) {
    const rules = await store.rules();
    const hours = rules?.cancellationWindowHours ?? 0;
    if (now.getTime() > booking.startsAt.getTime() - hours * 3_600_000) {
      throw new Rollback(err("too_late", tooLate(hours)));
    }
  }
  return booking;
}

// ── reschedule ────────────────────────────────────────────────────────

/** Move a booking to `input.startsAt` (and optionally another staff member). */
export async function rescheduleBooking(
  access: BookingAccess,
  input: unknown,
  { now = new Date() }: { now?: Date } = {},
): Promise<Result<MovedBooking, BookingError>> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const opened = await open(access);
  if (!opened) return err("not_found", BOOKING_MESSAGES.bookingGone);

  try {
    const moved = await opened.run(async (store) => {
      const booking = await lockForChange(store, opened, now);
      const context = await store.loadSlotContext({
        serviceId: booking.serviceId,
        from: parsed.data.startsAt,
        to: parsed.data.startsAt,
        excludeBookingId: booking.id, // it may move into its own old time
      });
      if (!context) throw new Rollback(err("not_found", BOOKING_MESSAGES.bookingGone));
      const slot = slotAt(context, {
        staffId: parsed.data.staffId ?? booking.staffId,
        startsAt: parsed.data.startsAt,
        now,
        member: !opened.byCustomer,
      });
      if (!slot) throw new Rollback(err("slot_unavailable", BOOKING_MESSAGES.unavailable));

      const updated = await store.moveBooking(booking.id, {
        staffId: slot.staffId,
        startsAt: slot.start,
        endsAt: slot.end,
        ...buffered(context, slot),
      });
      if (!updated) throw new Rollback(err("forbidden", BOOKING_MESSAGES.forbidden));
      await store.addEvent({
        bookingId: booking.id,
        type: "rescheduled",
        actor: opened.byCustomer ? "customer" : "staff",
        data: {
          from: { startsAt: booking.startsAt.toISOString(), staffId: booking.staffId },
          to: { startsAt: slot.start.toISOString(), staffId: slot.staffId },
        },
      });
      return { id: booking.id, startsAt: slot.start, endsAt: slot.end, staffId: slot.staffId };
    });
    return ok(moved);
  } catch (error) {
    return settleError(error);
  }
}

// ── cancel ────────────────────────────────────────────────────────────

/**
 * Cancel a booking. Customers cancel with their manage link until the
 * cancellation window closes; members any time RLS allows. With `notify`, the
 * customer is emailed after the change commits (`customerMessage` is the only
 * explanation they see; the stored reason stays with the team).
 */
export async function cancelBooking(
  access: BookingAccess,
  input: unknown,
  {
    now = new Date(),
    notify = false,
    customerMessage = null,
  }: { now?: Date; notify?: boolean; customerMessage?: string | null } = {},
): Promise<Result<CancelledBooking, BookingError>> {
  const parsed = cancelSchema.safeParse(input ?? {});
  if (!parsed.success) return invalid(parsed.error);
  const opened = await open(access);
  if (!opened) return err("not_found", BOOKING_MESSAGES.bookingGone);

  let summary: BookingSummary | null;
  try {
    summary = await opened.run(async (store) => {
      const booking = await lockForChange(store, opened, now);
      const cancelled = await store.cancelBooking(booking.id, {
        cancelledAt: now,
        cancelledBy: opened.byCustomer ? "customer" : "staff",
        cancelReason: parsed.data.reason,
      });
      if (!cancelled) throw new Rollback(err("forbidden", BOOKING_MESSAGES.forbidden));
      await store.addEvent({
        bookingId: booking.id,
        type: "cancelled",
        actor: opened.byCustomer ? "customer" : "staff",
        data: { reason: parsed.data.reason, notified: notify },
      });
      return store.summary(booking.id);
    });
  } catch (error) {
    return settleError(error);
  }

  const id = summary?.id ?? opened.bookingId;
  const code = summary?.code ?? "";
  if (!notify || !summary) return ok({ id, code, notified: null });
  const sent = await sendCancellation(summary, customerMessage);
  return ok({ id, code, notified: sent });
}

/** "Thu 12 Nov · 10:00 GMT+8", in the customer's timezone when we know it. */
export function bookingWhen(startsAt: Date, zone: string): string {
  const label = labelFor(startsAt.getTime(), zoneClock(zone)).zone;
  return `${formatInZone(startsAt, zone, "EEE d MMM · HH:mm")} ${label}`;
}

async function sendCancellation(summary: BookingSummary, message: string | null) {
  const zone = summary.customerTimezone ?? summary.businessTimezone;
  const result = await sendEmail({
    to: summary.customerEmail,
    subject: `Cancelled: ${summary.serviceName} at ${summary.businessName}`,
    react: BookingCancelledEmail({
      businessName: summary.businessName,
      customerName: summary.customerName,
      serviceName: summary.serviceName,
      staffName: summary.staffName,
      when: bookingWhen(summary.startsAt, zone),
      code: summary.code,
      reason: message,
      bookAgainUrl: new URL(`/b/${summary.businessSlug}`, env.NEXT_PUBLIC_APP_URL).toString(),
    }),
    logLines: [`Booking ${summary.code} cancelled`],
  });
  return result.delivered;
}
