import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as historyRoute, POST as chatRoute } from "@/app/api/chat/[slug]/route";
import { CHAT_OFF_MESSAGE } from "@/lib/chat";
import {
  classifyOutcome,
  parseTranscriptFilters,
  type TranscriptFilters,
} from "@/lib/ai-transcripts";
import { todayIn } from "@/lib/time-off";
import { purgeExpiredTranscripts } from "@/server/ai/retention";
import { buildTranscriptItems } from "@/server/ai/transcript-view";
import {
  answerQuestion,
  FAQ_LIMITS,
  orderFaqs,
  removeFaq,
  saveFaq,
  switchAi,
} from "@/server/catalog/ai";
import type { RlsClaims } from "@/server/db/client";
import { getAiUsage, getTranscript, listFaqs, listTranscripts } from "@/server/db/queries/ai";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import * as schema from "@/server/db/schema";

import { testUsers } from "../support/auth";
import { bookingValues, connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * The AI receptionist page (step 4.5) as members see it, through RLS:
 * outcome classification, filters, search and paging; one transcript; usage;
 * the FAQ editor; the on/off switch; answering questions; and the 90-day
 * transcript retention job.
 */

const ZONE = "Asia/Manila";
const DAY = 86_400_000;

describe("AI receptionist dashboard", () => {
  const { db, close } = connectTestDb();
  const users = testUsers();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let b: Awaited<ReturnType<typeof createFixtureBusiness>>;
  let owner: RlsClaims;
  let staffer: RlsClaims;
  let ownerB: RlsClaims;
  const ids: Record<string, string> = {};
  let bookedCode = "";

  const ownerActor = () => ({ claims: owner, businessId: a.business.id, role: "owner" as const });
  const staffActor = () => ({ claims: staffer, businessId: a.business.id, role: "staff" as const });
  const today = () => todayIn(ZONE, new Date());
  const filters = (params: Record<string, string> = {}): TranscriptFilters =>
    parseTranscriptFilters({ range: "all", ...params });
  const list = (claims: RlsClaims, f: TranscriptFilters, limit = 50, offset = 0) =>
    listTranscripts(claims, a.business.id, f, { zone: ZONE, today: today(), limit, offset });

  /** A conversation started `daysAgo` with these turns (role, content, parts). */
  async function conversation(
    fixture: typeof a,
    label: string,
    turns: { role: "user" | "assistant"; content: string; parts?: unknown[]; tokens?: number }[],
    { daysAgo = 0, visitorName = null }: { daysAgo?: number; visitorName?: string | null } = {},
  ) {
    const at = new Date(Date.now() - daysAgo * DAY);
    const [row] = await db
      .insert(schema.aiConversations)
      .values({
        businessId: fixture.business.id,
        channel: "page",
        visitorName,
        startedAt: at,
        lastMessageAt: at,
      })
      .returning();
    for (const [i, turn] of turns.entries()) {
      await db.insert(schema.aiMessages).values({
        businessId: fixture.business.id,
        conversationId: row!.id,
        role: turn.role,
        content: turn.content,
        parts: turn.parts ?? [{ type: "text", text: turn.content }],
        inputTokens: turn.tokens ?? null,
        outputTokens: turn.tokens ? 10 : null,
        createdAt: new Date(at.getTime() + i * 1000),
      });
    }
    ids[label] = row!.id;
    return row!.id;
  }

  const confirmation = (
    kind: "book" | "reschedule" | "cancel",
    code: string,
    bookingId?: string,
  ) => ({
    role: "assistant" as const,
    content: `Confirmed ${code}`,
    parts: [
      { type: "text", text: `Confirmed ${code}` },
      {
        type: "data-confirmation",
        data: {
          proposalId: randomUUID(),
          kind,
          confirmed: true,
          card: {
            kind,
            code,
            bookingId: bookingId ?? null,
            day: "Sat 28 Nov",
            time: "10:00 – 10:45",
          },
        },
      },
    ],
  });

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    b = await createFixtureBusiness(db);
    [owner, staffer, ownerB] = await Promise.all([
      users.create("ai-owner"),
      users.create("ai-staff"),
      users.create("ai-owner-b"),
    ]);
    await db.insert(schema.memberships).values([
      { businessId: a.business.id, userId: owner.sub, role: "owner" },
      { businessId: a.business.id, userId: staffer.sub, role: "staff" },
      { businessId: b.business.id, userId: ownerB.sub, role: "owner" },
    ]);
    await db
      .update(schema.businesses)
      .set({ onboardedAt: new Date(), aiEnabled: true, plan: "pro" })
      .where(eq(schema.businesses.id, a.business.id));

    // Booked: the chat made a booking (and also asked the team something).
    const bookedId = await conversation(a, "booked", [
      { role: "user", content: "Anything Saturday?", tokens: 300 },
      { role: "assistant", content: "Here are the times.", tokens: 200 },
    ]);
    const [booking] = await db
      .insert(schema.bookings)
      .values(
        bookingValues(a, new Date(Date.now() + 3 * DAY), {
          source: "ai",
          aiConversationId: bookedId,
        }),
      )
      .returning();
    bookedCode = booking!.code;
    await db.insert(schema.aiMessages).values({
      businessId: a.business.id,
      conversationId: bookedId,
      role: "assistant",
      content: `Booked ${bookedCode}`,
      parts: confirmation("book", bookedCode, booking!.id).parts,
      createdAt: new Date(Date.now() + 5000),
    });
    await db.insert(schema.handoffRequests).values({
      businessId: a.business.id,
      conversationId: bookedId,
      name: "Ana",
      email: a.customer.email,
      message: "Can I bring my own dye?",
    });

    await conversation(a, "moved", [
      { role: "user", content: "Move my booking please" },
      confirmation("reschedule", "SW-MOVE-01"),
    ]);
    await conversation(a, "cancelled", [
      { role: "user", content: "Cancel it please" },
      confirmation("cancel", "SW-CANC-01"),
    ]);
    const handedId = await conversation(
      a,
      "handed",
      [{ role: "user", content: "Is there parking?" }],
      { visitorName: "Liam Ortiz" },
    );
    await db.insert(schema.handoffRequests).values({
      businessId: a.business.id,
      conversationId: handedId,
      customerId: a.customer.id,
      name: "Liam Ortiz",
      email: "liam@example.com",
      message: "Is there parking?",
    });
    await conversation(a, "nothing", [
      { role: "user", content: "How much is a haircut?" },
      { role: "assistant", content: "$35." },
    ]);
    await conversation(a, "old", [{ role: "user", content: "Old question" }], { daysAgo: 40 });
    await conversation(a, "expired", [{ role: "user", content: "Ancient question" }], {
      daysAgo: 95,
    });
    await conversation(b, "other", [{ role: "user", content: "B-only secret question" }]);
  });

  afterAll(async () => {
    await a?.cleanup();
    await b?.cleanup();
    await users.cleanup?.();
    await close();
  });

  it("classifies outcomes: booked beats a move, a cancellation and a hand-off", async () => {
    expect(
      classifyOutcome({ booked: true, rescheduled: true, cancelled: true, handedOff: true }),
    ).toBe("booked");
    expect(
      classifyOutcome({ booked: false, rescheduled: false, cancelled: true, handedOff: true }),
    ).toBe("cancelled");
    expect(
      classifyOutcome({ booked: false, rescheduled: false, cancelled: false, handedOff: false }),
    ).toBe("none");

    const { rows } = await list(owner, filters());
    const outcome = (label: string) => rows.find((r) => r.id === ids[label])?.outcome;
    expect(outcome("booked")).toBe("booked");
    expect(outcome("moved")).toBe("rescheduled");
    expect(outcome("cancelled")).toBe("cancelled");
    expect(outcome("handed")).toBe("handed_off");
    expect(outcome("nothing")).toBe("none");
  });

  it("lists first question, customer, message count and open questions; newest first", async () => {
    const { rows, total } = await list(owner, filters());
    expect(total).toBe(7); // B's never shows
    const booked = rows.find((r) => r.id === ids.booked)!;
    expect(booked).toMatchObject({
      firstQuestion: "Anything Saturday?",
      customerName: "Ana Santos", // the booking's customer
      customerId: a.customer.id,
      messageCount: 3,
      openQuestion: true,
    });
    expect(rows.find((r) => r.id === ids.handed)).toMatchObject({
      customerName: "Liam Ortiz", // the visitor's name from the hand-off
      openQuestion: true,
    });
    const started = rows.map((r) => r.startedAt.getTime());
    expect([...started].sort((x, y) => y - x)).toEqual(started);
    expect(JSON.stringify(rows)).not.toContain("B-only");
  });

  it("filters by outcome and date range", async () => {
    const outcomes = async (params: Record<string, string>) =>
      (await list(owner, filters(params))).rows.map((r) => r.id);
    expect(await outcomes({ outcome: "booked" })).toEqual([ids.booked]);
    expect(await outcomes({ outcome: "rescheduled" })).toEqual([ids.moved]);
    expect(await outcomes({ outcome: "handed_off" })).toEqual([ids.handed]);
    expect((await outcomes({ outcome: "none" })).sort()).toEqual(
      [ids.nothing, ids.old, ids.expired].sort(),
    );
    const past30 = await outcomes({ range: "past30" });
    expect(past30).not.toContain(ids.old);
    expect(past30).toContain(ids.nothing);
    expect(await outcomes({ range: "today", outcome: "none" })).toEqual([ids.nothing]);
    const fortyDaysAgo = todayIn(ZONE, new Date(Date.now() - 40 * DAY));
    expect(await outcomes({ range: "custom", from: fortyDaysAgo, to: fortyDaysAgo })).toEqual([
      ids.old,
    ]);
  });

  it("searches by customer, hand-off email and booking code", async () => {
    const found = async (q: string) => (await list(owner, filters({ q }))).rows.map((r) => r.id);
    expect(await found(bookedCode.toLowerCase())).toEqual([ids.booked]);
    expect(await found("liam@ex")).toEqual([ids.handed]);
    expect(await found("Ortiz")).toEqual([ids.handed]);
    expect(await found("ana santos")).toEqual(expect.arrayContaining([ids.booked]));
    expect(await found("nobody-at-all")).toEqual([]);
    expect(await found("100%_")).toEqual([]); // LIKE wildcards are literal
  });

  it("pages on the server, and says how many there are past the end", async () => {
    const first = await list(owner, filters(), 3, 0);
    const second = await list(owner, filters(), 3, 3);
    expect(first.rows).toHaveLength(3);
    expect(second.rows).toHaveLength(3);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(6);
    expect(await list(owner, filters(), 3, 30)).toEqual({ rows: [], total: 7 });
    expect(parseTranscriptFilters({ page: "0", outcome: "nope", c: "x" })).toMatchObject({
      page: 1,
      outcome: null,
      c: null,
    });
  });

  it("staff read their own business's transcripts; other owners see nothing", async () => {
    expect((await list(staffer, filters())).total).toBe(7);
    expect(
      (
        await listTranscripts(ownerB, a.business.id, filters(), {
          zone: ZONE,
          today: today(),
          limit: 50,
          offset: 0,
        })
      ).total,
    ).toBe(0);
    expect(await getTranscript(ownerB, a.business.id, ids.booked!)).toBeNull();
    expect(await getTranscript(owner, a.business.id, ids.other!)).toBeNull();
  });

  it("a transcript: tool rows, the confirmation linked to its booking, the questions", async () => {
    const t = (await getTranscript(staffer, a.business.id, ids.booked!))!;
    expect(t.outcome).toBe("booked");
    expect(t.bookings.map((x) => x.code)).toEqual([bookedCode]);
    expect(t.questions).toEqual([
      expect.objectContaining({ message: "Can I bring my own dye?", status: "open" }),
    ]);
    const items = buildTranscriptItems(t.messages, { bookingIdByCode: {} });
    expect(items.map((i) => (i.kind === "message" ? i.role : i.label))).toEqual([
      "user",
      "assistant",
      "Customer confirmed · Booked",
    ]);
    expect(items.at(-1)).toMatchObject({ code: bookedCode, bookingId: t.bookings[0]!.id });
  });

  it("this month's usage: conversations, AI bookings, tokens and open questions", async () => {
    const usage = (await getAiUsage(owner, a.business.id, { zone: ZONE, today: today() }))!;
    expect(usage).toMatchObject({
      aiEnabled: true,
      plan: "pro",
      aiBookings: 1,
      tokens: 300 + 10 + 200 + 10,
      openQuestions: 2,
      tokenBudget: 500_000,
    });
    // Started this month: everything but the 40- and 95-day-old ones (and B's).
    expect(usage.conversations).toBeGreaterThanOrEqual(5);
    expect(usage.conversations).toBeLessThanOrEqual(7);
  });

  describe("FAQ editor", () => {
    it("owners add, edit, reorder and delete; staff can't", async () => {
      expect(await saveFaq(staffActor(), { question: "Staff?", answer: "No." })).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });

      const first = await saveFaq(ownerActor(), {
        question: " Parking? ",
        answer: "Yes, round back.",
      });
      const second = await saveFaq(ownerActor(), { question: "Payment?", answer: "Card or cash." });
      if (!first.ok || !second.ok) throw new Error("save failed");
      expect((await listFaqs(staffer, a.business.id)).map((f) => f.question)).toEqual([
        "Parking?",
        "Payment?",
      ]);

      expect(
        await saveFaq(
          ownerActor(),
          { question: "Parking?", answer: "Free on Sundays." },
          first.data.id,
        ),
      ).toMatchObject({ ok: true });
      expect(await orderFaqs(ownerActor(), [second.data.id, first.data.id])).toMatchObject({
        ok: true,
      });
      expect((await listFaqs(owner, a.business.id)).map((f) => f.answer)).toEqual([
        "Card or cash.",
        "Free on Sundays.",
      ]);
      // An order that isn't exactly this business's FAQs is refused.
      expect(await orderFaqs(ownerActor(), [first.data.id])).toMatchObject({ ok: false });
      expect(await orderFaqs(ownerActor(), [first.data.id, randomUUID()])).toMatchObject({
        ok: false,
      });
      expect(await orderFaqs(staffActor(), [first.data.id, second.data.id])).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });

      expect(await removeFaq(staffActor(), first.data.id)).toMatchObject({ ok: false });
      expect(await removeFaq(ownerActor(), first.data.id)).toMatchObject({ ok: true });
      expect(await removeFaq(ownerActor(), first.data.id)).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
      // Another business's owner can't touch it.
      expect(
        await saveFaq(
          { claims: ownerB, businessId: a.business.id, role: "owner" },
          { question: "Hijack", answer: "x" },
          second.data.id,
        ),
      ).toMatchObject({ ok: false });
      expect((await listFaqs(owner, a.business.id)).map((f) => f.question)).toEqual(["Payment?"]);
    });

    it("validates lengths and caps the number of answers", async () => {
      expect(await saveFaq(ownerActor(), { question: "", answer: "x" })).toMatchObject({
        ok: false,
        error: { code: "invalid_input", message: "Add the question." },
      });
      expect(
        await saveFaq(ownerActor(), {
          question: "x".repeat(FAQ_LIMITS.question + 1),
          answer: "y",
        }),
      ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
      expect(
        await saveFaq(ownerActor(), {
          question: "Long?",
          answer: "y".repeat(FAQ_LIMITS.answer + 1),
        }),
      ).toMatchObject({ ok: false, error: { code: "invalid_input" } });

      const existing = (await listFaqs(owner, a.business.id)).length;
      await db.insert(schema.faqs).values(
        Array.from({ length: FAQ_LIMITS.count - existing }, (_, i) => ({
          businessId: a.business.id,
          question: `Q${i}`,
          answer: "A",
          sortOrder: 100 + i,
        })),
      );
      expect(await saveFaq(ownerActor(), { question: "One more?", answer: "No." })).toMatchObject({
        ok: false,
        error: { code: "limit" },
      });
      await db.delete(schema.faqs).where(eq(schema.faqs.businessId, a.business.id));
    });
  });

  describe("the switch", () => {
    it("owners on Pro switch it; the booking page and chat follow", async () => {
      expect(await switchAi({ ...staffActor(), plan: "pro" }, false)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
      expect(await switchAi({ ...ownerActor(), plan: "pro" }, false)).toEqual({
        ok: true,
        data: { enabled: false },
      });
      expect((await getPublicBusinessBySlug(a.business.slug))?.aiEnabled).toBe(false);

      // An open chat now gets the polite message, not a 404.
      const response = await chatRoute(
        new Request(`http://localhost/api/chat/${a.business.slug}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.211" },
          body: JSON.stringify({ text: "Hello" }),
        }),
        { params: Promise.resolve({ slug: a.business.slug }) },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "ai_unavailable", message: CHAT_OFF_MESSAGE });
      const history = await historyRoute(
        new Request(`http://localhost/api/chat/${a.business.slug}?conversationId=${ids.nothing}`, {
          headers: { "x-forwarded-for": "192.0.2.212" },
        }),
        { params: Promise.resolve({ slug: a.business.slug }) },
      );
      expect(history.status).toBe(503);

      expect(await switchAi({ ...ownerActor(), plan: "pro" }, true)).toMatchObject({ ok: true });
      expect((await getPublicBusinessBySlug(a.business.slug))?.aiEnabled).toBe(true);
    });

    it("free-plan businesses can't switch it on", async () => {
      expect(await switchAi({ ...ownerActor(), plan: "free" }, true)).toMatchObject({
        ok: false,
        error: { code: "needs_pro" },
      });
      expect(await switchAi({ ...ownerActor(), plan: "free" }, "yes")).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    });
  });

  it("owners mark a question answered; staff can't", async () => {
    const [question] = await db
      .select()
      .from(schema.handoffRequests)
      .where(
        and(
          eq(schema.handoffRequests.businessId, a.business.id),
          eq(schema.handoffRequests.conversationId, ids.handed!),
        ),
      );
    expect(await answerQuestion(staffActor(), question!.id)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(
      await answerQuestion(
        { claims: ownerB, businessId: a.business.id, role: "owner" },
        question!.id,
      ),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await answerQuestion(ownerActor(), question!.id)).toEqual({ ok: true, data: null });
    const [after] = await db
      .select()
      .from(schema.handoffRequests)
      .where(eq(schema.handoffRequests.id, question!.id));
    expect(after).toMatchObject({ status: "replied", repliedBy: owner.sub });
    expect(await answerQuestion(ownerActor(), question!.id)).toMatchObject({ ok: false });
  });

  it("retention deletes transcripts after 90 days; bookings, customers and questions stay", async () => {
    // The booked chat goes quiet 100 days ago.
    await db
      .update(schema.aiConversations)
      .set({ lastMessageAt: new Date(Date.now() - 100 * DAY) })
      .where(eq(schema.aiConversations.id, ids.booked!));
    const result = await purgeExpiredTranscripts();
    expect(result.deleted).toBeGreaterThanOrEqual(2);

    const left = (await list(owner, filters())).rows.map((r) => r.id);
    expect(left).not.toContain(ids.expired);
    expect(left).not.toContain(ids.booked);
    expect(left).toContain(ids.old); // 40 days: kept
    expect(
      await db
        .select()
        .from(schema.aiMessages)
        .where(eq(schema.aiMessages.conversationId, ids.booked!)),
    ).toEqual([]);
    const [booking] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.code, bookedCode));
    expect(booking).toMatchObject({ aiConversationId: null, status: "confirmed" });
    const questions = await db
      .select()
      .from(schema.handoffRequests)
      .where(eq(schema.handoffRequests.message, "Can I bring my own dye?"));
    expect(questions).toEqual([expect.objectContaining({ conversationId: null })]);
    // The other business's recent chat is untouched.
    const [other] = await db
      .select()
      .from(schema.aiConversations)
      .where(eq(schema.aiConversations.id, ids.other!));
    expect(other).toBeDefined();
  });
});
