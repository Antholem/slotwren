import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as confirmRoute } from "@/app/api/chat/[slug]/confirm/route";
import { GET as historyRoute, POST as chatRoute } from "@/app/api/chat/[slug]/route";
import { UNAVAILABLE_MESSAGE } from "@/lib/ai-guardrails";
import type { ChatHistory, ConfirmResponse, OfferedTime, ProposalCard } from "@/lib/chat";
import { nextDate, zonedParts } from "@/lib/time-off";
import type { ChatModel } from "@/server/ai/model";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The provider gives up (429) after the receptionist has already checked
 * times and proposed one: the customer sees the polite "not available" line,
 * but the Confirm card they were shown is real. After a refresh it's still in
 * the chat (the turn was saved as far as it got, with its usage), and tapping
 * Confirm books it, once.
 */

const model = vi.hoisted(() => ({ current: null as ChatModel | null }));
vi.mock("@/server/ai/model", () => ({ getChatModel: () => model.current }));

const ZONE = "Asia/Manila";
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;
type Prompt = Parameters<MockLanguageModelV4["doStream"]>[0]["prompt"];

const usage = {
  inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
};

/** The latest checkAvailability result in the prompt. */
function offered(prompt: Prompt): OfferedTime[] {
  for (const message of [...prompt].reverse()) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result" || part.toolName !== "checkAvailability") continue;
      const output = part.output as { type: string; value?: { times?: OfferedTime[] } };
      if (output.type === "json") return output.value?.times ?? [];
    }
  }
  return [];
}

const toolCall = (toolName: string, input: unknown): StreamPart[] => [
  { type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
  { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
];

describe("a provider error after a tool step", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  // Three days ahead in the business's timezone: past any notice, inside any horizon.
  const day = nextDate(zonedParts(new Date(), ZONE).date, 3);

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    const businessId = a.business.id;
    await db
      .update(schema.businesses)
      .set({ onboardedAt: new Date(), aiEnabled: true, plan: "pro" })
      .where(eq(schema.businesses.id, businessId));
    await db
      .insert(schema.staffServices)
      .values({ businessId, staffId: a.staff.id, serviceId: a.service.id });
    await db.insert(schema.availabilityRules).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        businessId,
        staffId: a.staff.id,
        weekday,
        startTime: "09:00",
        endTime: "18:00",
      })),
    );
  });

  afterAll(async () => {
    await a?.cleanup();
    await close();
  });

  it("keeps the Confirm card it showed: after a refresh it's there, and Confirm books it", async () => {
    let call = 0;
    const flaky = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        call++;
        if (call === 1) {
          return {
            stream: simulateReadableStream({
              chunks: toolCall("checkAvailability", { service: a.service.id, date: day }),
            }),
          };
        }
        if (call === 2) {
          const time = offered(prompt)[1]!;
          return {
            stream: simulateReadableStream({
              chunks: toolCall("proposeBooking", {
                service: a.service.id,
                startsAt: time.startsAt,
                name: "Lea Cruz",
                email: "lea@example.com",
              }),
            }),
          };
        }
        // The answer after the card: the provider is out of quota.
        throw new APICallError({
          message: "Resource has been exhausted (e.g. check quota).",
          url: "https://generativelanguage.googleapis.com/v1beta/models/x",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: false,
        });
      },
    });
    model.current = { model: flaky, provider: "gemini", modelId: "x", timeoutMs: 5_000 };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await chatRoute(
      new Request(`http://localhost/api/chat/${a.business.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.18.90.1" },
        body: JSON.stringify({ text: "Book me a haircut", timezone: ZONE }),
      }),
      { params: Promise.resolve({ slug: a.business.slug }) },
    );
    const conversationId = response.headers.get("x-conversation-id")!;
    const chunks = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
    vi.restoreAllMocks();

    // The customer saw the card, then the polite line (never the raw error).
    const shown = chunks.find(
      (c) =>
        c.type === "tool-output-available" &&
        (c.output as { status?: string } | undefined)?.status === "proposed",
    );
    expect(shown).toBeDefined();
    const card = (shown!.output as { card: ProposalCard }).card;
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: "error", errorText: UNAVAILABLE_MESSAGE }),
    );

    // Saved as far as it got, with its usage (two calls of 930 tokens).
    const rows = await db
      .select()
      .from(schema.aiMessages)
      .where(
        and(
          eq(schema.aiMessages.businessId, a.business.id),
          eq(schema.aiMessages.conversationId, conversationId),
          eq(schema.aiMessages.role, "assistant"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ interrupted: true, inputTokens: 1800, outputTokens: 60 });

    // After a refresh the card is still in the chat…
    const history = await historyRoute(
      new Request(`http://localhost/api/chat/${a.business.slug}?conversationId=${conversationId}`),
      { params: Promise.resolve({ slug: a.business.slug }) },
    );
    const restored = (await history.json()) as ChatHistory;
    const parts = restored.messages.flatMap((m) => m.parts) as {
      type: string;
      output?: { card?: ProposalCard };
    }[];
    expect(parts.find((p) => p.type === "tool-proposeBooking")?.output?.card?.proposalId).toBe(
      card.proposalId,
    );

    // …and Confirm books it, once.
    const confirmed = await confirmRoute(
      new Request(`http://localhost/api/chat/${a.business.slug}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.18.90.2" },
        body: JSON.stringify({ conversationId, proposalId: card.proposalId }),
      }),
      { params: Promise.resolve({ slug: a.business.slug }) },
    );
    const result = (await confirmed.json()) as ConfirmResponse;
    expect(confirmed.status).toBe(200);
    expect(result).toMatchObject({ ok: true, kind: "book" });
    const booked = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.businessId, a.business.id));
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ source: "ai", startsAt: new Date(card.startsAt) });
  });
});
