import "server-only";

import { z } from "zod";

import { hoursOutsideOpening, type OpeningRange, weekSchemaFor } from "@/lib/hours";
import { err, ok, type Result } from "@/lib/result";
import { timeOffSchemaFor, type TimeOffValues } from "@/lib/time-off";
import { cancelBooking } from "@/server/booking/service";
import { pgError } from "@/server/db/errors";
import {
  type BookingDuringTimeOff,
  createTimeOff,
  deleteTimeOff,
  findBookingsDuring,
  findStaff,
  findTimeOffStaff,
  replaceStaffHours,
  updateTimeOff,
} from "@/server/db/queries/schedule";

import type { Actor } from "./services";

/*
 * Weekly hours and time off, minus reading the session. Owners edit anyone's
 * schedule; staff edit only their own (the same rule RLS enforces). Hours are
 * validated on the business's slot grid; hours outside opening hours are
 * allowed but come back as warnings. Tested in tests/integration/schedule.test.ts.
 */

export type ScheduleActor = Actor & {
  timezone: string;
  slotIntervalMin: number;
  openingHours: OpeningRange[] | null;
};

type ScheduleError = "forbidden" | "not_found" | "invalid_input";

const FORBIDDEN =
  "You can change only your own hours and time off. Ask an owner for anyone else's.";
const NOT_FOUND = "That no longer exists. Refresh to see the latest.";
const idSchema = z.uuid();

function invalid(error: z.ZodError) {
  const { fieldErrors, formErrors } = z.flattenError(error);
  const first = formErrors[0] ?? (Object.values(fieldErrors).flat()[0] as string | undefined);
  return err(
    "invalid_input",
    first ?? "Check the highlighted fields.",
    fieldErrors as Record<string, string[]>,
  );
}

/** Owners: anyone in the business. Staff: only the staff row linked to them. */
function mayEdit(actor: ScheduleActor, owner: { userId: string | null }) {
  return actor.role === "owner" || owner.userId === actor.claims.sub;
}

const isRlsRefusal = (error: unknown) => pgError(error).code === "42501";

export async function saveStaffHours(
  actor: ScheduleActor,
  staffId: string,
  input: unknown,
): Promise<Result<{ warnings: string[] }, ScheduleError>> {
  if (!idSchema.safeParse(staffId).success) return err("not_found", NOT_FOUND);
  const person = await findStaff(actor.claims, actor.businessId, staffId);
  if (!person) return err("not_found", NOT_FOUND);
  if (!mayEdit(actor, person)) return err("forbidden", FORBIDDEN);

  const parsed = z
    .object({ days: weekSchemaFor({ intervalMin: actor.slotIntervalMin, requireOpenDay: false }) })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await replaceStaffHours(actor.claims, actor.businessId, staffId, parsed.data.days);
  } catch (error) {
    if (isRlsRefusal(error)) return err("forbidden", FORBIDDEN);
    throw error;
  }
  const warnings = actor.openingHours
    ? hoursOutsideOpening(parsed.data.days, actor.openingHours)
    : [];
  return ok({ warnings });
}

/** How the owner answered "this time off overlaps bookings". */
export type OnBookings = "keep" | "cancel";

export type TimeOffOutcome =
  /** Overlapping bookings exist and no choice was given: nothing was saved. */
  | { status: "needs_choice"; bookings: BookingDuringTimeOff[] }
  | {
      status: "saved";
      id: string;
      /** Bookings cancelled because of it, and how many customers were emailed. */
      cancelled: number;
      notified: number;
      /** Bookings that couldn't be cancelled (changed meanwhile, or not yours). */
      notCancelled: number;
    };

const onBookingsSchema = z.enum(["keep", "cancel"]).optional();

/**
 * Save time off, minding the bookings it overlaps. With no choice and some
 * overlap, saves nothing and returns them so the owner can choose: keep them,
 * or cancel them and email the customers (through booking/service.ts, the one
 * write path). Reassigning comes with the calendar in Phase 3.
 */
async function saveMindingBookings(
  actor: ScheduleActor,
  person: { staffId: string; name: string },
  values: TimeOffValues,
  onBookings: unknown,
  save: () => Promise<Result<{ id: string }, ScheduleError>>,
): Promise<Result<TimeOffOutcome, ScheduleError>> {
  const choice = onBookingsSchema.safeParse(onBookings);
  if (!choice.success) return err("invalid_input", "Choose what happens to the bookings.");
  const overlapping = await findBookingsDuring(
    actor.claims,
    actor.businessId,
    person.staffId,
    values,
  );
  if (overlapping.length > 0 && !choice.data) {
    return ok({ status: "needs_choice", bookings: overlapping });
  }

  const saved = await save();
  if (!saved.ok) return saved;
  const outcome = {
    status: "saved" as const,
    id: saved.data.id,
    cancelled: 0,
    notified: 0,
    notCancelled: 0,
  };
  if (choice.data !== "cancel") return ok(outcome);

  for (const booking of overlapping) {
    const result = await cancelBooking(
      { kind: "member", actor, bookingId: booking.id },
      { reason: values.reason ? `Time off: ${values.reason}` : "Time off" },
      {
        notify: true,
        // The time-off reason is for the team only; customers get this.
        customerMessage: `${person.name} isn't available at that time any more. Book another time, or reply to this email to ask us.`,
      },
    );
    if (!result.ok) {
      outcome.notCancelled++;
      continue;
    }
    outcome.cancelled++;
    if (result.data.notified) outcome.notified++;
  }
  return ok(outcome);
}

export async function addTimeOff(
  actor: ScheduleActor,
  staffId: string,
  input: unknown,
  onBookings?: unknown,
): Promise<Result<TimeOffOutcome, ScheduleError>> {
  if (!idSchema.safeParse(staffId).success) return err("not_found", NOT_FOUND);
  const person = await findStaff(actor.claims, actor.businessId, staffId);
  if (!person) return err("not_found", NOT_FOUND);
  if (!mayEdit(actor, person)) return err("forbidden", FORBIDDEN);

  const parsed = timeOffSchemaFor(actor.timezone, actor.slotIntervalMin).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const values = parsed.data;
  return saveMindingBookings(
    actor,
    { staffId, name: person.name },
    values,
    onBookings,
    async () => {
      try {
        return ok({ id: await createTimeOff(actor.claims, actor.businessId, staffId, values) });
      } catch (error) {
        if (isRlsRefusal(error)) return err("forbidden", FORBIDDEN);
        throw error;
      }
    },
  );
}

export async function editTimeOff(
  actor: ScheduleActor,
  timeOffId: string,
  input: unknown,
  onBookings?: unknown,
): Promise<Result<TimeOffOutcome, ScheduleError>> {
  if (!idSchema.safeParse(timeOffId).success) return err("not_found", NOT_FOUND);
  const entry = await findTimeOffStaff(actor.claims, actor.businessId, timeOffId);
  if (!entry) return err("not_found", NOT_FOUND);
  if (!mayEdit(actor, entry)) return err("forbidden", FORBIDDEN);

  const parsed = timeOffSchemaFor(actor.timezone, actor.slotIntervalMin).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const values = parsed.data;
  return saveMindingBookings(actor, entry, values, onBookings, async () => {
    const updated = await updateTimeOff(actor.claims, actor.businessId, timeOffId, values);
    return updated ? ok({ id: timeOffId }) : err("forbidden", FORBIDDEN);
  });
}

export async function removeTimeOff(
  actor: ScheduleActor,
  timeOffId: string,
): Promise<Result<{ id: string }, ScheduleError>> {
  if (!idSchema.safeParse(timeOffId).success) return err("not_found", NOT_FOUND);
  const entry = await findTimeOffStaff(actor.claims, actor.businessId, timeOffId);
  if (!entry) return err("not_found", NOT_FOUND);
  if (!mayEdit(actor, entry)) return err("forbidden", FORBIDDEN);
  const deleted = await deleteTimeOff(actor.claims, actor.businessId, timeOffId);
  return deleted ? ok({ id: timeOffId }) : err("forbidden", FORBIDDEN);
}
