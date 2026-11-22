import "server-only";

import { z } from "zod";

import { err, ok, type Result } from "@/lib/result";
import { nextDate, zonedInstant } from "@/lib/time-off";
import { isValidTimeZone } from "@/lib/timezones";
import { customerSchema, notesSchema, optionalText } from "@/lib/validation/booking";
import type { Actor } from "@/server/catalog/services";
import { isUniqueViolation, pgError } from "@/server/db/errors";
import type { BookingStore, BookingSummary, SlotContext } from "@/server/db/queries/booking-store";
import { withMemberBookings } from "@/server/db/queries/bookings";
import { findBookingByManageToken, withPublicBookings } from "@/server/db/queries/public/bookings";
import { afterResponse } from "@/server/after-response";
import { emailConfigured } from "@/server/email/config";

import { queueCancellationEmails } from "./cancellation-emails";
import { generateBookingCode } from "./codes";
import { notifyBookingCancelled, notifyBookingCreated, notifyBookingRescheduled } from "./notify";
import { clearReminder, clearReminders, scheduleReminder } from "./reminders";
import { getAvailableSlots, type Slot } from "./slots";
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
  | "too_late"
  | "too_early";

export const BOOKING_MESSAGES = {
  serviceGone: "That service isn't available to book any more.",
  bookingGone: "We couldn't find that booking. Check the link, or contact the business.",
  unavailable: "That time isn't available any more. Pick another time.",
  taken: "That time was just taken. Pick another time.",
  forbidden: "You can change only your own bookings. Ask an owner to change anyone else's.",
  notActive: "This booking is already cancelled, so it can't be changed.",
  tooEarly: "You can mark an appointment once it has started.",
  alreadyMarked: "This appointment has already been marked. Refresh to see the latest.",
} as const;

const tooLate = (hours: number) =>
  `Online changes close ${hours} ${hours === 1 ? "hour" : "hours"} before the appointment. ` +
  "Contact the business to change it.";

const instant = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), "Pick a time.");

const staffChoice = z.union([z.literal("any"), z.uuid("Pick someone from the list.")]);

const createSchema = z.object({
  serviceId: z.uuid("Pick a service."),
  staffId: staffChoice,
  startsAt: instant,
  customer: customerSchema,
  notes: notesSchema,
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

const outcomeSchema = z.object({
  outcome: z.enum(["completed", "no_show"], "Pick Complete or No-show."),
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

export type MovedBooking = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  staffId: string;
  /**
   * A fresh manage link for the reschedule email. After a customer's own change
   * it's their only live link; after the business's, earlier ones still work.
   */
  manageToken: string;
};

export type CancelledBooking = {
  id: string;
  code: string;
  /**
   * Null when no email was asked for; otherwise whether it went out (in a
   * request it goes after the response: whether email is set up).
   */
  notified: boolean | null;
};

export type BookingOutcome = "completed" | "no_show";

export type RecordedOutcome = { id: string; status: BookingOutcome };

export type CancelledBookings = {
  cancelled: number;
  /** Changed meanwhile, or not this member's to cancel. */
  notCancelled: number;
  /** Customers emailed, or about to be. */
  notified: number;
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

  const work = async (
    store: BookingStore,
  ): Promise<{ created: CreatedBooking; summary: BookingSummary | null }> => {
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

    const customerId = await store.upsertCustomer(
      { ...values.customer, timezone: values.customerTimezone },
      // The public page never changes an existing customer (see the store).
      { updateExisting: member },
    );
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
      // As typed: the manage page and emails show these, not the stored customer.
      customerName: values.customer.name,
      customerPhone: values.customer.phone,
      customerNotes: values.notes,
      customerTimezone: values.customerTimezone,
      createdByUserId: channel.kind === "member" ? channel.actor.claims.sub : null,
      aiConversationId: channel.kind === "public" ? (channel.aiConversationId ?? null) : null,
    });
    // The confirmation email's manage link; only its hash is stored.
    await store.mintManageToken(id, hashToken(manageToken), "created");
    await store.addEvent({
      bookingId: id,
      type: "created",
      // The customer confirmed it, even in the AI chat: the AI never writes.
      actor: member ? "staff" : "customer",
      data: { source, startsAt: slot.start.toISOString(), staffId: slot.staffId },
    });
    const person = context.staff.find((s) => s.id === slot.staffId)!;
    return {
      created: {
        id,
        code,
        manageToken,
        startsAt: slot.start,
        endsAt: slot.end,
        staffId: slot.staffId,
        staffName: person.name,
        serviceName: context.service.name,
        priceCents: context.service.priceCents,
      },
      summary: await store.summary(id),
    };
  };

  // Booking codes are random; on the rare clash with an existing one, retry.
  for (let attempt = 1; ; attempt++) {
    try {
      const { created, summary } =
        channel.kind === "public"
          ? await withPublicBookings(channel.businessId, work)
          : await withMemberBookings(channel.actor.claims, channel.actor.businessId, work);
      // After the commit (and the response), and never able to undo it.
      if (summary) {
        await afterResponse(async () => {
          await notifyBookingCreated(summary, created.manageToken, now);
          await scheduleReminder(summary, now);
        }, undefined);
      }
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
async function open(access: BookingAccess, now: Date): Promise<Opened | null> {
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
  const found = await findBookingByManageToken({
    tokenHash: hashToken(access.manageToken),
    now,
  });
  if (!found) return null;
  return {
    bookingId: found.bookingId,
    byCustomer: true,
    run: (work) => withPublicBookings(found.businessId, work),
  };
}

/** Lock the booking and check it may still change. Throws Rollback otherwise. */
async function lockForChange(
  store: BookingStore,
  opened: Pick<Opened, "bookingId" | "byCustomer">,
  now: Date,
) {
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
  const opened = await open(access, now);
  if (!opened) return err("not_found", BOOKING_MESSAGES.bookingGone);

  try {
    const result = await opened.run(async (store) => {
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

      const manageToken = generateToken();
      const updated = await store.moveBooking(booking.id, {
        staffId: slot.staffId,
        startsAt: slot.start,
        endsAt: slot.end,
        ...buffered(context, slot),
      });
      if (!updated) throw new Rollback(err("forbidden", BOOKING_MESSAGES.forbidden));
      // A customer's own change retires every link they had: the email carries
      // the only one. When the business moves it, earlier links keep working.
      if (opened.byCustomer) await store.revokeManageTokens(booking.id, now);
      await store.mintManageToken(booking.id, hashToken(manageToken), "rescheduled");
      await store.addEvent({
        bookingId: booking.id,
        type: "rescheduled",
        actor: opened.byCustomer ? "customer" : "staff",
        data: {
          from: { startsAt: booking.startsAt.toISOString(), staffId: booking.staffId },
          to: { startsAt: slot.start.toISOString(), staffId: slot.staffId },
        },
      });
      return {
        moved: {
          id: booking.id,
          startsAt: slot.start,
          endsAt: slot.end,
          staffId: slot.staffId,
          manageToken,
        },
        previousStart: booking.startsAt,
        previousStaffId: booking.staffId,
        summary: await store.summary(booking.id),
      };
    });
    const { summary } = result;
    if (summary) {
      await afterResponse(async () => {
        await scheduleReminder(summary, now);
        await notifyBookingRescheduled(
          summary,
          {
            previousStart: result.previousStart,
            previousStaffId: result.previousStaffId,
            manageToken: result.moved.manageToken,
            byCustomer: opened.byCustomer,
          },
          now,
        );
      }, undefined);
    }
    return ok(result.moved);
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
  const opened = await open(access, now);
  if (!opened) return err("not_found", BOOKING_MESSAGES.bookingGone);

  let summary: BookingSummary | null;
  try {
    summary = await opened.run((store) =>
      cancelInStore(store, opened, { reason: parsed.data.reason, notify }, now),
    );
  } catch (error) {
    return settleError(error);
  }

  const id = summary?.id ?? opened.bookingId;
  const code = summary?.code ?? "";
  if (!summary) return ok({ id, code, notified: null });
  const cancelled = summary;
  // Customers always get a receipt; the team chooses whether to tell them.
  const email = notify || opened.byCustomer;
  const notified = await afterResponse(
    async () => {
      // Any planned reminder is dropped (the job would skip it anyway).
      await clearReminder(cancelled, now);
      if (!email) return null;
      return notifyBookingCancelled(cancelled, {
        byBusiness: !opened.byCustomer,
        message: customerMessage,
      });
    },
    email ? emailConfigured() : null,
  );
  return ok({ id, code, notified });
}

/** Cancel one booking inside the caller's transaction. Throws Rollback when it can't. */
async function cancelInStore(
  store: BookingStore,
  target: Pick<Opened, "bookingId" | "byCustomer">,
  { reason, notify }: { reason: string | null; notify: boolean },
  now: Date,
) {
  const booking = await lockForChange(store, target, now);
  const cancelled = await store.cancelBooking(booking.id, {
    cancelledAt: now,
    cancelledBy: target.byCustomer ? "customer" : "staff",
    cancelReason: reason,
  });
  if (!cancelled) throw new Rollback(err("forbidden", BOOKING_MESSAGES.forbidden));
  await store.addEvent({
    bookingId: booking.id,
    type: "cancelled",
    actor: target.byCustomer ? "customer" : "staff",
    data: { reason, notified: notify },
  });
  return store.summary(booking.id);
}

/**
 * Booking ids for a bulk change, in the order their rows get locked: valid
 * uuids, once each, sorted. Every bulk change locks in this same order, so two
 * overlapping ones (two tabs, two owners) wait for each other instead of
 * deadlocking. `invalid` counts what was dropped as junk.
 */
function lockOrder(bookingIds: string[]): { ids: string[]; invalid: number } {
  const distinct = [...new Set(bookingIds.map((id) => id.toLowerCase()))];
  const ids = distinct.filter((id) => z.uuid().safeParse(id).success).sort();
  return { ids, invalid: distinct.length - ids.length };
}

/**
 * Cancel several bookings for the team at once (time off over a busy day):
 * one transaction, then one Inngest event that emails each customer, so the
 * owner isn't kept waiting on an email per booking. Bookings that changed
 * meanwhile, or aren't this member's to cancel, are counted and left alone.
 */
export async function cancelBookingsForTeam(
  actor: Actor,
  bookingIds: string[],
  input: unknown,
  { now = new Date(), customerMessage }: { now?: Date; customerMessage: string },
): Promise<Result<CancelledBookings, BookingError>> {
  const parsed = cancelSchema.safeParse(input ?? {});
  if (!parsed.success) return invalid(parsed.error);
  const { ids, invalid: unusable } = lockOrder(bookingIds);
  let notCancelled = unusable;

  let summaries: BookingSummary[];
  try {
    summaries = await withMemberBookings(actor.claims, actor.businessId, async (store) => {
      const done: BookingSummary[] = [];
      for (const bookingId of ids) {
        try {
          const summary = await cancelInStore(
            store,
            { bookingId, byCustomer: false },
            { reason: parsed.data.reason, notify: true },
            now,
          );
          if (summary) done.push(summary);
        } catch (error) {
          // A check that failed before anything was written: skip this one.
          if (!(error instanceof Rollback)) throw error;
          notCancelled++;
        }
      }
      return done;
    });
  } catch (error) {
    return settleError(error);
  }
  // Locked in id order; customers hear about them in appointment order.
  summaries.sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());

  const cancelled = summaries.length;
  if (cancelled === 0) return ok({ cancelled, notCancelled, notified: 0 });
  const willEmail = emailConfigured() ? cancelled : 0;
  const notified = await afterResponse(async () => {
    await clearReminders(summaries, now);
    const queued = await queueCancellationEmails({
      businessId: actor.businessId,
      bookingIds: summaries.map((s) => s.id),
      message: customerMessage,
    });
    if (queued) return willEmail;
    // No Inngest (local without the dev server, tests): send them here.
    let sent = 0;
    for (const summary of summaries) {
      const delivered = await notifyBookingCancelled(summary, {
        byBusiness: true,
        message: customerMessage,
      });
      if (delivered) sent++;
    }
    return sent;
  }, willEmail);
  return ok({ cancelled, notCancelled, notified });
}

// ── outcome ───────────────────────────────────────────────────────────

/**
 * Mark how an appointment went: completed or no-show. Members only (owners
 * any booking, staff their own, by RLS), once it has started, and only while
 * it is still pending or confirmed. Marking it the same way twice (a double
 * tap, two tabs) succeeds without writing again. Nobody is emailed.
 */
export async function recordOutcome(
  actor: Actor,
  bookingId: string,
  input: unknown,
  { now = new Date() }: { now?: Date } = {},
): Promise<Result<RecordedOutcome, BookingError>> {
  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { outcome } = parsed.data;
  if (!z.uuid().safeParse(bookingId).success) {
    return err("not_found", BOOKING_MESSAGES.bookingGone);
  }

  try {
    return await withMemberBookings(actor.claims, actor.businessId, (store) =>
      outcomeInStore(store, bookingId, outcome, now),
    );
  } catch (error) {
    return settleError(error);
  }
}

/** Mark one booking inside the caller's transaction. Refusals are values; nothing is written for them. */
async function outcomeInStore(
  store: BookingStore,
  bookingId: string,
  outcome: BookingOutcome,
  now: Date,
): Promise<Result<RecordedOutcome, BookingError>> {
  const { booking, visible } = await store.lockBooking(bookingId);
  if (!booking) {
    return visible
      ? err("forbidden", BOOKING_MESSAGES.forbidden)
      : err("not_found", BOOKING_MESSAGES.bookingGone);
  }
  if (booking.status === outcome) return ok({ id: booking.id, status: outcome });
  if (booking.status === "cancelled") return err("not_active", BOOKING_MESSAGES.notActive);
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return err("not_active", BOOKING_MESSAGES.alreadyMarked);
  }
  if (now.getTime() < booking.startsAt.getTime()) {
    return err("too_early", BOOKING_MESSAGES.tooEarly);
  }
  if (!(await store.setOutcome(booking.id, outcome))) {
    return err("forbidden", BOOKING_MESSAGES.forbidden);
  }
  await store.addEvent({
    bookingId: booking.id,
    type: outcome,
    actor: "staff",
    data: { from: booking.status },
  });
  return ok({ id: booking.id, status: outcome });
}

export type RecordedOutcomes = {
  /** Marked now, or already marked that way. */
  marked: number;
  /** Not started yet, cancelled, marked the other way, or not this member's. */
  skipped: number;
};

/**
 * Mark several bookings at once (the Bookings table's bulk actions): one
 * transaction, the same rules as recordOutcome for each. Those that can't
 * be marked are counted and left alone.
 */
export async function recordOutcomes(
  actor: Actor,
  bookingIds: string[],
  input: unknown,
  { now = new Date() }: { now?: Date } = {},
): Promise<Result<RecordedOutcomes, BookingError>> {
  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { ids, invalid: unusable } = lockOrder(bookingIds);
  let skipped = unusable;
  let marked = 0;
  try {
    await withMemberBookings(actor.claims, actor.businessId, async (store) => {
      for (const id of ids) {
        const result = await outcomeInStore(store, id, parsed.data.outcome, now);
        if (result.ok) marked++;
        else skipped++;
      }
    });
  } catch (error) {
    return settleError(error);
  }
  return ok({ marked, skipped });
}

// ── member reads: what the team may book ──────────────────────────────

export type MemberSlot = {
  /** ISO instants. */
  start: string;
  end: string;
  staffId: string;
  /** Business-local "HH:MM", and which of a repeated hour (clocks going back). */
  time: string;
  repeated: "first" | "second" | null;
};

const memberSlotsSchema = z.object({
  serviceId: z.uuid("Pick a service."),
  staffId: staffChoice,
  date: z.iso.date("Pick a date."),
  excludeBookingId: z.uuid().optional(),
});

/**
 * Times the team may book `serviceId` on a business-local `date`: the same
 * rules createBooking and rescheduleBooking re-check (working hours, time off,
 * other bookings and buffers), without minimum notice or the booking window,
 * never in the past. `excludeBookingId` frees a booking's own time (moving it).
 */
export async function memberSlots(
  actor: Actor,
  timezone: string,
  input: unknown,
  { now = new Date() }: { now?: Date } = {},
): Promise<Result<{ slots: MemberSlot[] }, BookingError>> {
  const parsed = memberSlotsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { serviceId, staffId, date, excludeBookingId } = parsed.data;
  const from = zonedInstant(date, "00:00", timezone);
  const to = zonedInstant(nextDate(date), "00:00", timezone);

  const context = await withMemberBookings(actor.claims, actor.businessId, (store) =>
    store.loadSlotContext({ serviceId, from, to, excludeBookingId }),
  );
  if (!context || context.service.archived) {
    return err("not_found", BOOKING_MESSAGES.serviceGone);
  }
  const slots = getAvailableSlots({
    business: { ...context.business, minNoticeMin: 0, maxDaysAhead: 365 },
    service: context.service,
    staff: context.staff,
    staffId,
    from,
    to,
    now,
  });
  return ok({
    slots: slots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      staffId: slot.staffId,
      time: slot.local.time,
      repeated: slot.local.repeated,
    })),
  });
}

export type FreeStaff = { id: string; name: string; color: "teal" | "violet" | "pink" };

/**
 * For each booking, the other staff members who do its service and are free
 * at exactly its time (reassigning: time off over a booking, or "Change
 * staff" in the booking drawer). Bookings this member can't see are left out.
 */
export async function freeStaffFor(
  actor: Actor,
  bookingIds: string[],
  { now = new Date() }: { now?: Date } = {},
): Promise<Record<string, FreeStaff[]>> {
  const ids = [...new Set(bookingIds)].filter((id) => z.uuid().safeParse(id).success);
  if (ids.length === 0) return {};
  return withMemberBookings(actor.claims, actor.businessId, async (store) => {
    const result: Record<string, FreeStaff[]> = {};
    for (const id of ids) {
      const booking = await store.findBooking(id);
      if (!booking) continue;
      const context = await store.loadSlotContext({
        serviceId: booking.serviceId,
        from: booking.startsAt,
        to: booking.startsAt,
        excludeBookingId: booking.id,
      });
      if (!context) continue;
      result[id] = context.staff
        .filter(
          (person) =>
            person.id !== booking.staffId &&
            slotAt(context, { staffId: person.id, startsAt: booking.startsAt, now, member: true }),
        )
        .map(({ id: staffId, name, color }) => ({ id: staffId, name, color }));
    }
    return result;
  });
}
