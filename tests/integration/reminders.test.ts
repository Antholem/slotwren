import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { planReminder } from "@/lib/reminders";
import { zonedInstant } from "@/lib/time-off";
import { sendReminder } from "@/server/booking/reminders";
import { cancelBooking, createBooking, rescheduleBooking } from "@/server/booking/service";
import { hashToken } from "@/server/booking/tokens";
import { findBookingByManageToken } from "@/server/db/queries/public/bookings";
import type * as JobsClient from "@/server/jobs/client";
import type { ReminderEventData } from "@/server/jobs/client";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * Reminders end to end, minus Inngest's clock: the events the booking service
 * sends after each change, and what the job does when the time comes.
 */

const jobs = vi.hoisted(() => ({ events: [] as { name: string; data: ReminderEventData }[] }));
vi.mock("@/server/jobs/client", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsClient>()),
  sendJobEvents: async (events: { name: string; data: ReminderEventData }[]) => {
    jobs.events.push(...events);
    return true;
  },
}));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; html: string }[] }));
vi.mock("@/server/email/send", () => ({
  sendEmail: async ({ to, subject, react }: { to: string; subject: string; react: unknown }) => {
    mail.sent.push({ to, subject, html: renderToStaticMarkup(react as React.ReactElement) });
    return { delivered: true };
  },
}));

const MANILA = "Asia/Manila";
const at = (time: string, date = "2026-12-05") => zonedInstant(date, time, MANILA);
const NOW = new Date("2026-11-25T00:00:00Z");

describe("reminders", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;

  async function booked(startsAt: Date, now = NOW) {
    const result = await createBooking(
      { kind: "public", businessId: a.business.id, source: "page" },
      {
        serviceId: a.service.id,
        staffId: a.staff.id,
        startsAt: startsAt.toISOString(),
        customer: { name: "Rosa Cruz", email: `rosa-${Date.now()}-${Math.random()}@example.com` },
      },
      { now },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }
  const lastEvent = () => jobs.events.at(-1)!;

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    const businessId = a.business.id;
    await db
      .update(schema.businesses)
      .set({ minNoticeMin: 0 })
      .where(eq(schema.businesses.id, businessId));
    await db
      .insert(schema.staffServices)
      .values({ businessId, staffId: a.staff.id, serviceId: a.service.id });
    await db.insert(schema.availabilityRules).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        businessId,
        staffId: a.staff.id,
        weekday,
        startTime: "09:00",
        endTime: "17:00",
      })),
    );
  });

  beforeEach(async () => {
    jobs.events.length = 0;
    mail.sent.length = 0;
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
  });

  afterAll(async () => {
    await a?.cleanup();
    await close();
  });

  describe("planning", () => {
    it("plans one when a booking is made: 2 h before free cancellation ends", async () => {
      const created = await booked(at("10:30"));
      expect(jobs.events).toHaveLength(1);
      expect(lastEvent()).toEqual({
        name: "booking/reminder.schedule",
        data: {
          bookingId: created.id,
          businessId: a.business.id,
          startsAt: at("10:30").toISOString(),
          sendAt: at("08:30", "2026-12-04").toISOString(),
          revision: expect.any(String),
        },
      });
    });

    it("re-plans with a new revision when the booking moves", async () => {
      const created = await booked(at("10:30"));
      const first = lastEvent().data.revision;
      await rescheduleBooking(
        { kind: "customer", manageToken: created.manageToken },
        { startsAt: at("14:00").toISOString() },
        { now: NOW },
      );
      expect(lastEvent().data).toMatchObject({
        bookingId: created.id,
        startsAt: at("14:00").toISOString(),
        sendAt: at("12:00", "2026-12-04").toISOString(),
      });
      expect(lastEvent().data.revision).not.toBe(first);
    });

    it("clears it when the booking is cancelled", async () => {
      const created = await booked(at("10:30"));
      await cancelBooking({ kind: "customer", manageToken: created.manageToken }, {}, { now: NOW });
      expect(lastEvent().data).toMatchObject({ bookingId: created.id, sendAt: null });
    });

    it("plans nothing for a booking made inside the window (its time has passed)", async () => {
      // Booked on the 4th at 12:00 for the 5th at 10:30: the moment (4th 08:30) has gone.
      await booked(at("10:30"), at("12:00", "2026-12-04"));
      expect(lastEvent().data.sendAt).toBeNull();
    });
  });

  describe("sending", () => {
    const due = (created: { id: string }, startsAt: Date): ReminderEventData => ({
      bookingId: created.id,
      businessId: a.business.id,
      startsAt: startsAt.toISOString(),
      sendAt: at("08:30", "2026-12-04").toISOString(),
      revision: "test",
    });
    const sendTime = at("08:30", "2026-12-04");

    it("sends the reminder with a fresh manage link; earlier links keep working", async () => {
      const created = await booked(at("10:30"));
      mail.sent.length = 0;
      expect(await sendReminder(due(created, at("10:30")), sendTime)).toEqual({
        sent: true,
        delivered: true,
      });
      const [email] = mail.sent;
      expect(email!.subject).toBe("Tomorrow at 10:30: Haircut with Mia");
      expect(email!.html).toContain("See you tomorrow, Rosa");
      const token = /\/m\/([A-Za-z0-9_-]{43})/.exec(email!.html)![1]!;
      expect(token).not.toBe(created.manageToken);
      for (const link of [token, created.manageToken]) {
        expect(
          await findBookingByManageToken({ tokenHash: hashToken(link), now: sendTime }),
        ).toMatchObject({ bookingId: created.id });
      }
      const purposes = await db
        .select({ purpose: schema.manageTokens.purpose })
        .from(schema.manageTokens)
        .where(eq(schema.manageTokens.bookingId, created.id));
      expect(purposes.map((p) => p.purpose).sort()).toEqual(["created", "reminder"]);
    });

    it("skips a cancelled booking", async () => {
      const created = await booked(at("10:30"));
      await cancelBooking({ kind: "customer", manageToken: created.manageToken }, {}, { now: NOW });
      mail.sent.length = 0;
      expect(await sendReminder(due(created, at("10:30")), sendTime)).toEqual({
        sent: false,
        skipped: "not_active",
      });
      expect(mail.sent).toEqual([]);
    });

    it("skips a plan made for a time the booking has since moved from", async () => {
      const created = await booked(at("10:30"));
      await rescheduleBooking(
        { kind: "customer", manageToken: created.manageToken },
        { startsAt: at("14:00").toISOString() },
        { now: NOW },
      );
      mail.sent.length = 0;
      expect(await sendReminder(due(created, at("10:30")), sendTime)).toMatchObject({
        skipped: "moved",
      });
      expect(mail.sent).toEqual([]);
    });

    it("skips a booking that has already started, and one that's gone", async () => {
      const created = await booked(at("10:30"));
      expect(await sendReminder(due(created, at("10:30")), at("10:31"))).toMatchObject({
        skipped: "past",
      });
      expect(
        await sendReminder(
          { ...due(created, at("10:30")), bookingId: "00000000-0000-4000-8000-000000000000" },
          sendTime,
        ),
      ).toMatchObject({ skipped: "not_found" });
    });

    it("agrees with the timing rule it was planned by", () => {
      expect(
        planReminder({
          startsAt: at("10:30"),
          cancellationWindowHours: 24,
          timezone: MANILA,
          now: NOW,
        }),
      ).toMatchObject({ at: sendTime });
    });
  });
});
