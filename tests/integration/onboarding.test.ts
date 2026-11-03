import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultWeek } from "@/lib/hours";
import type { RlsClaims } from "@/server/db/client";
import {
  getAccountStatus,
  getSetupState,
  isSlugAvailable,
  saveBasics,
  saveBrand,
  saveFirstService,
  saveHours,
  staffNameFor,
} from "@/server/db/queries/onboarding";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { connectTestDb } from "../support/db";

/*
 * The onboarding wizard's data path, as the signed-in owner (withRls): every
 * step saves, resumes, and ends with a live business.
 */
describe("onboarding wizard", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  const slug = `wizard-${randomBytes(4).toString("hex")}`;
  let owner: RlsClaims;
  let businessId: string;

  beforeAll(async () => {
    owner = await users.create("wizard-owner");
  });

  afterAll(async () => {
    await db.delete(schema.businesses).where(eq(schema.businesses.slug, slug));
    await users.cleanup();
    await close();
  });

  it("starts with no business", async () => {
    expect(await getAccountStatus(owner)).toBe("none");
    expect(await getSetupState(owner)).toBeNull();
  });

  it("step 1 creates the business, makes the user its owner and a staff member", async () => {
    expect(await isSlugAvailable(owner, slug)).toBe(true);
    businessId = await saveBasics(owner, { name: "Wizard Studio", slug, timezone: "Asia/Manila" });

    const state = await getSetupState(owner);
    expect(state?.business).toMatchObject({
      id: businessId,
      slug,
      setupStep: 1,
      onboardedAt: null,
    });
    expect(await getAccountStatus(owner)).toBe("setup");

    const [membership] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.businessId, businessId));
    expect(membership).toMatchObject({ userId: owner.sub, role: "owner" });

    const team = await db
      .select()
      .from(schema.staff)
      .where(eq(schema.staff.businessId, businessId));
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ userId: owner.sub, color: "teal" });
  });

  it("revisiting step 1 updates the same business instead of creating another", async () => {
    const again = await saveBasics(owner, {
      name: "Wizard Studio & Spa",
      slug,
      timezone: "Europe/London",
    });
    expect(again).toBe(businessId);
    const owned = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, owner.sub));
    expect(owned).toHaveLength(1);
    expect((await getSetupState(owner))?.business.name).toBe("Wizard Studio & Spa");
  });

  it("treats its own slug as available, and a taken one as not", async () => {
    expect(await isSlugAvailable(owner, slug, businessId)).toBe(true);
    expect(await isSlugAvailable(owner, slug)).toBe(false);
    expect(await isSlugAvailable(owner, "lumen-studio", businessId)).toBe(false); // the seed
  });

  it("step 2 saves the brand and advances to step 2", async () => {
    await saveBrand(owner, businessId, { brandColor: "#BE123C", logoUrl: null });
    expect((await getSetupState(owner))?.business).toMatchObject({
      brandColor: "#BE123C",
      logoUrl: null,
      setupStep: 2,
    });
  });

  it("step 3 creates the first service, assigned to the owner, and updates it on a revisit", async () => {
    const service = {
      name: "Haircut",
      durationMin: 45,
      price: 3500,
      bufferAfterMin: 15,
      description: null,
    };
    await saveFirstService(owner, businessId, service);
    await saveFirstService(owner, businessId, { ...service, name: "Haircut & Style" });

    const rows = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.businessId, businessId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Haircut & Style",
      priceCents: 3500,
      bufferAfterMin: 15,
    });

    const assigned = await db
      .select()
      .from(schema.staffServices)
      .where(eq(schema.staffServices.serviceId, rows[0]!.id));
    expect(assigned).toHaveLength(1);
    expect((await getSetupState(owner))?.business.setupStep).toBe(3);
  });

  it("step 4 saved for later stores the hours but doesn't go live", async () => {
    await saveHours(owner, businessId, defaultWeek(), { goLive: false });
    const state = await getSetupState(owner);
    expect(state?.hours).toHaveLength(5);
    expect(state?.business).toMatchObject({ setupStep: 3, onboardedAt: null });
    expect(await getAccountStatus(owner)).toBe("setup");
  });

  it("step 4 finished replaces the hours and puts the business live", async () => {
    const days = defaultWeek().map((day) =>
      day.weekday === 1
        ? {
            ...day,
            ranges: [
              { start: "09:00", end: "12:00" },
              { start: "13:00", end: "18:00" },
            ],
          }
        : day,
    );
    await saveHours(owner, businessId, days, { goLive: true });

    const live = await getSetupState(owner, { includeLive: true });
    expect(live?.hours).toHaveLength(6);
    expect(live?.business.setupStep).toBe(4);
    expect(live?.business.onboardedAt).toBeInstanceOf(Date);
    expect(await getAccountStatus(owner)).toBe("ready");
    // Nothing left in progress: the wizard is done.
    expect(await getSetupState(owner)).toBeNull();
  });
});

describe("staffNameFor", () => {
  it.each([
    ["Mia Santos", "x@example.com", "Mia Santos"],
    [null, "mia.santos@example.com", "Mia Santos"],
    ["  ", "jonah_reyes+test@example.com", "Jonah Reyes Test"],
    [null, undefined, "Owner"],
  ])("(%j, %j) → %j", (fullName, email, expected) => {
    expect(staffNameFor(fullName, email)).toBe(expected);
  });
});
