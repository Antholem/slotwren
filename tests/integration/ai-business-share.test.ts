import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatModel } from "@/server/ai/model";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * One business may use only its share of the shared daily model-call cap
 * (AI_BUSINESS_CALL_SHARE, a quarter by default): here a cap of 8, so 2 calls
 * each. A business that has spent its share gets the polite "not available"
 * line; the others carry on.
 */

vi.hoisted(() => {
  process.env.AI_DAILY_MODEL_CALL_CAP = "8";
  process.env.AI_BUSINESS_CALL_SHARE = "0.25";
});
const model = vi.hoisted(() => ({ current: null as ChatModel | null }));
vi.mock("@/server/ai/model", () => ({ getChatModel: () => model.current }));

const { POST: chatRoute } = await import("@/app/api/chat/[slug]/route");
const { UNAVAILABLE_MESSAGE } = await import("@/lib/ai-guardrails");
const { mockReceptionistModel } = await import("@/server/ai/mock-model");

let ip = 0;
async function say(slug: string, text: string) {
  const response = await chatRoute(
    new Request(`http://localhost/api/chat/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.18.41.${++ip}` },
      body: JSON.stringify({ text }),
    }),
    { params: Promise.resolve({ slug }) },
  );
  const status = response.status;
  if (status !== 200) return { status, body: await response.json() };
  await response.text();
  return { status };
}

describe("a business's share of the shared daily AI cap", () => {
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

  it("stops one business at a quarter of the cap; another carries on", async () => {
    model.current = {
      model: mockReceptionistModel(),
      provider: "mock",
      modelId: "mock",
      timeoutMs: 5_000,
    };
    expect(await say(a.business.slug, "Hello")).toEqual({ status: 200 });
    expect(await say(a.business.slug, "Hello again")).toEqual({ status: 200 });
    // A's share (2 of 8) is spent; the shared cap still has room.
    expect(await say(a.business.slug, "And again")).toEqual({
      status: 503,
      body: { error: "ai_unavailable", message: UNAVAILABLE_MESSAGE },
    });
    expect(await say(b.business.slug, "Hello")).toEqual({ status: 200 });

    const [event] = await db
      .select()
      .from(schema.aiGuardrailEvents)
      .where(eq(schema.aiGuardrailEvents.businessId, a.business.id));
    expect(event).toMatchObject({ kind: "global_cap", detail: { limit: "ai:calls:business" } });
  });
});
