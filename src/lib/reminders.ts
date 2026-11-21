import { nextDate } from "@/lib/time-off";
import { zoneClock } from "@/lib/zone-clock";

/*
 * When a booking's reminder goes out (docs/adr/0004-reminders.md). Pure: the
 * job and its tests both call it.
 *
 * - Aim for two hours before the free-cancellation deadline (the appointment
 *   minus the business's cancellation window), so the customer can still
 *   change their mind for free.
 * - Not at night: if that lands between 21:00 and 08:00 in the business's
 *   timezone, send at 20:00 the evening before instead.
 * - Never late: if that moment has already passed when the booking is made
 *   or moved, skip it. The confirmation (or reschedule) email has just gone
 *   out with the same details and the policy, so a second email minutes
 *   later would only be noise.
 */

export const REMINDER_LEAD_HOURS = 2;
export const QUIET_FROM = "21:00";
export const QUIET_UNTIL = "08:00";
export const EVENING_SEND = "20:00";

const HOUR = 3_600_000;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export type ReminderPlan =
  { send: true; at: Date; shifted: boolean } | { send: false; reason: "already_passed" };

export function planReminder({
  startsAt,
  cancellationWindowHours,
  timezone,
  now,
}: {
  startsAt: Date;
  cancellationWindowHours: number;
  timezone: string;
  now: Date;
}): ReminderPlan {
  const deadline = startsAt.getTime() - cancellationWindowHours * HOUR;
  const aim = deadline - REMINDER_LEAD_HOURS * HOUR;

  const clock = zoneClock(timezone);
  const local = clock.parts(aim);
  const late = local.minutes >= minutes(QUIET_FROM);
  const early = local.minutes < minutes(QUIET_UNTIL);
  // 20:00 the evening before: the same local date if it's late, else the day before.
  const at =
    late || early
      ? clock.instant(early ? nextDate(local.date, -1) : local.date, EVENING_SEND)
      : aim;

  if (at <= now.getTime()) return { send: false, reason: "already_passed" };
  return { send: true, at: new Date(at), shifted: late || early };
}
