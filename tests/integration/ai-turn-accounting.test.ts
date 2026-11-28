import { randomUUID } from "node:crypto";

import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as historyRoute, POST as chatRoute } from "@/app/api/chat/[slug]/route";
import { env } from "@/env";
import {
  CONVERSATION_LIMIT_MESSAGE,
  CONVERSATION_TOKEN_LIMIT,
  RESTING_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from "@/lib/ai-guardrails";
import type { ChatHistory } from "@/lib/chat";
import { releaseTokens, reserveTokens } from "@/server/ai/guardrails";
import { mockReceptionistModel } from "@/server/ai/mock-model";
import type { ChatModel } from "@/server/ai/model";
import * as schema from "@/server/db/schema";
import { RATE_LIMIT_MESSAGES } from "@/server/rate-limit";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * What a turn costs is always recorded, and what it produced survives:
 * - a reply cut short (here a timeout after a tool step) is saved as far as it
 *   got, with its usage, marked interrupted; Retry carries on without saving
 *   the message twice;
 * - a reply that produced nothing still counts its tokens;
 * - each call's estimate is reserved first, so parallel messages can't all
 *   pass a budget with room for one; a conversation has its own token limit;
 * - per IP: new chats a day and messages a day, however they're split;
 * - on Vercel Production without Upstash the chat stays off.
 */

const model = vi.hoisted(() => ({ current: null as ChatModel | null }));
vi.mock("@/server/ai/model", () => ({ getChatModel: () => model.current }));

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

const toolCall = (input: number, output: number): StreamPart[] => [
  { type: "tool-call", toolCallId: `call-${randomUUID()}`, toolName: "listServices", input: "{}" },
  {
    type: "finish",
    finishReason: { unified: "tool-calls", raw: undefined },
    usage: usage(input, output),
  },
];

const reply = (text: string, input = 0, output = 0): StreamPart[] => [
  ...(text
    ? ([
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
      ] as StreamPart[])
    : []),
  {
    type: "finish",
    finishReason: { unified: "stop", raw: undefined },
    usage: usage(input, output),
  },
];

/** A model that plays `moves` in order, one per call: parts, or "stall" (never answers). */
function scripted(moves: (StreamPart[] | "stall")[]) {
  let i = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const move = moves[Math.min(i++, moves.length - 1)]!;
      if (move === "stall") return { stream: new ReadableStream<StreamPart>() };
      return { stream: simulateReadableStream({ chunks: move }) };
    },
  });
}

const use = (m: MockLanguageModelV4, timeoutMs = 5_000) => {
  model.current = { model: m, provider: "mock", modelId: "mock", timeoutMs };
  return m;
};

let ipCounter = 0;
const nextIp = () => `198.18.60.${(ipCounter++ % 250) + 1}`;

async function say(
  slug: string,
  text: string,
  { conversationId, ip = nextIp() }: { conversationId?: string; ip?: string } = {},
) {
  const response = await chatRoute(
    new Request(`http://localhost/api/chat/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ text, conversationId }),
    }),
    { params: Promise.resolve({ slug }) },
  );
  const id = response.headers.get("x-conversation-id") ?? undefined;
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return { status: response.status, body: await response.json(), conversationId: id, chunks: [] };
  }
  const chunks = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  return { status: response.status, body: null, conversationId: id, chunks };
}

describe("AI turn accounting and per-visitor limits", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;

  const rows = (conversationId: string) =>
    db
      .select()
      .from(schema.aiMessages)
      .where(
        and(
          eq(schema.aiMessages.businessId, a.business.id),
          eq(schema.aiMessages.conversationId, conversationId),
        ),
      )
      .orderBy(schema.aiMessages.createdAt);

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ onboardedAt: new Date(), aiEnabled: true, plan: "pro" })
      .where(eq(schema.businesses.id, a.business.id));
    await db
      .insert(schema.staffServices)
      .values({ businessId: a.business.id, staffId: a.staff.id, serviceId: a.service.id });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await a?.cleanup();
    await close();
  });

  it("a reply cut short after a tool step keeps that step and its usage; Retry carries on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    use(scripted([toolCall(120, 8), "stall"]), 1_000);
    const cut = await say(a.business.slug, "What do you offer?");
    expect(cut.status).toBe(200);
    expect(cut.chunks).toContainEqual(expect.objectContaining({ type: "error" }));
    const conversationId = cut.conversationId!;

    const saved = await rows(conversationId);
    expect(saved.map((r) => [r.role, r.interrupted])).toEqual([
      ["user", false],
      ["assistant", true],
    ]);
    expect(saved[1]).toMatchObject({ inputTokens: 120, outputTokens: 8 });
    expect(JSON.stringify(saved[1]!.parts)).toContain("listServices");

    // After a refresh, the tool result is still there.
    const history = await historyRoute(
      new Request(`http://localhost/api/chat/${a.business.slug}?conversationId=${conversationId}`),
      { params: Promise.resolve({ slug: a.business.slug }) },
    );
    const body = (await history.json()) as ChatHistory;
    expect(body.messages.at(-1)!.parts).toContainEqual(
      expect.objectContaining({ type: "tool-listServices", state: "output-available" }),
    );

    // Retry: the same message isn't saved again, and the reply follows the cut one.
    use(scripted([reply("We do haircuts.", 50, 5)]));
    const again = await say(a.business.slug, "What do you offer?", { conversationId });
    expect(again.status).toBe(200);
    const after = await rows(conversationId);
    expect(after.map((r) => [r.role, r.interrupted])).toEqual([
      ["user", false],
      ["assistant", true],
      ["assistant", false],
    ]);
    expect(after[2]).toMatchObject({ content: "We do haircuts.", inputTokens: 50 });
  });

  it("a reply that produced nothing still counts its tokens, and shows nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    use(scripted([reply("", 300, 0)]));
    const turn = await say(a.business.slug, "Hello");
    const saved = await rows(turn.conversationId!);
    expect(saved.map((r) => [r.role, r.inputTokens])).toEqual([
      ["user", null],
      ["system", 300],
    ]);
    const history = await historyRoute(
      new Request(
        `http://localhost/api/chat/${a.business.slug}?conversationId=${turn.conversationId}`,
      ),
      { params: Promise.resolve({ slug: a.business.slug }) },
    );
    const body = (await history.json()) as ChatHistory;
    expect(body.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("a conversation over its token limit asks for a new chat, before any model call", async () => {
    const [row] = await db
      .insert(schema.aiConversations)
      .values({ businessId: a.business.id, channel: "page" })
      .returning();
    await db.insert(schema.aiMessages).values([
      { businessId: a.business.id, conversationId: row!.id, role: "user", content: "Hi" },
      {
        businessId: a.business.id,
        conversationId: row!.id,
        role: "assistant",
        content: "Hello",
        inputTokens: CONVERSATION_TOKEN_LIMIT,
        outputTokens: 0,
      },
    ]);
    const m = use(mockReceptionistModel());
    const turn = await say(a.business.slug, "One more thing", { conversationId: row!.id });
    expect(turn).toMatchObject({
      status: 422,
      body: { error: "conversation_limit", message: CONVERSATION_LIMIT_MESSAGE },
    });
    expect(m.doStreamCalls).toHaveLength(0);
  });

  it("reserves each call's estimate: parallel calls can't all pass a budget with room for one", async () => {
    const businessId = randomUUID();
    const budget = { used: 0, budget: 1_000 };
    const results = await Promise.all([1, 2, 3].map(() => reserveTokens(businessId, 600, budget)));
    expect(results.sort()).toEqual(["over_budget", "over_budget", "reserved"]);
    await releaseTokens(businessId, 600);
    expect(await reserveTokens(businessId, 600, budget)).toBe("reserved");
    await releaseTokens(businessId, 600);

    // Through the route: a budget too small for one message's estimate rests, no model call.
    await db
      .update(schema.businesses)
      .set({ aiMonthlyTokenBudget: 1_000 })
      .where(eq(schema.businesses.id, a.business.id));
    const m = use(mockReceptionistModel());
    const turn = await say(a.business.slug, "Hello");
    expect(turn).toMatchObject({
      status: 503,
      body: { error: "ai_resting", message: RESTING_MESSAGE },
    });
    expect(m.doStreamCalls).toHaveLength(0);
    await db
      .update(schema.businesses)
      .set({ aiMonthlyTokenBudget: 500_000 })
      .where(eq(schema.businesses.id, a.business.id));
  });

  it("an IP may start 15 chats a day; carrying on in one still works", async () => {
    use(mockReceptionistModel());
    const ip = "203.0.113.150";
    let last: string | undefined;
    for (let i = 0; i < 15; i++) {
      const turn = await say(a.business.slug, `Hello ${i}`, { ip });
      expect(turn.status).toBe(200);
      last = turn.conversationId;
    }
    expect(await say(a.business.slug, "Hello again", { ip })).toMatchObject({
      status: 429,
      body: { error: "rate_limited", message: RATE_LIMIT_MESSAGES["chat:conversations:ip"] },
    });
    expect((await say(a.business.slug, "Still here", { ip, conversationId: last })).status).toBe(
      200,
    );
  });

  it("an IP may send 40 messages a day, however it spaces or splits them", async () => {
    use(mockReceptionistModel());
    const ip = "203.0.113.151";
    // Only the clock is faked: a minute passes after every 20 (the per-minute limit).
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    for (let chat = 0; chat < 2; chat++) {
      let conversationId: string | undefined;
      for (let i = 0; i < 20; i++) {
        const turn = await say(a.business.slug, `Question ${chat}-${i}`, { ip, conversationId });
        expect(turn.status).toBe(200);
        conversationId = turn.conversationId;
      }
      vi.setSystemTime(Date.now() + 61_000);
    }
    expect(await say(a.business.slug, "One more", { ip })).toMatchObject({
      status: 429,
      body: { error: "rate_limited", message: RATE_LIMIT_MESSAGES["chat:ip:day"] },
    });
  });

  it("on Vercel Production without Upstash, the chat stays off politely", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = use(mockReceptionistModel());
    const was = env.VERCEL_ENV;
    (env as { VERCEL_ENV?: string }).VERCEL_ENV = "production";
    try {
      expect(await say(a.business.slug, "Hello")).toMatchObject({
        status: 503,
        body: { error: "ai_unavailable", message: UNAVAILABLE_MESSAGE },
      });
    } finally {
      (env as { VERCEL_ENV?: string }).VERCEL_ENV = was;
    }
    expect(m.doStreamCalls).toHaveLength(0);
  });
});
