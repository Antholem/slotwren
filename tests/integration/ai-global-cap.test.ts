import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatModel } from "@/server/ai/model";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The shared daily cap (AI_DAILY_REQUEST_CAP) across every business: here 3,
 * set before the app's modules load. Two businesses share it; once it's
 * spent, both get the polite "not available" line and no model is called.
 */

vi.hoisted(() => {
  process.env.AI_DAILY_REQUEST_CAP = "3";
});
const model = vi.hoisted(() => ({ current: null as ChatModel | null }));
vi.mock("@/server/ai/model", () => ({ getChatModel: () => model.current }));

const { POST: chatRoute } = await import("@/app/api/chat/[slug]/route");
const { UNAVAILABLE_MESSAGE } = await import("@/lib/ai-guardrails");
const { mockReceptionistModel } = await import("@/server/ai/mock-model");

let ip = 0;
const say = (slug: string) =>
  chatRoute(
    new Request(`http://localhost/api/chat/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.18.40.${++ip}` },
      body: JSON.stringify({ text: "Hello" }),
    }),
    { params: Promise.resolve({ slug }) },
  );

describe("the shared daily AI cap", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    for (const f of [a, b]) {
      await db
        .update(schema.businesses)
        .set({ onboardedAt: new Date(), aiEnabled: true, plan: "pro" })
        .where(eq(schema.businesses.id, f.business.id));
    }
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await close();
  });

  it("counts messages across businesses and stops politely once spent", async () => {
    const mock = mockReceptionistModel();
    model.current = { model: mock, provider: "mock", modelId: "mock", timeoutMs: 5_000 };
    const statuses = [];
    for (const slug of [a.business.slug, b.business.slug, a.business.slug]) {
      const response = await say(slug);
      await response.text();
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200]);
    const calls = mock.doStreamCalls.length;

    const refused = await say(b.business.slug);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "ai_unavailable", message: UNAVAILABLE_MESSAGE });
    expect(mock.doStreamCalls).toHaveLength(calls); // no model call
    const [event] = await db
      .select()
      .from(schema.aiGuardrailEvents)
      .where(
        and(
          eq(schema.aiGuardrailEvents.businessId, b.business.id),
          eq(schema.aiGuardrailEvents.kind, "global_cap"),
        ),
      );
    expect(event).toBeDefined();
  });
});
