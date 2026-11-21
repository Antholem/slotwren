import { describe, expect, it } from "vitest";

import { planReminder } from "@/lib/reminders";
import { zonedInstant } from "@/lib/time-off";

/*
 * The reminder's timing rule: two hours before the free-cancellation deadline,
 * moved to 20:00 the evening before when that lands between 21:00 and 08:00
 * (business time), and skipped when it has already passed.
 */

const MANILA = "Asia/Manila";
const NY = "America/New_York";
const at = (date: string, time: string, zone = MANILA) => zonedInstant(date, time, zone);
const LONG_AGO = new Date("2026-01-01T00:00:00Z");

const plan = (startsAt: Date, cancellationWindowHours = 24, timezone = MANILA, now = LONG_AGO) =>
  planReminder({ startsAt, cancellationWindowHours, timezone, now });

describe("planReminder", () => {
  it("aims two hours before the free-cancellation deadline", () => {
    // Sat 31 Oct 10:30, 24 h window: free until Fri 10:30, so remind Fri 08:30.
    expect(plan(at("2026-10-31", "10:30"))).toEqual({
      send: true,
      at: at("2026-10-30", "08:30"),
      shifted: false,
    });
  });

  it("uses the business's own window", () => {
    expect(plan(at("2026-10-31", "15:00"), 2)).toMatchObject({ at: at("2026-10-31", "11:00") });
    // No window: two hours before the appointment.
    expect(plan(at("2026-10-31", "15:00"), 0)).toMatchObject({ at: at("2026-10-31", "13:00") });
    expect(plan(at("2026-10-31", "15:00"), 72)).toMatchObject({ at: at("2026-10-28", "13:00") });
  });

  describe("never at night", () => {
    it("keeps 08:00 and 20:59, the edges of the day", () => {
      expect(plan(at("2026-10-31", "10:00"))).toMatchObject({
        at: at("2026-10-30", "08:00"),
        shifted: false,
      });
      expect(plan(at("2026-10-31", "22:59"))).toMatchObject({
        at: at("2026-10-30", "20:59"),
        shifted: false,
      });
    });

    it("moves 21:00 to midnight back to 20:00 that evening", () => {
      for (const time of ["23:00", "23:30"]) {
        // Aim 21:00 and 21:30 on Fri 30 Oct.
        expect(plan(at("2026-10-31", time))).toEqual({
          send: true,
          at: at("2026-10-30", "20:00"),
          shifted: true,
        });
      }
      // Aim 23:59 Fri → 20:00 Fri.
      expect(plan(at("2026-11-01", "01:59"))).toMatchObject({ at: at("2026-10-30", "20:00") });
    });

    it("moves midnight to 07:59 back to 20:00 the evening before", () => {
      // Aim 00:30 Sat → 20:00 Fri; aim 07:59 Sat → 20:00 Fri.
      expect(plan(at("2026-11-01", "02:30"))).toMatchObject({
        at: at("2026-10-30", "20:00"),
        shifted: true,
      });
      expect(plan(at("2026-11-01", "09:59"))).toMatchObject({ at: at("2026-10-30", "20:00") });
    });

    it("an early-morning appointment with no window is reminded the evening before", () => {
      // 09:00 with no window: aim 07:00 → 20:00 the evening before.
      expect(plan(at("2026-11-02", "09:00"), 0)).toMatchObject({ at: at("2026-11-01", "20:00") });
    });
  });

  describe("across DST in New York", () => {
    it("counts the window in real hours across the spring change", () => {
      // Mon 9 Mar 10:00 EDT minus 24 h is Sun 10:00 EDT; minus 2 h is 08:00 EDT.
      expect(plan(at("2026-03-09", "10:00", NY), 24, NY)).toEqual({
        send: true,
        at: new Date("2026-03-08T12:00:00Z"),
        shifted: false,
      });
    });

    it("moves a reminder aimed into the skipped night to 20:00 EST the evening before", () => {
      // Sun 8 Mar 05:30 EDT, no window: aim 03:30 EDT → Sat 7 Mar 20:00 EST.
      expect(plan(at("2026-03-08", "05:30", NY), 0, NY)).toMatchObject({
        at: new Date("2026-03-08T01:00:00Z"),
        shifted: true,
      });
    });

    it("moves a reminder aimed at the repeated hour to 20:00 EDT the evening before", () => {
      // Aim 01:30 EST (the second 01:30) on Sun 1 Nov → Sat 31 Oct 20:00 EDT.
      const start = new Date("2026-11-01T08:30:00Z"); // 03:30 EST
      expect(plan(start, 0, NY)).toMatchObject({
        at: new Date("2026-11-01T00:00:00Z"),
        shifted: true,
      });
    });

    it("uses EST for 20:00 on the evening after the clocks go back", () => {
      // Mon 2 Nov 23:30 EST, no window: aim 21:30 EST Mon → 20:00 EST Mon.
      expect(plan(at("2026-11-02", "23:30", NY), 0, NY)).toMatchObject({
        at: new Date("2026-11-03T01:00:00Z"),
      });
    });
  });

  describe("bookings made inside the window", () => {
    it("skips the reminder when its moment has passed (the confirmation just went out)", () => {
      // Booked Fri 12:00 for Sat 10:30: the aim (Fri 08:30) has gone.
      expect(plan(at("2026-10-31", "10:30"), 24, MANILA, at("2026-10-30", "12:00"))).toEqual({
        send: false,
        reason: "already_passed",
      });
      // Exactly at the moment counts as passed.
      expect(plan(at("2026-10-31", "10:30"), 24, MANILA, at("2026-10-30", "08:30"))).toMatchObject({
        send: false,
      });
    });

    it("skips when the evening-before shift lands in the past", () => {
      // Booked Fri 20:30; the aim (Sat 01:00) would be shifted to Fri 20:00.
      expect(plan(at("2026-10-31", "03:00"), 0, MANILA, at("2026-10-30", "20:30"))).toMatchObject({
        send: false,
      });
    });

    it("still schedules when there's time left", () => {
      expect(plan(at("2026-10-31", "10:30"), 24, MANILA, at("2026-10-30", "08:29"))).toMatchObject({
        send: true,
        at: at("2026-10-30", "08:30"),
      });
    });
  });
});
