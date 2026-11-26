import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as configRoute, OPTIONS as configPreflight } from "@/app/api/embed/[slug]/route";
import { EMBED_DEFAULTS } from "@/lib/embed";
import { zonedInstant } from "@/lib/time-off";
import { bookFromPage } from "@/server/booking/public-booking";
import { saveEmbedSettings } from "@/server/catalog/embed";
import type { Actor } from "@/server/catalog/services";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The website widget's server side: the public config it fetches (CORS, the
 * "Allowed websites" list, public fields only, chat only with the AI
 * receptionist), owners saving its options (staff can't), and bookings made
 * inside it recorded with source "widget".
 */

describe("website widget", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: Actor;
  let staffer: Actor;

  const setBusiness = (values: Partial<typeof schema.businesses.$inferInsert>) =>
    db.update(schema.businesses).set(values).where(eq(schema.businesses.id, a.business.id));

  const config = (origin?: string, slug = a.business.slug) =>
    configRoute(
      new Request(`http://localhost/api/embed/${slug}`, {
        headers: origin ? { origin } : {},
      }),
      { params: Promise.resolve({ slug }) },
    );

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    await setBusiness({ onboardedAt: new Date(), minNoticeMin: 0 });
    await db
      .insert(schema.staffServices)
      .values({ businessId: a.business.id, staffId: a.staff.id, serviceId: a.service.id });
    await db.insert(schema.availabilityRules).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        businessId: a.business.id,
        staffId: a.staff.id,
        weekday,
        startTime: "09:00",
        endTime: "17:00",
      })),
    );
    const [ownerUser, staffUser] = await Promise.all([
      users.create("embed-owner"),
      users.create("embed-staff"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: ownerUser.sub, role: "owner" },
      { businessId: a.business.id, userId: staffUser.sub, role: "staff" },
    ]);
    owner = { claims: ownerUser, businessId: a.business.id, role: "owner" };
    staffer = { claims: staffUser, businessId: a.business.id, role: "staff" };
  });

  afterAll(async () => {
    await a?.cleanup();
    await users.cleanup();
    await close();
  });

  describe("GET /api/embed/<slug>", () => {
    it("gives any website the public options, with CORS and a short cache", async () => {
      await setBusiness({
        settings: {
          embed: { buttonText: "Book a visit", position: "bottom-left" },
          notifications: { ownerNewBookingEmail: true },
        },
      });
      const response = await config("https://www.harbor.example");
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      const body = await response.json();
      expect(body).toEqual({
        name: a.business.name,
        buttonText: "Book a visit",
        position: "bottom-left",
        chat: false, // no AI receptionist
        open: "booking",
        colors: {
          background: expect.stringMatching(/^#[0-9A-F]{6}$/i),
          foreground: expect.stringMatching(/^#[0-9A-F]{6}$/i),
          hover: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        },
      });
      const json = JSON.stringify(body);
      for (const hidden of ["allowedOrigins", "ownerNewBookingEmail", a.business.id, "settings"]) {
        expect(json).not.toContain(hidden);
      }
    });

    it("answers the preflight", async () => {
      const response = configPreflight();
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-methods")).toBe("GET");
    });

    it("offers the chat only when the AI receptionist is on and the plan is Pro", async () => {
      await setBusiness({ settings: { embed: { open: "chat" } }, aiEnabled: true, plan: "free" });
      expect(await (await config()).json()).toMatchObject({ chat: false, open: "booking" });

      await setBusiness({ plan: "pro" });
      expect(await (await config()).json()).toMatchObject({ chat: true, open: "chat" });

      await setBusiness({ settings: { embed: { showChat: false, open: "chat" } } });
      expect(await (await config()).json()).toMatchObject({ chat: false, open: "chat" });

      await setBusiness({ aiEnabled: false, plan: "free" });
    });

    it("refuses websites outside the allowed list", async () => {
      await setBusiness({
        settings: { embed: { allowedOrigins: ["https://www.harbor.example"] } },
      });
      expect((await config("https://www.harbor.example")).status).toBe(200);
      const refused = await config("https://copycat.example");
      expect(refused.status).toBe(403);
      expect(refused.headers.get("cache-control")).toBe("no-store");
      expect(await refused.json()).toEqual({ error: "not_allowed" });
      expect((await config()).status).toBe(403); // no Origin at all
      await setBusiness({ settings: {} });
    });

    it("404s an unknown or malformed slug", async () => {
      expect((await config(undefined, "no-such-business-here")).status).toBe(404);
      expect((await config(undefined, "../../etc")).status).toBe(404);
    });
  });

  describe("saving the options", () => {
    const input = {
      ...EMBED_DEFAULTS,
      buttonText: "Book a visit",
      position: "inline" as const,
      allowedOrigins: ["www.harbor.example", "https://www.harbor.example/book"],
    };

    it("owners save them, normalised, without touching the rest of settings", async () => {
      await setBusiness({ settings: { notifications: { ownerNewBookingEmail: false } } });
      const result = await saveEmbedSettings(owner, input);
      expect(result).toEqual({
        ok: true,
        data: { ...input, allowedOrigins: ["https://www.harbor.example"] },
      });
      const [row] = await db
        .select({ settings: schema.businesses.settings })
        .from(schema.businesses)
        .where(eq(schema.businesses.id, a.business.id));
      expect(row!.settings).toEqual({
        notifications: { ownerNewBookingEmail: false },
        embed: { ...input, allowedOrigins: ["https://www.harbor.example"] },
      });
    });

    it("staff can't", async () => {
      const result = await saveEmbedSettings(staffer, { ...input, buttonText: "Hijacked" });
      expect(result.ok || result.error.code).toBe("forbidden");
    });

    it("invalid options come back as a message to show", async () => {
      const result = await saveEmbedSettings(owner, { ...input, allowedOrigins: ["not a site"] });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid_input", message: `"not a site" isn't a website address.` },
      });
    });
  });

  it("a booking made inside the widget is recorded as Widget; anything else as the page", async () => {
    const book = (source: unknown, time: string) =>
      bookFromPage({
        slug: a.business.slug,
        ip: `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
        source: source as "widget",
        now: new Date("2026-11-25T00:00:00Z"),
        input: {
          serviceId: a.service.id,
          staffId: "any",
          startsAt: zonedInstant("2026-12-03", time, "Asia/Manila").toISOString(),
          customer: { name: `Widget ${time}`, email: `widget-${Date.now()}@example.com` },
        },
      });
    const viaWidget = await book("widget", "10:00");
    const viaPage = await book(undefined, "12:00");
    expect(viaWidget.ok && viaPage.ok).toBe(true);
    const rows = await db
      .select({ name: schema.bookings.customerName, source: schema.bookings.source })
      .from(schema.bookings)
      .where(eq(schema.bookings.businessId, a.business.id));
    expect(rows).toEqual(
      expect.arrayContaining([
        { name: "Widget 10:00", source: "widget" },
        { name: "Widget 12:00", source: "page" },
      ]),
    );
  });
});
