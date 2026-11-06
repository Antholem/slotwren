import "server-only";

import type { z } from "zod";

import { isOnGrid, roundRangeInward, toAvailabilityRows } from "@/lib/hours";
import { err, ok, type Result } from "@/lib/result";
import { businessSettingsSchema } from "@/lib/validation/settings";
import { isUniqueViolation } from "@/server/db/errors";
import { isSlugAvailable } from "@/server/db/queries/onboarding";
import {
  getBusinessSettings,
  listStaffRanges,
  updateBusinessSettings,
} from "@/server/db/queries/settings";

import { isOwnLogoUrl, removeUnusedLogos } from "./logo";
import type { Actor } from "./services";

/*
 * Settings → Business, minus reading the session: owners only, validated,
 * and safe about what a change does to existing data:
 * - a 30-minute grid refuses staff hours that aren't on it, unless the owner
 *   asks to round them (inward, so nobody is booked outside their hours);
 * - a timezone change needs the owner's confirmation, keeps working hours at
 *   the same clock times, moves upcoming time off to the same local dates and
 *   times, and leaves bookings at their exact moment.
 * Tested in tests/integration/settings.test.ts.
 */

type SettingsError =
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "slug_taken"
  | "hours_off_grid"
  | "confirm_timezone";

const FORBIDDEN = "Only owners can change business settings. Ask an owner to make this change.";
export const SLUG_TAKEN = "That link is taken. Try adding your area or a number.";

function invalid(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.join(".");
  return err(
    "invalid_input",
    issue?.message ?? "Check the highlighted fields.",
    field ? { [field]: [issue!.message] } : undefined,
  );
}

export type SavedSettings = {
  slugChanged: boolean;
  roundedRanges: number;
  movedTimeOff: number;
};

export async function saveBusinessSettings(
  actor: Actor,
  input: unknown,
  now: Date = new Date(),
): Promise<Result<SavedSettings, SettingsError>> {
  if (actor.role !== "owner") return err("forbidden", FORBIDDEN);
  const parsed = businessSettingsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const values = parsed.data;

  const current = await getBusinessSettings(actor.claims, actor.businessId);
  if (!current) return err("not_found", "That business no longer exists.");

  const slugChanged = values.slug !== current.slug;
  if (slugChanged && !(await isSlugAvailable(actor.claims, values.slug, actor.businessId))) {
    return err("slug_taken", SLUG_TAKEN, { slug: [SLUG_TAKEN] });
  }

  const timezoneChanged = values.timezone !== current.timezone;
  if (timezoneChanged && !values.confirmTimezone) {
    return err(
      "confirm_timezone",
      "Confirm the timezone change: bookings keep their exact time, so they'll show at new local times.",
    );
  }

  const interval = values.rules.slotIntervalMin;
  const offGrid = (await listStaffRanges(actor.claims, actor.businessId)).filter(
    (r) => !isOnGrid(r.start, interval) || !isOnGrid(r.end, interval),
  );
  if (offGrid.length > 0 && !values.roundStaffHours) {
    const people = new Set(offGrid.map((r) => r.staffName));
    return err(
      "hours_off_grid",
      `${[...people].join(", ")} ${people.size === 1 ? "has" : "have"} hours that aren't on the ${interval}-minute grid. Round them or change them first.`,
    );
  }

  if (values.logoUrl && !isOwnLogoUrl(actor.businessId, values.logoUrl)) {
    return err("invalid_input", "Upload the logo again.", { logoUrl: ["Upload the logo again."] });
  }

  const openingHours = toAvailabilityRows(values.openingHours).map((row) => ({
    weekday: row.weekday,
    start: row.startTime,
    end: row.endTime,
  }));

  let result;
  try {
    result = await updateBusinessSettings(
      actor.claims,
      actor.businessId,
      {
        name: values.name,
        slug: values.slug,
        timezone: values.timezone,
        currency: values.currency,
        brandColor: values.brandColor,
        logoUrl: values.logoUrl,
        openingHours,
        ...values.rules,
      },
      {
        rounded: offGrid.map((r) => ({ id: r.id, range: roundRangeInward(r, interval) })),
        moveTimeOff: timezoneChanged ? { from: current.timezone, to: values.timezone } : null,
        now,
      },
    );
  } catch (error) {
    // Someone else took the slug between the check and the update.
    if (isUniqueViolation(error, "businesses_slug_unique")) {
      return err("slug_taken", SLUG_TAKEN, { slug: [SLUG_TAKEN] });
    }
    throw error;
  }
  if (!result.saved) return err("forbidden", FORBIDDEN);

  if (values.logoUrl !== current.logoUrl) {
    await removeUnusedLogos(actor.businessId, values.logoUrl);
  }
  return ok({ slugChanged, roundedRanges: offGrid.length, movedTimeOff: result.movedTimeOff });
}

/** Live check while the owner types a new booking link. */
export async function checkSettingsSlug(
  actor: Actor,
  slug: string,
): Promise<Result<{ available: boolean }>> {
  const parsed = businessSettingsSchema.shape.slug.safeParse(slug);
  if (!parsed.success) return err("invalid_input", parsed.error.issues[0]!.message);
  return ok({ available: await isSlugAvailable(actor.claims, parsed.data, actor.businessId) });
}
