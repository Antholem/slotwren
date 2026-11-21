import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as slotsRoute } from "@/app/api/slots/[slug]/route";
import { zonedInstant } from "@/lib/time-off";
import { cancelBooking, createBooking, rescheduleBooking } from "@/server/booking/service";
import { generateToken, hashToken } from "@/server/booking/tokens";
import type { Actor } from "@/server/catalog/services";
import { type RlsClaims, withRls } from "@/server/db/client";
import { withPublicBookings } from "@/server/db/queries/public/bookings";
import { findBookingByManageToken } from "@/server/db/queries/public/bookings";
import { getManagedBooking } from "@/server/db/queries/public/manage";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness, pgErrorCode } from "../support/db";

// Emails aren't the subject here.
vi.mock("@/server/email/send", () => ({
  sendEmail: async () => ({ delivered: true }),
  fromAddress: () => "x",
}));

/*
 * Manage links live in manage_tokens: several live tokens per booking, each
 * expiring when the appointment ends, all revoked when it's cancelled, and
 * minted only through private.mint_manage_token() (docs/adr/0002).
 */

const MANILA = "Asia/Manila";
const at = (time: string, date = "2026-12-01") => zonedInstant(date, time, MANILA);
const NOW = new Date("2026-11-25T00:00:00Z");

type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

describe("manage tokens", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Fixture;
  let b: Fixture;
  let jonahId: string;
  let owner: Actor;
  let staffer: Actor; // Jonah's login in A
  let ownerB: Actor;

  const live = (token: string, now = NOW) =>
    findBookingByManageToken({ tokenHash: hashToken(token), now });
  const tokensOf = (bookingId: string) =>
    db
      .select()
      .from(schema.manageTokens)
      .where(eq(schema.manageTokens.bookingId, bookingId))
      .orderBy(schema.manageTokens.createdAt);

  async function booked(startsAt = at("10:00"), staffId?: string) {
    const result = await createBooking(
      { kind: "public", businessId: a.business.id, source: "page" },
      {
        serviceId: a.service.id,
        staffId: staffId ?? a.staff.id,
        startsAt: startsAt.toISOString(),
        customer: { name: "Rosa Cruz", email: `rosa-${Date.now()}-${Math.random()}@example.com` },
      },
      { now: NOW },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }

  /** Mint as a signed-in member; the SQLSTATE if refused. */
  async function mintAs(claims: RlsClaims, bookingId: string, hash = hashToken(generateToken())) {
    try {
      await withRls(claims, (tx) =>
        tx.execute(
          sql`select private.mint_manage_token(${bookingId}, ${hash}, 'rescheduled'::public.manage_token_purpose)`,
        ),
      );
      return "minted";
    } catch (error) {
      return pgErrorCode(error);
    }
  }

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    for (const f of [a, b]) {
      await db
        .update(schema.businesses)
        .set({ onboardedAt: new Date() })
        .where(eq(schema.businesses.id, f.business.id));
    }
    const [ownerUser, staffUser, ownerUserB] = await Promise.all([
      users.create("tokens-owner-a"),
      users.create("tokens-staff-a"),
      users.create("tokens-owner-b"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerUserB.sub, role: "owner" },
    ]);
    const [jonah] = await db
      .insert(schema.staff)
      .values({ businessId: a.business.id, name: "Jonah", color: "violet", userId: staffUser.sub })
      .returning({ id: schema.staff.id });
    jonahId = jonah!.id;
    const businessId = a.business.id;
    await db.insert(schema.staffServices).values([
      { businessId, staffId: a.staff.id, serviceId: a.service.id },
      { businessId, staffId: jonahId, serviceId: a.service.id },
    ]);
    await db.insert(schema.availabilityRules).values(
      [a.staff.id, jonahId].flatMap((staffId) =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          businessId,
          staffId,
          weekday,
          startTime: "09:00",
          endTime: "17:00",
        })),
      ),
    );
    owner = { claims: ownerUser, businessId, role: "owner" };
    staffer = { claims: staffUser, businessId, role: "staff" };
    ownerB = { claims: ownerUserB, businessId: b.business.id, role: "owner" };
  });

  beforeEach(async () => {
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, a.business.id));
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("expiry", () => {
    it("opens the booking until the appointment ends, then never again", async () => {
      const created = await booked(at("10:00")); // ends 10:45
      expect(await live(created.manageToken, at("10:44"))).toMatchObject({
        bookingId: created.id,
      });
      expect(await live(created.manageToken, at("10:45"))).toBeNull();
      expect(
        await getManagedBooking({ tokenHash: hashToken(created.manageToken), now: at("11:00") }),
      ).toBeNull();
      const late = await cancelBooking(
        { kind: "customer", manageToken: created.manageToken },
        {},
        { now: at("11:00") },
      );
      expect(late.ok || late.error.code).toBe("not_found");
    });

    it("moves with the booking when the business moves it", async () => {
      const created = await booked(at("10:00"));
      const moved = await rescheduleBooking(
        { kind: "member", actor: owner, bookingId: created.id },
        { startsAt: at("10:00", "2026-12-02").toISOString() },
        { now: NOW },
      );
      expect(moved.ok).toBe(true);
      const tokens = await tokensOf(created.id);
      expect(tokens.map((t) => [t.purpose, t.expiresAt, t.revokedAt])).toEqual([
        ["created", at("10:45", "2026-12-02"), null],
        ["rescheduled", at("10:45", "2026-12-02"), null],
      ]);
      // Both the confirmation's link and the new one still work, a day later.
      expect(await live(created.manageToken, at("12:00"))).not.toBeNull();
      if (moved.ok) expect(await live(moved.data.manageToken, at("12:00"))).not.toBeNull();
    });
  });

  describe("several live links", () => {
    it("keeps every email's link working at once (confirmation, reschedule, reminder)", async () => {
      const created = await booked();
      const moved = await rescheduleBooking(
        { kind: "member", actor: owner, bookingId: created.id },
        { startsAt: at("11:00").toISOString() },
        { now: NOW },
      );
      const reminder = generateToken();
      await withPublicBookings(a.business.id, (store) =>
        store.mintManageToken(created.id, hashToken(reminder), "reminder"),
      );
      for (const token of [created.manageToken, moved.ok ? moved.data.manageToken : "", reminder]) {
        expect(await live(token)).toEqual({ businessId: a.business.id, bookingId: created.id });
      }
      expect((await tokensOf(created.id)).map((t) => t.purpose)).toEqual([
        "created",
        "rescheduled",
        "reminder",
      ]);
    });
  });

  describe("revocation", () => {
    it("cancelling revokes every link, whoever cancels", async () => {
      for (const access of ["member", "customer"] as const) {
        const created = await booked(access === "member" ? at("10:00") : at("13:00"));
        const moved = await rescheduleBooking(
          { kind: "member", actor: owner, bookingId: created.id },
          { startsAt: (access === "member" ? at("11:00") : at("14:00")).toISOString() },
          { now: NOW },
        );
        const second = moved.ok ? moved.data.manageToken : "";
        const result = await cancelBooking(
          access === "member"
            ? { kind: "member", actor: owner, bookingId: created.id }
            : { kind: "customer", manageToken: second },
          {},
          { now: NOW },
        );
        expect(result.ok, access).toBe(true);
        expect(await live(created.manageToken)).toBeNull();
        expect(await live(second)).toBeNull();
        expect((await tokensOf(created.id)).every((t) => t.revokedAt !== null)).toBe(true);
      }
    });

    it("a customer's reschedule revokes all their links and issues one new one", async () => {
      const created = await booked();
      const businessMove = await rescheduleBooking(
        { kind: "member", actor: owner, bookingId: created.id },
        { startsAt: at("11:00").toISOString() },
        { now: NOW },
      );
      const fromBusiness = businessMove.ok ? businessMove.data.manageToken : "";
      const customerMove = await rescheduleBooking(
        { kind: "customer", manageToken: created.manageToken },
        { startsAt: at("14:00").toISOString() },
        { now: NOW },
      );
      expect(customerMove.ok).toBe(true);
      if (!customerMove.ok) return;
      expect(await live(created.manageToken)).toBeNull();
      expect(await live(fromBusiness)).toBeNull();
      expect(await live(customerMove.data.manageToken)).not.toBeNull();
      expect((await tokensOf(created.id)).filter((t) => t.revokedAt === null)).toHaveLength(1);
    });
  });

  describe("minting", () => {
    it("owners mint for any booking in their business; staff only for their own", async () => {
      const mias = await booked(at("10:00"));
      const jonahs = await booked(at("10:00"), jonahId);
      expect(await mintAs(owner.claims, mias.id)).toBe("minted");
      expect(await mintAs(staffer.claims, jonahs.id)).toBe("minted");
      expect(await mintAs(staffer.claims, mias.id)).toBe("42501");
    });

    it("another business's owner can't mint for this one", async () => {
      const created = await booked();
      expect(await mintAs(ownerB.claims, created.id)).toBe("42501");
      expect((await tokensOf(created.id)).map((t) => t.purpose)).toEqual(["created"]);
    });

    it("refuses cancelled bookings and anything that isn't a SHA-256 digest", async () => {
      const created = await booked();
      expect(await mintAs(owner.claims, created.id, created.manageToken)).toBe("22023");
      await cancelBooking(
        { kind: "member", actor: owner, bookingId: created.id },
        {},
        { now: NOW },
      );
      expect(await mintAs(owner.claims, created.id)).toBe("22023");
    });

    it("members can't read or write the token table directly", async () => {
      const created = await booked();
      const attempt = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return "allowed";
        } catch (error) {
          return pgErrorCode(error);
        }
      };
      expect(
        await attempt(() =>
          withRls(owner.claims, (tx) =>
            tx
              .select()
              .from(schema.manageTokens)
              .where(eq(schema.manageTokens.bookingId, created.id)),
          ),
        ),
      ).toBe("42501");

      let insert: string | undefined = "inserted";
      try {
        await withRls(owner.claims, (tx) =>
          tx.insert(schema.manageTokens).values({
            businessId: a.business.id,
            bookingId: created.id,
            tokenHash: hashToken(generateToken()),
            purpose: "reminder",
            expiresAt: at("23:00"),
          }),
        );
      } catch (error) {
        insert = pgErrorCode(error);
      }
      expect(insert).toBe("42501");

      expect(
        await attempt(() =>
          withRls(owner.claims, (tx) =>
            tx
              .update(schema.manageTokens)
              .set({ revokedAt: NOW })
              .where(eq(schema.manageTokens.bookingId, created.id)),
          ),
        ),
      ).toBe("42501");
      expect(await live(created.manageToken)).not.toBeNull();
    });
  });

  describe("across businesses", () => {
    it("a link opens only its own business's booking, even through another's slots API", async () => {
      const created = await booked();
      const url = (slug: string) =>
        `http://localhost/api/slots/${slug}?${new URLSearchParams({
          service: a.service.id,
          staff: a.staff.id,
          from: at("00:00").toISOString(),
          to: at("00:00", "2026-12-02").toISOString(),
          tz: MANILA,
          manage: created.manageToken,
        })}`;
      const call = (slug: string) =>
        slotsRoute(new Request(url(slug)), { params: Promise.resolve({ slug }) });
      expect((await call(a.business.slug)).status).toBe(200);
      expect((await call(b.business.slug)).status).toBe(404);
    });

    it("can't be planted on another business's booking", async () => {
      const [other] = await db
        .insert(schema.bookings)
        .values(bookingValues(b, at("10:00")))
        .returning();
      const created = await booked();
      // The composite key keeps a token's business and booking together.
      let planted: string | undefined = "inserted";
      try {
        await db.insert(schema.manageTokens).values({
          businessId: a.business.id,
          bookingId: other!.id,
          tokenHash: hashToken(generateToken()),
          purpose: "reminder",
          expiresAt: at("23:00"),
        });
      } catch (error) {
        planted = pgErrorCode(error);
      }
      expect(planted).toBe("23503");
      const tokens = await db
        .select()
        .from(schema.manageTokens)
        .where(
          and(
            eq(schema.manageTokens.businessId, b.business.id),
            eq(schema.manageTokens.bookingId, created.id),
          ),
        );
      expect(tokens).toEqual([]);
    });
  });
});
