import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { zonedInstant } from "@/lib/time-off";
import { cancelBooking, createBooking, rescheduleBooking } from "@/server/booking/service";
import type { Actor } from "@/server/catalog/services";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The emails a booking sends, captured instead of sent: who gets what, the
 * .ics attachment, manage links (rotated when the customer moves a booking),
 * and that email trouble never undoes a booking.
 */

type Sent = {
  to: string | string[];
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string | null;
  attachments?: { filename: string; content: string; contentType: string }[];
};
const mail = vi.hoisted(() => ({ sent: [] as Sent[], mode: "ok" as "ok" | "fail" | "throw" }));
vi.mock("@/server/email/send", () => ({
  sendEmail: async ({ react, ...rest }: Omit<Sent, "html"> & { react: unknown }) => {
    if (mail.mode === "throw") throw new Error("SMTP on fire");
    mail.sent.push({ ...rest, html: renderToStaticMarkup(react as React.ReactElement) });
    return mail.mode === "ok"
      ? { delivered: true }
      : { delivered: false, reason: "failed" as const };
  },
}));

const MANILA = "Asia/Manila";
const at = (time: string, date = "2026-12-01") => zonedInstant(date, time, MANILA);
const NOW = new Date("2026-11-25T00:00:00Z");

describe("booking emails", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: Actor & { email: string };
  let emails = 0;

  const book = (startsAt: Date, overrides: Record<string, unknown> = {}) =>
    createBooking(
      { kind: "public", businessId: a.business.id, source: "page" },
      {
        serviceId: a.service.id,
        staffId: a.staff.id,
        startsAt: startsAt.toISOString(),
        customer: { name: "Rosa Cruz", email: `rosa-${Date.now()}-${emails++}@example.com` },
        customerTimezone: "Europe/London",
        ...overrides,
      },
      { now: NOW },
    );
  async function booked(startsAt: Date) {
    const result = await book(startsAt);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }
  const tokenFrom = (html: string) => /\/m\/([A-Za-z0-9_-]{43})/.exec(html)?.[1];

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    const businessId = a.business.id;
    await db
      .update(schema.businesses)
      .set({ address: "12 Lumen Lane, Makati", contactEmail: "hello@lumen.example" })
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
    const user = await users.create("emails-owner");
    await db.insert(schema.memberships).values({ businessId, userId: user.sub, role: "owner" });
    owner = { claims: user, businessId, role: "owner", email: user.email };
  });

  beforeEach(async () => {
    mail.sent.length = 0;
    mail.mode = "ok";
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
  });

  afterAll(async () => {
    await a?.cleanup();
    await users.cleanup();
    await close();
  });

  it("confirms to the customer with the .ics and a working manage link, and tells the owner", async () => {
    const created = await booked(at("10:00"));
    expect(mail.sent).toHaveLength(2);
    const [customer, ownerMail] = mail.sent;

    expect(customer).toMatchObject({
      subject: "Booked: Haircut, Tue 1 Dec at 02:00", // on the customer's London clock
      fromName: a.business.name,
      replyTo: "hello@lumen.example",
    });
    expect(customer!.html).toContain("You’re booked, Rosa");
    expect(customer!.html).toContain("02:00 – 02:45");
    expect(customer!.html).toContain("Times in Europe/London (GMT)");
    expect(customer!.html).toContain(created.code);
    expect(customer!.html).toContain("Open in Maps");
    expect(tokenFrom(customer!.html)).toBe(created.manageToken);

    const [ics] = customer!.attachments!;
    expect(ics).toMatchObject({ filename: `${a.business.slug}-${created.code}.ics` });
    expect(ics!.contentType).toContain("text/calendar");
    expect(ics!.content).toContain("DTSTART:20261201T020000Z\r\n");
    expect(ics!.content).toContain(`UID:${created.id}@slotwren\r\n`);
    expect(ics!.content).toContain("LOCATION:12 Lumen Lane\\, Makati\r\n");

    expect(ownerMail).toMatchObject({
      to: [owner.email],
      subject: "New booking: Rosa Cruz, Haircut Tue 1 Dec at 10:00", // the business's clock
    });
    expect(ownerMail!.replyTo).toMatch(/^rosa-/);
    expect(ownerMail!.html).toContain("via booking page");
  });

  it("doesn't tell the owner about bookings they made, or when they've turned it off", async () => {
    const manual = await createBooking(
      { kind: "member", actor: owner },
      {
        serviceId: a.service.id,
        staffId: a.staff.id,
        startsAt: at("10:00").toISOString(),
        customer: { name: "Walk In", email: `walkin-${Date.now()}@example.com` },
      },
      { now: NOW },
    );
    expect(manual.ok).toBe(true);
    expect(mail.sent.map((m) => m.subject)).toEqual(["Booked: Haircut, Tue 1 Dec at 10:00"]);

    await db
      .update(schema.businesses)
      .set({ settings: { notifications: { ownerNewBookingEmail: false } } })
      .where(eq(schema.businesses.id, a.business.id));
    try {
      mail.sent.length = 0;
      await booked(at("13:00"));
      expect(mail.sent.map((m) => m.subject)).toEqual(["Booked: Haircut, Tue 1 Dec at 05:00"]);
    } finally {
      await db
        .update(schema.businesses)
        .set({ settings: {} })
        .where(eq(schema.businesses.id, a.business.id));
    }
  });

  it("never fails or undoes a booking because email failed", async () => {
    for (const mode of ["fail", "throw"] as const) {
      mail.mode = mode;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await book(at(mode === "fail" ? "10:00" : "13:00"));
      expect(result.ok, mode).toBe(true);
      if (result.ok) {
        const [row] = await db
          .select({ status: schema.bookings.status })
          .from(schema.bookings)
          .where(eq(schema.bookings.id, result.data.id));
        expect(row?.status).toBe("confirmed");
      }
    }
  });

  describe("rescheduling", () => {
    it("by the customer: the old link stops working and the email carries the new one", async () => {
      const created = await booked(at("10:00"));
      mail.sent.length = 0;
      const moved = await rescheduleBooking(
        { kind: "customer", manageToken: created.manageToken },
        { startsAt: at("14:00").toISOString() },
        { now: NOW },
      );
      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      const fresh = moved.data.manageToken!;
      expect(fresh).toBeTruthy();
      expect(fresh).not.toBe(created.manageToken);

      const [email] = mail.sent;
      expect(email!.subject).toBe("Moved: Haircut, now Tue 1 Dec at 06:00");
      expect(email!.html).toContain("It was Tue 1 Dec, 02:00");
      expect(tokenFrom(email!.html)).toBe(fresh);
      const ics = email!.attachments![0]!.content;
      expect(ics).toContain("DTSTART:20261201T060000Z\r\n");
      expect(ics).toMatch(/SEQUENCE:[1-9]\d*\r\n/);

      // The old link is gone; the new one works.
      const old = await cancelBooking(
        { kind: "customer", manageToken: created.manageToken },
        {},
        { now: NOW },
      );
      expect(old.ok || old.error.code).toBe("not_found");
      const again = await rescheduleBooking(
        { kind: "customer", manageToken: fresh },
        { startsAt: at("15:00").toISOString() },
        { now: NOW },
      );
      expect(again.ok).toBe(true);
    });

    it("by the business: the email says so and keeps the customer's link", async () => {
      const created = await booked(at("10:00"));
      mail.sent.length = 0;
      const moved = await rescheduleBooking(
        { kind: "member", actor: owner, bookingId: created.id },
        { startsAt: at("11:00").toISOString() },
        { now: NOW },
      );
      expect(moved.ok && moved.data.manageToken).toBeNull();
      expect(mail.sent[0]!.html).toContain(`${a.business.name} moved your appointment.`);
      expect(tokenFrom(mail.sent[0]!.html)).toBeUndefined();
      const stillWorks = await cancelBooking(
        { kind: "customer", manageToken: created.manageToken },
        {},
        { now: NOW },
      );
      expect(stillWorks.ok).toBe(true);
    });
  });

  describe("cancelling", () => {
    it("sends the customer a receipt when they cancel", async () => {
      const created = await booked(at("10:00"));
      mail.sent.length = 0;
      const result = await cancelBooking(
        { kind: "customer", manageToken: created.manageToken },
        {},
        { now: NOW },
      );
      expect(result.ok && result.data.notified).toBe(true);
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]!.subject).toBe("Cancelled: Haircut, Tue 1 Dec at 02:00");
      expect(mail.sent[0]!.html).toContain("You’ve cancelled your booking, Rosa");
    });

    it("emails only when the team asks to, with their message, never the stored reason", async () => {
      const quiet = await booked(at("10:00"));
      mail.sent.length = 0;
      await cancelBooking(
        { kind: "member", actor: owner, bookingId: quiet.id },
        { reason: "Double-booked on paper" },
        { now: NOW },
      );
      expect(mail.sent).toEqual([]);

      const told = await booked(at("13:00"));
      mail.sent.length = 0;
      await cancelBooking(
        { kind: "member", actor: owner, bookingId: told.id },
        { reason: "Mia is sick" },
        { now: NOW, notify: true, customerMessage: "We're closed that day, sorry." },
      );
      expect(mail.sent[0]!.html).toContain("Your booking was cancelled, Rosa");
      expect(mail.sent[0]!.html).toContain("We&#x27;re closed that day, sorry.");
      expect(mail.sent[0]!.html).not.toContain("Mia is sick");
    });
  });
});
