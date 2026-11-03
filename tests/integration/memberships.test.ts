import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type RlsClaims, withRls } from "@/server/db/client";
import { hasAnyMembership } from "@/server/db/queries/memberships";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { connectTestDb, createFixtureBusiness } from "../support/db";

// The proxy's "has a business?" check (→ /app, else → /onboarding).
describe("hasAnyMembership", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let fixture: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: RlsClaims;
  let newcomer: RlsClaims;

  beforeAll(async () => {
    fixture = await createFixtureBusiness(db);
    owner = await users.create("owner");
    newcomer = await users.create("newcomer");
    await db
      .insert(schema.memberships)
      .values({ businessId: fixture.business.id, userId: owner.sub, role: "owner" });
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await users.cleanup();
    await close();
  });

  it("is true for a member of a business", async () => {
    expect(await hasAnyMembership(owner)).toBe(true);
  });

  it("is false for a signed-in user with no business yet", async () => {
    expect(await hasAnyMembership(newcomer)).toBe(false);
  });

  it("RLS hides other businesses' memberships, even without a filter", async () => {
    const seenByOwner = await withRls(owner, (tx) => tx.select().from(schema.memberships));
    expect(seenByOwner.map((m) => m.userId)).toEqual([owner.sub]);

    const seenByNewcomer = await withRls(newcomer, (tx) => tx.select().from(schema.memberships));
    expect(seenByNewcomer).toEqual([]);
  });

  it("RLS refuses a user adding themselves to a business", async () => {
    const attempt = withRls(newcomer, (tx) =>
      tx
        .insert(schema.memberships)
        .values({ businessId: fixture.business.id, userId: newcomer.sub, role: "owner" }),
    );
    await expect(attempt).rejects.toThrow();
  });
});
