import "server-only";

import { z } from "zod";

import { hoursOutsideOpening, type OpeningRange, weekSchemaFor } from "@/lib/hours";
import { err, ok, type Result } from "@/lib/result";
import { timeOffSchemaFor } from "@/lib/time-off";
import { pgError } from "@/server/db/errors";
import {
  createTimeOff,
  deleteTimeOff,
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

export async function addTimeOff(
  actor: ScheduleActor,
  staffId: string,
  input: unknown,
): Promise<Result<{ id: string }, ScheduleError>> {
  if (!idSchema.safeParse(staffId).success) return err("not_found", NOT_FOUND);
  const person = await findStaff(actor.claims, actor.businessId, staffId);
  if (!person) return err("not_found", NOT_FOUND);
  if (!mayEdit(actor, person)) return err("forbidden", FORBIDDEN);

  const parsed = timeOffSchemaFor(actor.timezone, actor.slotIntervalMin).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return ok({ id: await createTimeOff(actor.claims, actor.businessId, staffId, parsed.data) });
  } catch (error) {
    if (isRlsRefusal(error)) return err("forbidden", FORBIDDEN);
    throw error;
  }
}

export async function editTimeOff(
  actor: ScheduleActor,
  timeOffId: string,
  input: unknown,
): Promise<Result<{ id: string }, ScheduleError>> {
  if (!idSchema.safeParse(timeOffId).success) return err("not_found", NOT_FOUND);
  const entry = await findTimeOffStaff(actor.claims, actor.businessId, timeOffId);
  if (!entry) return err("not_found", NOT_FOUND);
  if (!mayEdit(actor, entry)) return err("forbidden", FORBIDDEN);

  const parsed = timeOffSchemaFor(actor.timezone, actor.slotIntervalMin).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const updated = await updateTimeOff(actor.claims, actor.businessId, timeOffId, parsed.data);
  return updated ? ok({ id: timeOffId }) : err("forbidden", FORBIDDEN);
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
