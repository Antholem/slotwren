import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getNextOpenings, getPublicSlots } from "@/server/booking/public-slots";
import { getBookingConfirmation, getBookingPage } from "@/server/db/queries/public/booking-page";
import { findBookingByManageToken } from "@/server/db/queries/public/bookings";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { getBusinessContact, getManagedBooking } from "@/server/db/queries/public/manage";
import { getInvitePreview, getInviteRecipient } from "@/server/db/queries/public/invites";
import * as schema from "@/server/db/schema";

import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * Public queries (adminDb, no signed-in user) may only return public fields
 * (CLAUDE.md, rule 2). Each one is serialised here and searched for private
 * column names and seeded private values.
 */

const PRIVATE_KEYS = [
  "token_hash",
  "tokenHash",
  "manage_token_hash",
  "manageTokenHash",
  "stripe_customer_id",
  "stripeCustomerId",
  "notes",
  "settings",
  "invitedBy",
  "phone",
  "email",
  "customerId",
  "customerName",
  "contactEmail",
];

describe("public data", () => {
  const { db, close } = connectTestDb();
  let fixture: Awaited<ReturnType<typeof createFixtureBusiness>>;
  const inviteEmail = `private-invitee-${Date.now()}@example.com`;
  const token = "public-data-test-token-0123456789abcdef0123456789";
  const tokenHash = createHash("sha256").update(token).digest("hex");

  beforeAll(async () => {
    fixture = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ stripeCustomerId: `cus_private_${Date.now()}` })
      .where(eq(schema.businesses.id, fixture.business.id));
    await db
      .update(schema.customers)
      .set({ notes: "PRIVATE NOTE do not leak" })
      .where(eq(schema.customers.id, fixture.customer.id));
    await db.insert(schema.staffInvites).values({
      businessId: fixture.business.id,
      staffId: fixture.staff.id,
      email: inviteEmail,
      tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await close();
  });

  function expectNothingPrivate(value: unknown) {
    const json = JSON.stringify(value);
    for (const key of PRIVATE_KEYS) expect(json, key).not.toContain(`"${key}"`);
    for (const secret of [
      tokenHash,
      token,
      inviteEmail,
      fixture.customer.email,
      "PRIVATE NOTE",
      "cus_private_",
    ]) {
      expect(json, secret).not.toContain(secret);
    }
  }

  it("the invite preview shows the business and a masked email only", async () => {
    const preview = await getInvitePreview({ tokenHash, now: new Date() });
    expect(preview).toMatchObject({
      businessId: fixture.business.id,
      businessName: fixture.business.name,
      emailHint: "p••@example.com",
      status: "pending",
    });
    expectNothingPrivate(preview);
  });

  it("an unknown token reveals nothing", async () => {
    expect(await getInvitePreview({ tokenHash: "0".repeat(64), now: new Date() })).toBeNull();
  });

  it("the booking page sees the business's public fields only, once it's live", async () => {
    // Fixture businesses haven't finished onboarding: no public page yet.
    expect(await getPublicBusinessBySlug(fixture.business.slug)).toBeNull();
    await db
      .update(schema.businesses)
      .set({ onboardedAt: new Date() })
      .where(eq(schema.businesses.id, fixture.business.id));

    const business = await getPublicBusinessBySlug(fixture.business.slug);
    expect(business).toEqual({
      id: fixture.business.id,
      slug: fixture.business.slug,
      name: fixture.business.name,
      logoUrl: null,
      brandColor: fixture.business.brandColor,
    });
    expectNothingPrivate(business);
    expect(await getPublicBusinessBySlug("no-such-business-here")).toBeNull();
  });

  // The one public query that returns an address: server-only, used to email
  // the invitee their sign-in link. The browser gets maskEmail() of it.
  it("a manage link resolves to its business and booking IDs only", async () => {
    const [booking] = await db
      .insert(schema.bookings)
      .values(bookingValues(fixture, new Date("2026-11-03T02:00:00Z")))
      .returning();
    await db.insert(schema.manageTokens).values({
      businessId: fixture.business.id,
      bookingId: booking!.id,
      tokenHash,
      purpose: "created",
      expiresAt: booking!.endsAt,
    });
    const now = new Date("2026-11-01T00:00:00Z");
    const found = await findBookingByManageToken({ tokenHash, now });
    expect(found).toEqual({ businessId: fixture.business.id, bookingId: booking!.id });
    expectNothingPrivate(found);
    expect(await findBookingByManageToken({ tokenHash: "0".repeat(64), now })).toBeNull();
  });

  it("the invite's recipient is found only for a live, pending invite", async () => {
    expect(await getInviteRecipient({ tokenHash, now: new Date() })).toBe(inviteEmail);
    expect(await getInviteRecipient({ tokenHash: "0".repeat(64), now: new Date() })).toBeNull();
    const later = new Date(Date.now() + 2 * 86_400_000); // past expiry
    expect(await getInviteRecipient({ tokenHash, now: later })).toBeNull();
  });

  describe("the booking page", () => {
    // Mia does the haircut. Jonah left (inactive), Kai does nothing yet, one
    // service is archived and another only Jonah did: none of those show.
    let jonahId: string;
    let kaiId: string;
    let retiredId: string;
    let unstaffedId: string;

    beforeAll(async () => {
      const businessId = fixture.business.id;
      await db
        .update(schema.businesses)
        .set({
          address: "12 Lumen Lane",
          phone: "+63 2 8000 0000",
          contactEmail: "owner-private@example.com",
          settings: {
            openingHours: [{ weekday: 2, start: "09:00", end: "18:00" }],
            notifications: { ownerNewBookingEmail: true },
          },
        })
        .where(eq(schema.businesses.id, businessId));
      const [jonah, kai] = await db
        .insert(schema.staff)
        .values([
          { businessId, name: "Jonah", color: "violet", active: false },
          { businessId, name: "Kai", color: "pink" },
        ])
        .returning({ id: schema.staff.id });
      jonahId = jonah!.id;
      kaiId = kai!.id;
      const [retired, unstaffed] = await db
        .insert(schema.services)
        .values([
          { businessId, name: "Retired", durationMin: 30, archivedAt: new Date() },
          { businessId, name: "Only Jonah did this", durationMin: 30 },
        ])
        .returning({ id: schema.services.id });
      retiredId = retired!.id;
      unstaffedId = unstaffed!.id;
      await db.insert(schema.staffServices).values([
        { businessId, staffId: fixture.staff.id, serviceId: fixture.service.id },
        { businessId, staffId: jonahId, serviceId: fixture.service.id },
        { businessId, staffId: jonahId, serviceId: unstaffedId },
        { businessId, staffId: fixture.staff.id, serviceId: retiredId },
      ]);
      await db.insert(schema.availabilityRules).values(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          businessId,
          staffId: fixture.staff.id,
          weekday,
          startTime: "09:00",
          endTime: "17:00",
        })),
      );
    });

    it("shows the public profile, bookable services and the people who do them", async () => {
      const page = await getBookingPage(fixture.business.id);
      expect(page).toEqual({
        business: {
          id: fixture.business.id,
          slug: fixture.business.slug,
          name: fixture.business.name,
          logoUrl: null,
          brandColor: fixture.business.brandColor,
          address: "12 Lumen Lane",
          timezone: "Asia/Manila",
          currency: "USD",
          cancellationWindowHours: 24,
          maxDaysAhead: 60,
          openingHours: [{ weekday: 2, start: "09:00", end: "18:00" }],
        },
        services: [{ id: fixture.service.id, name: "Haircut", durationMin: 45, priceCents: 3500 }],
        staff: [
          {
            id: fixture.staff.id,
            name: "Mia",
            title: null,
            color: "teal",
            serviceIds: [fixture.service.id],
          },
        ],
      });
      expectNothingPrivate(page);
      const json = JSON.stringify(page);
      for (const hidden of [
        "+63 2 8000 0000",
        "owner-private@",
        "ownerNewBookingEmail",
        kaiId, // does nothing bookable
        jonahId, // inactive
        retiredId, // archived
        unstaffedId, // only an inactive person does it
      ]) {
        expect(json).not.toContain(hidden);
      }
    });

    it("has nothing for a business that doesn't exist", async () => {
      expect(await getBookingPage("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("lists times with labels and staff IDs only", async () => {
      const now = new Date("2026-11-01T00:00:00Z");
      // Booked 13:00 to 14:00 on Tue 3 Nov (Manila), so some times are taken.
      await db
        .insert(schema.bookings)
        .values(bookingValues(fixture, new Date("2026-11-03T05:00:00Z")));
      const slots = await getPublicSlots({
        businessId: fixture.business.id,
        serviceId: fixture.service.id,
        staffId: "any",
        from: new Date("2026-11-02T16:00:00Z"),
        to: new Date("2026-11-03T16:00:00Z"),
        timezone: "Europe/London",
        now,
      });
      const day = slots!.days["2026-11-03"]!;
      expect(day.available[0]).toEqual({
        start: "2026-11-03T01:00:00.000Z",
        end: "2026-11-03T01:45:00.000Z",
        staffId: fixture.staff.id,
        date: "2026-11-03",
        time: "01:00", // on a London clock
        offset: "+00:00",
        zone: "GMT",
        repeated: null,
      });
      expect(day.taken.map((t) => t.start)).toContain("2026-11-03T05:00:00.000Z");
      expect(day.taken.every((t) => t.staffId === null)).toBe(true);
      expect(slots!.next).not.toBeNull();
      expectNothingPrivate(slots);

      const openings = await getNextOpenings({
        businessId: fixture.business.id,
        serviceId: fixture.service.id,
        staffIds: [fixture.staff.id],
        timezone: "Asia/Manila",
        now,
      });
      expect(openings).toEqual({
        // 08:00 Manila plus two hours' notice.
        any: "2026-11-01T02:00:00.000Z",
        [fixture.staff.id]: "2026-11-01T02:00:00.000Z",
      });
    });

    it("lists nothing for a service customers can't book", async () => {
      const window = {
        businessId: fixture.business.id,
        staffId: "any",
        from: new Date("2026-11-02T16:00:00Z"),
        to: new Date("2026-11-03T16:00:00Z"),
        timezone: "Asia/Manila",
        now: new Date("2026-11-01T00:00:00Z"),
      };
      expect(await getPublicSlots({ ...window, serviceId: retiredId })).toBeNull();
      const unstaffed = await getPublicSlots({ ...window, serviceId: unstaffedId });
      expect(Object.values(unstaffed!.days).flatMap((d) => d.available)).toEqual([]);
    });

    it("confirms a booking without anything about the customer", async () => {
      const [booking] = await db
        .insert(schema.bookings)
        .values(
          bookingValues(fixture, new Date("2026-11-04T02:00:00Z"), {
            customerNotes: "PRIVATE NOTE from the customer",
          }),
        )
        .returning({ id: schema.bookings.id, code: schema.bookings.code });
      const confirmation = await getBookingConfirmation({
        businessId: fixture.business.id,
        bookingId: booking!.id,
      });
      expect(confirmation).toEqual({
        id: booking!.id,
        code: booking!.code,
        status: "confirmed",
        startsAt: new Date("2026-11-04T02:00:00Z"),
        endsAt: new Date("2026-11-04T02:45:00Z"),
        serviceName: "Haircut",
        durationMin: 45,
        staffName: "Mia",
        priceCents: 3500,
      });
      expectNothingPrivate(confirmation);
      expect(JSON.stringify(confirmation)).not.toContain("Ana Santos");

      // Another business's ID finds nothing.
      const other = await createFixtureBusiness(db);
      try {
        expect(
          await getBookingConfirmation({ businessId: other.business.id, bookingId: booking!.id }),
        ).toBeNull();
      } finally {
        await other.cleanup();
      }
    });
  });

  describe("the manage page", () => {
    const EARLIER = new Date("2026-11-01T00:00:00Z");
    const manageToken = "manage-page-public-data-token-0123456789abcdef";
    const manageHash = createHash("sha256").update(manageToken).digest("hex");
    let bookingId: string;

    beforeAll(async () => {
      await db
        .update(schema.businesses)
        .set({ phone: "+63 2 8000 0000", contactEmail: "frontdesk@example.com" })
        .where(eq(schema.businesses.id, fixture.business.id));
      const [row] = await db
        .insert(schema.bookings)
        .values(
          bookingValues(fixture, new Date("2026-11-05T02:00:00Z"), {
            customerNotes: "Allergic to lavender",
          }),
        )
        .returning();
      bookingId = row!.id;
      await db.insert(schema.manageTokens).values({
        businessId: fixture.business.id,
        bookingId,
        tokenHash: manageHash,
        purpose: "created",
        expiresAt: row!.endsAt,
      });
    });

    it("shows the token holder their booking: their name and notes, nothing private", async () => {
      const managed = await getManagedBooking({ tokenHash: manageHash, now: EARLIER });
      expect(managed).toMatchObject({
        businessId: fixture.business.id,
        id: bookingId,
        status: "confirmed",
        serviceName: "Haircut",
        staffName: "Mia",
        customerName: "Ana Santos",
        customerNotes: "Allergic to lavender",
      });
      const json = JSON.stringify(managed);
      for (const key of ["email", "phone", "manageTokenHash", "tokenHash", "notes", "customerId"]) {
        expect(json, key).not.toContain(`"${key}"`);
      }
      for (const secret of [manageHash, fixture.customer.email, "PRIVATE NOTE"]) {
        expect(json).not.toContain(secret);
      }
      expect(await getManagedBooking({ tokenHash: "0".repeat(64), now: EARLIER })).toBeNull();
    });

    // The one public query with the business's phone and email: what a
    // customer needs once online changes have closed.
    it("gives the business's contact details, and nothing else", async () => {
      const contact = await getBusinessContact({ businessId: fixture.business.id });
      expect(contact).toEqual({
        businessPhone: "+63 2 8000 0000",
        businessEmail: "frontdesk@example.com",
      });
    });

    it("lets a booking being moved see its own time as free", async () => {
      const window = {
        businessId: fixture.business.id,
        serviceId: fixture.service.id,
        staffId: fixture.staff.id,
        from: new Date("2026-11-04T16:00:00Z"),
        to: new Date("2026-11-05T16:00:00Z"),
        timezone: "Asia/Manila",
        now: new Date("2026-11-01T00:00:00Z"),
      };
      const own = "2026-11-05T02:00:00.000Z";
      const before = await getPublicSlots(window);
      expect(before!.days["2026-11-05"]!.taken.map((t) => t.start)).toContain(own);
      const moving = await getPublicSlots({ ...window, excludeBookingId: bookingId });
      expect(moving!.days["2026-11-05"]!.available.map((t) => t.start)).toContain(own);
    });
  });
});
