import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withRls } from "@/server/db/client";
import { hasAnyMembership } from "@/server/db/queries/memberships";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

// The proxy's "has a business?" check (→ /app, else → /onboarding).
describe("hasAnyMembership", () => {
  const { db, close } = connectTestDb();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  let fixture: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: { sub: string };
  let newcomer: { sub: string };

  async function createUser(label: string) {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    return { sub: data.user.id };
  }

  beforeAll(async () => {
    fixture = await createFixtureBusiness(db);
    owner = await createUser("owner");
    newcomer = await createUser("newcomer");
    await db
      .insert(schema.memberships)
      .values({ businessId: fixture.business.id, userId: owner.sub, role: "owner" });
  });

  afterAll(async () => {
    await fixture?.cleanup();
    for (const user of [owner, newcomer]) {
      if (user) await admin.auth.admin.deleteUser(user.sub);
    }
    await close();
  });

  it("is true for a member of a business", async () => {
    expect(await hasAnyMembership(owner)).toBe(true);
  });

  it("is false for a signed-in user with no business yet", async () => {
    expect(await hasAnyMembership(newcomer)).toBe(false);
  });

  it("RLS shows a user only their own memberships, even without a filter", async () => {
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
