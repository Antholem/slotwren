import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatModel } from "@/server/ai/model";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The shared daily cap (AI_DAILY_MODEL_CALL_CAP) counts model calls, not
 * messages, across every business: here 4, set before the app's modules load.
 * A turn that reaches it between tool steps ends politely; after that, chats
 * get the "not available" line and no model is called.
 */

vi.hoisted(() => {
  process.env.AI_DAILY_MODEL_CALL_CAP = "4";
});
const model = vi.hoisted(() => ({ current: null as ChatModel | null }));
vi.mock("@/server/ai/model", () => ({ getChatModel: () => model.current }));

const { POST: chatRoute } = await import("@/app/api/chat/[slug]/route");
const { CAPPED_MESSAGE, UNAVAILABLE_MESSAGE } = await import("@/lib/ai-guardrails");
const { mockReceptionistModel } = await import("@/server/ai/mock-model");

let ip = 0;
async function say(slug: string, text: string) {
  const response = await chatRoute(
    new Request(`http://localhost/api/chat/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.18.40.${++ip}` },
      body: JSON.stringify({ text }),
    }),
    { params: Promise.resolve({ slug }) },
  );
  if (response.status !== 200) return { status: response.status, body: await response.json() };
  const chunks = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  return {
    status: 200,
    tools: chunks.filter((c) => c.type === "tool-input-available").length,
    text: chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta)
      .join(""),
  };
}

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
      // Bookable, so the mock has a service to check.
      await db.insert(schema.staffServices).values({
        businessId: f.business.id,
        staffId: f.staff.id,
        serviceId: f.service.id,
      });
      await db.insert(schema.availabilityRules).values(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          businessId: f.business.id,
          staffId: f.staff.id,
          weekday,
          startTime: "09:00",
          endTime: "18:00",
        })),
      );
    }
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await close();
  });

  it("counts model calls across businesses, stops mid-turn politely, then refuses", async () => {
    const mock = mockReceptionistModel();
    model.current = { model: mock, provider: "mock", modelId: "mock", timeoutMs: 5_000 };

    // 1 call: a plain answer.
    expect(await say(a.business.slug, "Hello")).toMatchObject({ status: 200, tools: 0 });
    // 2 calls: a tool, then the answer (3 of 4 used).
    expect(await say(b.business.slug, "Book a haircut")).toMatchObject({ status: 200, tools: 1 });
    expect(mock.doStreamCalls).toHaveLength(3);

    // The 4th call is the tool step; the answer would be the 5th: stopped, politely.
    const cut = await say(a.business.slug, "Book a haircut");
    expect(cut).toMatchObject({ status: 200, tools: 1 });
    expect(cut.text).toBe(CAPPED_MESSAGE);
    expect(mock.doStreamCalls).toHaveLength(4);
    const [reply] = await db
      .select({ content: schema.aiMessages.content })
      .from(schema.aiMessages)
      .where(
        and(
          eq(schema.aiMessages.businessId, a.business.id),
          eq(schema.aiMessages.role, "assistant"),
          eq(schema.aiMessages.content, CAPPED_MESSAGE),
        ),
      );
    expect(reply).toBeDefined();

    // Spent: refused before any model call.
    const refused = await say(b.business.slug, "Hello");
    expect(refused).toEqual({
      status: 503,
      body: { error: "ai_unavailable", message: UNAVAILABLE_MESSAGE },
    });
    expect(mock.doStreamCalls).toHaveLength(4);
    const recorded = await db
      .select()
      .from(schema.aiGuardrailEvents)
      .where(eq(schema.aiGuardrailEvents.kind, "global_cap"));
    expect(recorded.map((e) => e.businessId)).toEqual(
      expect.arrayContaining([a.business.id, b.business.id]),
    );
  });
});
