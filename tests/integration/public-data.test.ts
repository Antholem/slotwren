import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getInvitePreview, getInviteRecipient } from "@/server/db/queries/public/invites";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

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

  // The one public query that returns an address: server-only, used to email
  // the invitee their sign-in link. The browser gets maskEmail() of it.
  it("the invite's recipient is found only for a live, pending invite", async () => {
    expect(await getInviteRecipient({ tokenHash, now: new Date() })).toBe(inviteEmail);
    expect(await getInviteRecipient({ tokenHash: "0".repeat(64), now: new Date() })).toBeNull();
    const later = new Date(Date.now() + 2 * 86_400_000); // past expiry
    expect(await getInviteRecipient({ tokenHash, now: later })).toBeNull();
  });
});
