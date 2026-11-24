import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as confirmRoute } from "@/app/api/chat/[slug]/confirm/route";
import { POST as handoffRoute } from "@/app/api/chat/[slug]/handoff/route";
import { GET as historyRoute, POST as chatRoute } from "@/app/api/chat/[slug]/route";
import type {
  ChatHistory,
  ConfirmResponse,
  HandoffResponse,
  OfferedTime,
  ProposalCard,
} from "@/lib/chat";
import { mockReceptionistModel } from "@/server/ai/mock-model";
import type { ChatModel } from "@/server/ai/model";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * What the chat UI (step 4.4) relies on, end to end with the mock AI provider
 * (AI_PROVIDER=mock's scripted model, never a real key): the conversation id
 * header, history after a refresh, Retry without a duplicate turn, a Confirm
 * card that collects the name and email, and the hand-off to the team.
 */

const model = vi.hoisted(() => ({ current: null as ChatModel | null }));
vi.mock("@/server/ai/model", () => ({ getChatModel: () => model.current }));

let ip = 0;
const headers = () => ({
  "content-type": "application/json",
  "x-forwarded-for": `192.0.2.${(ip++ % 250) + 1}`,
});

const call = <T>(
  route: (r: Request, c: { params: Promise<{ slug: string }> }) => Promise<Response>,
  slug: string,
  path: string,
  init: RequestInit,
) =>
  route(new Request(`http://localhost/api/chat/${slug}${path}`, init), {
    params: Promise.resolve({ slug }),
  }).then(async (response) => ({
    response,
    status: response.status,
    body: (await response
      .clone()
      .json()
      .catch(() => null)) as T,
  }));

async function say(slug: string, text: string, conversationId?: string) {
  const response = await chatRoute(
    new Request(`http://localhost/api/chat/${slug}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ text, conversationId, timezone: "Asia/Manila" }),
    }),
    { params: Promise.resolve({ slug }) },
  );
  const raw = await response.text();
  const chunks = raw
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  return {
    response,
    conversationId: response.headers.get("x-conversation-id")!,
    chunks,
    outputs: chunks
      .filter((c) => c.type === "tool-output-available")
      .map((c) => c.output as Record<string, unknown>),
  };
}

describe("chat UI routes, with the mock AI provider", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;

  async function makeLive(fixture: typeof a) {
    const businessId = fixture.business.id;
    await db
      .update(schema.businesses)
      .set({ onboardedAt: new Date(), aiEnabled: true, plan: "pro", minNoticeMin: 0 })
      .where(eq(schema.businesses.id, businessId));
    await db
      .insert(schema.staffServices)
      .values({ businessId, staffId: fixture.staff.id, serviceId: fixture.service.id });
    await db.insert(schema.availabilityRules).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        businessId,
        staffId: fixture.staff.id,
        weekday,
        startTime: "09:00",
        endTime: "18:00",
      })),
    );
  }

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    await makeLive(a);
    await makeLive(b);
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await close();
  });

  beforeEach(() => {
    model.current = {
      model: mockReceptionistModel(),
      provider: "mock",
      modelId: "mock-receptionist",
      timeoutMs: 2_000,
    };
  });

  /** Ask for a haircut, then pick the first chip: a proposal without name or email. */
  async function proposal() {
    const first = await say(a.business.slug, "Book a haircut");
    const times = (first.outputs[0]!.times as OfferedTime[]) ?? [];
    expect(times.length).toBeGreaterThan(0);
    const t = times[0]!;
    const second = await say(
      a.business.slug,
      `${t.day}, ${t.time} with ${t.staff}, please`,
      first.conversationId,
    );
    const output = second.outputs[0]!;
    expect(output.status).toBe("proposed");
    return { conversationId: first.conversationId, card: output.card as ProposalCard };
  }

  it("names the conversation in a header and streams the mock's tool calls", async () => {
    const turn = await say(a.business.slug, "Book a haircut");
    expect(turn.response.status).toBe(200);
    expect(turn.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(turn.outputs[0]).toMatchObject({ status: "ok", service: { name: "Haircut" } });
  });

  it("a proposal from a chip has no name or email yet; the card collects them", async () => {
    const { conversationId, card } = await proposal();
    expect(card.customer).toEqual({ name: null, email: null, phone: null });
    expect(card).toMatchObject({ day: expect.any(String), time: expect.stringMatching(/–/) });
    const confirm = (customer?: unknown) =>
      call<ConfirmResponse>(confirmRoute, a.business.slug, "/confirm", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ conversationId, proposalId: card.proposalId, customer }),
      });

    // Without details: refused, and the proposal is still usable.
    expect(await confirm()).toMatchObject({
      status: 400,
      body: { ok: false, error: "bad_request", message: "Add your name and email to book." },
    });
    expect(await confirm({ name: "Lea", email: "not-an-email" })).toMatchObject({
      status: 400,
      body: { ok: false, message: "Enter a valid email address." },
    });
    const done = await confirm({ name: "Lea Cruz", email: "lea.card@example.com" });
    expect(done.status).toBe(200);
    if (!done.body.ok) throw new Error(done.body.message);
    expect(done.body.card).toMatchObject({
      kind: "book",
      code: done.body.code,
      email: "lea.card@example.com",
      icsPath: `/b/${a.business.slug}/booked/${done.body.bookingId}/event.ics`,
      googleCalendarUrl: expect.stringContaining("calendar.google.com"),
      freeUntil: expect.stringMatching(/\(GMT\+8\)$/),
    });
    const [booking] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, done.body.bookingId));
    expect(booking).toMatchObject({ source: "ai", customerName: "Lea Cruz" });
    const [stored] = await db
      .select()
      .from(schema.aiProposals)
      .where(eq(schema.aiProposals.id, card.proposalId));
    expect(stored).toMatchObject({
      state: "confirmed",
      customerName: "Lea Cruz",
      customerEmail: "lea.card@example.com",
    });
  });

  it("history after a refresh: the same conversation, cards and confirmation included", async () => {
    const { conversationId, card } = await proposal();
    await call<ConfirmResponse>(confirmRoute, a.business.slug, "/confirm", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        conversationId,
        proposalId: card.proposalId,
        customer: { name: "Rosa", email: "rosa.history@example.com" },
      }),
    });
    const history = await call<ChatHistory>(
      historyRoute,
      a.business.slug,
      `?conversationId=${conversationId}`,
      { headers: headers() },
    );
    expect(history.status).toBe(200);
    const parts = history.body.messages.flatMap((m) => m.parts.map((p) => p.type));
    expect(parts).toEqual(
      expect.arrayContaining([
        "text",
        "tool-checkAvailability",
        "tool-proposeBooking",
        "data-confirmation",
      ]),
    );
    expect(history.body.messages[0]).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "Book a haircut" }],
    });
    const confirmation = history.body.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "data-confirmation");
    expect(confirmation).toMatchObject({
      data: { proposalId: card.proposalId, confirmed: true, card: { kind: "book" } },
    });
    // The id is all it takes, and only on this business's page.
    expect(
      (
        await call(historyRoute, b.business.slug, `?conversationId=${conversationId}`, {
          headers: headers(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(historyRoute, a.business.slug, `?conversationId=${randomUUID()}`, {
          headers: headers(),
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(historyRoute, a.business.slug, `?conversationId=nope`, { headers: headers() }))
        .status,
    ).toBe(404);
  });

  it("Retry after a failed reply doesn't store the message twice", async () => {
    const text = `Hello [fail] ${randomUUID()}`;
    const failed = await say(a.business.slug, text);
    expect(failed.chunks.some((c) => c.type === "error")).toBe(true);
    const retried = await say(a.business.slug, text, failed.conversationId);
    expect(retried.chunks.some((c) => c.type === "error")).toBe(false);
    const turns = await db
      .select({ role: schema.aiMessages.role, content: schema.aiMessages.content })
      .from(schema.aiMessages)
      .where(eq(schema.aiMessages.conversationId, failed.conversationId));
    expect(turns.filter((t) => t.role === "user")).toEqual([{ role: "user", content: text }]);
    expect(turns.filter((t) => t.role === "assistant")).toHaveLength(1);
  });

  it("a stalled reply times out into an error, then Retry answers", async () => {
    const text = `Hello [stall] ${randomUUID()}`;
    const stalled = await say(a.business.slug, text);
    expect(stalled.chunks.some((c) => c.type === "error")).toBe(true);
    const retried = await say(a.business.slug, text, stalled.conversationId);
    expect(retried.chunks.some((c) => c.type === "text-delta")).toBe(true);
  });

  describe("hand-off", () => {
    const handoff = (slug: string, payload: Record<string, unknown>) =>
      call<HandoffResponse>(handoffRoute, slug, "/handoff", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
      });

    it("offers the form, then saves an open question on the customer's profile", async () => {
      const turn = await say(a.business.slug, "Is there parking nearby?");
      expect(turn.outputs).toEqual([
        expect.objectContaining({ status: "handoff", question: "Is there parking nearby?" }),
      ]);
      const sent = await handoff(a.business.slug, {
        conversationId: turn.conversationId,
        name: "Ana Santos",
        email: a.customer.email.toUpperCase(),
        message: "Is there parking nearby?",
      });
      expect(sent).toMatchObject({ status: 200, body: { ok: true } });

      const [question] = await db
        .select()
        .from(schema.handoffRequests)
        .where(eq(schema.handoffRequests.conversationId, turn.conversationId));
      // Matched to the existing customer by email (case aside), who is unchanged.
      expect(question).toMatchObject({
        businessId: a.business.id,
        customerId: a.customer.id,
        status: "open",
        message: "Is there parking nearby?",
      });
      const [customer] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, a.customer.id));
      expect(customer!.name).toBe("Ana Santos");
      const [conversation] = await db
        .select()
        .from(schema.aiConversations)
        .where(eq(schema.aiConversations.id, turn.conversationId));
      expect(conversation!.outcome).toBe("handed_off");
    });

    it("creates the customer when the email is new", async () => {
      const turn = await say(a.business.slug, "Do you do tattoos?");
      const email = `new-${randomUUID().slice(0, 8)}@example.com`;
      expect(
        (
          await handoff(a.business.slug, {
            conversationId: turn.conversationId,
            name: "Noor",
            email,
            message: "Do you do tattoos?",
          })
        ).status,
      ).toBe(200);
      const [customer] = await db
        .select()
        .from(schema.customers)
        .where(
          and(eq(schema.customers.businessId, a.business.id), eq(schema.customers.email, email)),
        );
      expect(customer).toMatchObject({ name: "Noor" });
    });

    it("refuses another business's conversation and bad input", async () => {
      const turn = await say(a.business.slug, "Is there parking?");
      expect(
        (
          await handoff(b.business.slug, {
            conversationId: turn.conversationId,
            name: "Mallory",
            email: "m@example.com",
            message: "Hi",
          })
        ).status,
      ).toBe(404);
      expect(
        await handoff(a.business.slug, {
          conversationId: turn.conversationId,
          name: "Ana",
          email: "nope",
          message: "Hi",
        }),
      ).toMatchObject({
        status: 400,
        body: { ok: false, message: "Enter a valid email address." },
      });
      const saved = await db
        .select()
        .from(schema.handoffRequests)
        .where(eq(schema.handoffRequests.conversationId, turn.conversationId));
      expect(saved).toHaveLength(0);
    });
  });
});
