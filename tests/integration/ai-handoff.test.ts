import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as handoffRoute } from "@/app/api/chat/[slug]/handoff/route";
import { emailOwnersAboutHandoff } from "@/server/ai/handoff-notify";
import type * as Owners from "@/server/db/queries/system/owners";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * "Message the team" tells the owners: one email per question, after the
 * response, at most 5 an hour per business (the rest wait on the dashboard),
 * with the unverified address as Reply-To and said to be unverified. A new
 * customer created by the hand-off is linked to the chat; an existing one
 * never is (see ai-guardrails.test.ts).
 */

const sent = vi.hoisted(() => [] as { to: string[]; subject: string; replyTo?: string }[]);
vi.mock("@/server/email/send", () => ({
  sendEmail: async (email: { to: string[]; subject: string; replyTo?: string }) => {
    sent.push(email);
  },
}));
vi.mock("@/server/db/queries/system/owners", async (importOriginal) => ({
  ...(await importOriginal<typeof Owners>()),
  getOwnerEmails: async () => ["owner@example.com"],
}));

let ip = 0;
const nextIp = () => `198.18.70.${(ip++ % 250) + 1}`;

function handoff(slug: string, payload: Record<string, unknown>) {
  return handoffRoute(
    new Request(`http://localhost/api/chat/${slug}/handoff`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ slug }) },
  ).then(async (r) => ({ status: r.status, body: await r.json() }));
}

describe("hand-off: the owners hear about it", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ onboardedAt: new Date(), aiEnabled: true, plan: "pro" })
      .where(eq(schema.businesses.id, a.business.id));
  });

  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    await a?.cleanup();
    await close();
  });

  it("emails the owners, replying to the customer and saying the address isn't verified", async () => {
    const email = `noor-${randomUUID().slice(0, 6)}@example.com`;
    const result = await handoff(a.business.slug, {
      name: "Noor",
      email,
      message: "Do you sell gift cards?",
    });
    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    expect(sent).toEqual([
      expect.objectContaining({
        to: ["owner@example.com"],
        subject: "Question for the team from Noor",
        replyTo: email,
      }),
    ]);

    // A new customer, made by this hand-off: the chat is theirs.
    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.email, email));
    const [chat] = await db
      .select()
      .from(schema.aiConversations)
      .where(eq(schema.aiConversations.id, result.body.conversationId));
    expect(chat).toMatchObject({ customerId: customer!.id, visitorEmail: email });
  });

  it("at most 5 emails an hour per business; the questions are all saved", async () => {
    const notice = (n: number) => ({
      businessId: a.business.id,
      conversationId: randomUUID(),
      name: "Sam",
      email: `sam${n}@example.com`,
      message: `Question ${n}`,
      at: new Date(),
    });
    const other = await createFixtureBusiness(db);
    try {
      // The route already sent one for this business in the test above.
      const results = [];
      for (let n = 0; n < 5; n++) results.push(await emailOwnersAboutHandoff(notice(n)));
      expect(results).toEqual(["sent", "sent", "sent", "sent", "limited"]);
      // Another business has its own allowance.
      expect(await emailOwnersAboutHandoff({ ...notice(9), businessId: other.business.id })).toBe(
        "sent",
      );
    } finally {
      await other.cleanup();
    }
  });
});
