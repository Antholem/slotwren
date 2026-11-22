import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { zonedInstant } from "@/lib/time-off";
import { sendCancellationEmail } from "@/server/booking/cancellation-emails";
import { cancelBookingsForTeam } from "@/server/booking/service";
import type { Actor } from "@/server/catalog/services";
import type * as JobsClient from "@/server/jobs/client";
import type { JobEvent } from "@/server/jobs/client";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * Cancelling many bookings at once (time off over a busy day): one
 * transaction, one request to Inngest for the reminders and one for the
 * emails, which the job then sends one by one. Inngest is "configured" here.
 */

const jobs = vi.hoisted(() => ({ sends: [] as JobEvent[][] }));
vi.mock("@/server/jobs/client", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsClient>()),
  sendJobEvents: async (events: JobEvent[]) => {
    jobs.sends.push(events);
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
const at = (time: string) => zonedInstant("2026-12-01", time, MANILA);
const NOW = new Date("2026-11-25T00:00:00Z");
const MESSAGE = "Mia isn't available at that time any more.";

describe("cancelling bookings in bulk", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: Actor;

  const insert = async (
    startsAt: Date,
    overrides: Partial<typeof schema.bookings.$inferInsert> = {},
  ) =>
    (
      await db
        .insert(schema.bookings)
        .values(bookingValues(a, startsAt, overrides))
        .returning()
    )[0]!;
  const statuses = async (ids: string[]) =>
    Object.fromEntries(
      (
        await db
          .select({ id: schema.bookings.id, status: schema.bookings.status })
          .from(schema.bookings)
          .where(inArray(schema.bookings.id, ids))
      ).map((row) => [row.id, row.status]),
    );

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    const user = await users.create("bulk-owner");
    await db
      .insert(schema.memberships)
      .values({ businessId: a.business.id, userId: user.sub, role: "owner" });
    owner = { claims: user, businessId: a.business.id, role: "owner" };
  });

  beforeEach(async () => {
    jobs.sends.length = 0;
    mail.sent.length = 0;
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
  });

  afterAll(async () => {
    await a?.cleanup();
    await users.cleanup();
    await close();
  });

  it("cancels them in one go and hands the emails to a job", async () => {
    const day = await Promise.all(["09:00", "10:00", "11:00", "12:00"].map((t) => insert(at(t))));
    const ids = day.map((b) => b.id);
    const result = await cancelBookingsForTeam(
      owner,
      ids,
      { reason: "Time off: Dentist" },
      { now: NOW, customerMessage: MESSAGE },
    );
    // Email isn't set up in tests, so nobody is promised one.
    expect(result).toEqual({ ok: true, data: { cancelled: 4, notCancelled: 0, notified: 0 } });
    expect(Object.values(await statuses(ids))).toEqual(Array(4).fill("cancelled"));

    // Two requests to Inngest, not one per booking: the reminders, then the emails.
    expect(jobs.sends).toHaveLength(2);
    const [reminders, emails] = jobs.sends;
    expect(reminders!.map((e) => [e.name, e.data.businessId])).toEqual(
      ids.map(() => ["booking/reminder.schedule", a.business.id]),
    );
    expect(reminders!.every((e) => e.name === "booking/reminder.schedule" && !e.data.sendAt)).toBe(
      true,
    );
    expect(emails).toEqual([
      {
        name: "booking/cancellation.emails",
        // In appointment order, however they were picked (or locked).
        data: { businessId: a.business.id, bookingIds: ids, message: MESSAGE },
      },
    ]);
    expect(mail.sent).toEqual([]); // the job sends them

    // The job's step, once per booking.
    for (const id of ids) {
      expect(await sendCancellationEmail(a.business.id, id, MESSAGE)).toBe(true);
    }
    expect(mail.sent.map((m) => m.subject)).toEqual([
      "Cancelled: Haircut, Tue 1 Dec at 09:00",
      "Cancelled: Haircut, Tue 1 Dec at 10:00",
      "Cancelled: Haircut, Tue 1 Dec at 11:00",
      "Cancelled: Haircut, Tue 1 Dec at 12:00",
    ]);
    expect(mail.sent[0]!.html).toContain("Mia isn&#x27;t available at that time any more.");
    expect(mail.sent[0]!.html).not.toContain("Dentist");
  });

  it("skips bookings that changed meanwhile, and nonsense IDs, cancelling the rest", async () => {
    const keep = await insert(at("09:00"));
    const gone = await insert(at("10:00"), { status: "cancelled", cancelledAt: NOW });
    const result = await cancelBookingsForTeam(
      owner,
      [keep.id, gone.id, "not-a-uuid", keep.id],
      {},
      { now: NOW, customerMessage: MESSAGE },
    );
    expect(result).toEqual({ ok: true, data: { cancelled: 1, notCancelled: 2, notified: 0 } });
    expect(await statuses([keep.id])).toEqual({ [keep.id]: "cancelled" });
    expect(jobs.sends[1]![0]!.data).toMatchObject({ bookingIds: [keep.id] });
  });

  it("two overlapping bulk cancels wait for each other instead of deadlocking", async () => {
    // An hour apart (45 min + buffer), inserted in one statement.
    const ids = (
      await db
        .insert(schema.bookings)
        .values(
          Array.from({ length: 8 }, (_, i) =>
            bookingValues(a, at(`${String(9 + i).padStart(2, "0")}:00`)),
          ),
        )
        .returning({ id: schema.bookings.id })
    ).map((b) => b.id);
    // Same bookings, picked in opposite orders (two tabs, two owners).
    const [first, second] = await Promise.all([
      cancelBookingsForTeam(owner, ids, {}, { now: NOW, customerMessage: MESSAGE }),
      cancelBookingsForTeam(owner, [...ids].reverse(), {}, { now: NOW, customerMessage: MESSAGE }),
    ]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Each booking was cancelled exactly once; the other attempt counted it as changed.
    expect(first.data.cancelled + second.data.cancelled).toBe(ids.length);
    expect(first.data.notCancelled + second.data.notCancelled).toBe(ids.length);
    expect(Object.values(await statuses(ids))).toEqual(Array(ids.length).fill("cancelled"));
  });

  it("can't cancel another business's bookings", async () => {
    const b = await createFixtureBusiness(db);
    try {
      const theirs = (
        await db
          .insert(schema.bookings)
          .values(bookingValues(b, at("09:00")))
          .returning()
      )[0]!;
      const result = await cancelBookingsForTeam(
        owner,
        [theirs.id],
        {},
        {
          now: NOW,
          customerMessage: MESSAGE,
        },
      );
      expect(result).toEqual({ ok: true, data: { cancelled: 0, notCancelled: 1, notified: 0 } });
      expect(await statuses([theirs.id])).toEqual({ [theirs.id]: "confirmed" });
      expect(jobs.sends).toEqual([]);
    } finally {
      await b.cleanup();
    }
  });

  it("the job's step skips a booking that isn't cancelled", async () => {
    const booking = await insert(at("09:00"));
    expect(await sendCancellationEmail(a.business.id, booking.id, MESSAGE)).toBe(false);
    expect(mail.sent).toEqual([]);
  });
});
