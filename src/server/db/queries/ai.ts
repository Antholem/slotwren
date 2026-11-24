import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";

import type { TranscriptFilters, TranscriptOutcome } from "@/lib/ai-transcripts";
import { nextDate, zonedInstant } from "@/lib/time-off";

import { type RlsClaims, withRls } from "../client";
import {
  aiConversations,
  aiMessages,
  bookings,
  businesses,
  faqs,
  handoffRequests,
} from "../schema";

/*
 * The AI receptionist page (/app/ai) as the signed-in member (withRls, so RLS
 * decides; every query also filters by business_id): transcripts with their
 * outcome, one transcript in full, this month's usage, the FAQ the assistant
 * answers from, the on/off switch and the team's questions.
 *
 * Outcomes come from what members may read: Confirm's records in ai_messages
 * (a data-confirmation part per confirmed booking, move or cancellation) and
 * the hand-off questions. ai_proposals stays server-only.
 */

/** Outer-row columns for correlated subqueries (Drizzle leaves them unqualified in a select). */
const outer = {
  id: sql.raw("ai_conversations.id"),
  businessId: sql.raw("ai_conversations.business_id"),
  customerId: sql.raw("ai_conversations.customer_id"),
  visitorName: sql.raw("ai_conversations.visitor_name"),
  visitorEmail: sql.raw("ai_conversations.visitor_email"),
  outcome: sql.raw("ai_conversations.outcome"),
};

// Raw table names: these subqueries correlate with the outer ai_conversations row.
const confirmed = (kind: "book" | "reschedule" | "cancel") =>
  sql.raw(
    `exists (select 1 from ai_messages m where m.conversation_id = ai_conversations.id ` +
      `and m.business_id = ai_conversations.business_id and m.role = 'assistant' ` +
      `and m.parts @> '[{"type":"data-confirmation","data":{"confirmed":true,"kind":"${kind}"}}]')`,
  );
const handedOff = sql.raw(
  `(ai_conversations.outcome = 'handed_off' or exists (select 1 from handoff_requests h ` +
    `where h.conversation_id = ai_conversations.id and h.business_id = ai_conversations.business_id))`,
);

/** Booked > Rescheduled > Cancelled > Handed off > No action (classifyOutcome, in SQL). */
const outcomeSql = sql<TranscriptOutcome>`(case
  when ${confirmed("book")} or ${outer.outcome} = 'booked' then 'booked'
  when ${confirmed("reschedule")} then 'rescheduled'
  when ${confirmed("cancel")} then 'cancelled'
  when ${handedOff} then 'handed_off'
  else 'none' end)`;

const firstBooking = (column: string) =>
  sql.raw(
    `(select b.${column} from bookings b where b.ai_conversation_id = ai_conversations.id ` +
      `and b.business_id = ai_conversations.business_id order by b.created_at limit 1)`,
  );

/** The customer record: the one the hand-off matched, else the one the chat booked. */
const customerIdSql = sql<
  string | null
>`coalesce(${outer.customerId}, ${firstBooking("customer_id")})`;

const customerNameSql = sql<string | null>`coalesce(
  (select c.name from customers c where c.id = ${customerIdSql} and c.business_id = ${outer.businessId}),
  ${outer.visitorName},
  ${firstBooking("customer_name")})`;

const firstQuestionSql = sql<string | null>`(select m.content from ai_messages m
  where m.conversation_id = ${outer.id} and m.business_id = ${outer.businessId}
    and m.role = 'user' order by m.created_at, m.id limit 1)`;

const messageCountSql = sql<number>`(select count(*)::int from ai_messages m
  where m.conversation_id = ${outer.id} and m.business_id = ${outer.businessId}
    and m.role in ('user', 'assistant'))`;

const openQuestionSql = sql<boolean>`exists (select 1 from handoff_requests h
  where h.conversation_id = ${outer.id} and h.business_id = ${outer.businessId}
    and h.status = 'open')`;

const escapeLike = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The start (inclusive) and end (exclusive) of a range, as instants in the business's zone. */
export function transcriptWindow(
  filters: Pick<TranscriptFilters, "range" | "from" | "to">,
  { zone, today }: { zone: string; today: string },
): { from: Date | null; to: Date | null } {
  const at = (date: string) => zonedInstant(date, "00:00", zone);
  switch (filters.range) {
    case "today":
      return { from: at(today), to: at(nextDate(today)) };
    case "past7":
      return { from: at(nextDate(today, -6)), to: null };
    case "past30":
      return { from: at(nextDate(today, -29)), to: null };
    case "custom":
      return {
        from: filters.from ? at(filters.from) : null,
        to: filters.to ? at(nextDate(filters.to)) : null,
      };
    default:
      return { from: null, to: null };
  }
}

function whereFor(
  businessId: string,
  filters: TranscriptFilters,
  context: { zone: string; today: string },
): SQL | undefined {
  const { from, to } = transcriptWindow(filters, context);
  const term = filters.q.trim();
  const like = escapeLike(term);
  return and(
    eq(aiConversations.businessId, businessId),
    from ? gte(aiConversations.startedAt, from) : undefined,
    to ? lt(aiConversations.startedAt, to) : undefined,
    filters.outcome ? sql`${outcomeSql} = ${filters.outcome}` : undefined,
    term
      ? sql`(
          ${customerNameSql} ilike ${like}
          or ${outer.visitorEmail} ilike ${like}
          or exists (select 1 from customers c where c.id = ${customerIdSql}
            and c.business_id = ${outer.businessId} and c.email ilike ${like})
          or exists (select 1 from bookings b where b.ai_conversation_id = ${outer.id}
            and b.business_id = ${outer.businessId} and b.code ilike ${like})
          or exists (select 1 from handoff_requests h where h.conversation_id = ${outer.id}
            and h.business_id = ${outer.businessId}
            and (h.name ilike ${like} or h.email ilike ${like})))`
      : undefined,
  );
}

export type TranscriptRow = {
  id: string;
  startedAt: Date;
  lastMessageAt: Date;
  channel: "page" | "widget";
  customerId: string | null;
  customerName: string | null;
  firstQuestion: string | null;
  outcome: TranscriptOutcome;
  messageCount: number;
  openQuestion: boolean;
};

/** One page of transcripts (newest first) and how many match in all. */
export async function listTranscripts(
  claims: RlsClaims,
  businessId: string,
  filters: TranscriptFilters,
  context: { zone: string; today: string; limit: number; offset: number },
): Promise<{ rows: TranscriptRow[]; total: number }> {
  const where = whereFor(businessId, filters, context);
  return withRls(claims, async (tx) => {
    const rows = await tx
      .select({
        id: aiConversations.id,
        startedAt: aiConversations.startedAt,
        lastMessageAt: aiConversations.lastMessageAt,
        channel: aiConversations.channel,
        customerId: customerIdSql,
        customerName: customerNameSql,
        firstQuestion: firstQuestionSql,
        outcome: outcomeSql,
        messageCount: messageCountSql,
        openQuestion: openQuestionSql,
        total: sql<number>`(count(*) over ())::int`,
      })
      .from(aiConversations)
      .where(where)
      .orderBy(desc(aiConversations.startedAt), desc(aiConversations.id))
      .limit(context.limit)
      .offset(context.offset);
    if (rows.length > 0 || context.offset === 0) {
      return { rows: rows.map(({ total: _, ...row }) => row), total: rows[0]?.total ?? 0 };
    }
    // Past the last page: still say how many there are.
    const [counted] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiConversations)
      .where(where);
    return { rows: [], total: counted?.n ?? 0 };
  });
}

export type TranscriptQuestion = {
  id: string;
  name: string;
  email: string;
  message: string;
  status: "open" | "replied" | "closed";
  createdAt: Date;
  repliedAt: Date | null;
  customerId: string | null;
};

export type TranscriptDetail = {
  id: string;
  startedAt: Date;
  lastMessageAt: Date;
  channel: "page" | "widget";
  outcome: TranscriptOutcome;
  customerId: string | null;
  customerName: string | null;
  messages: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    parts: unknown;
    createdAt: Date;
  }[];
  bookings: { id: string; code: string; status: string; customerId: string }[];
  questions: TranscriptQuestion[];
};

/** A whole conversation for the transcript view, or null (not this business's, or deleted). */
export async function getTranscript(
  claims: RlsClaims,
  businessId: string,
  conversationId: string,
): Promise<TranscriptDetail | null> {
  return withRls(claims, async (tx) => {
    const [conversation] = await tx
      .select({
        id: aiConversations.id,
        startedAt: aiConversations.startedAt,
        lastMessageAt: aiConversations.lastMessageAt,
        channel: aiConversations.channel,
        outcome: outcomeSql,
        customerId: customerIdSql,
        customerName: customerNameSql,
      })
      .from(aiConversations)
      .where(
        and(eq(aiConversations.id, conversationId), eq(aiConversations.businessId, businessId)),
      );
    if (!conversation) return null;
    const [messages, linked, questions] = await Promise.all([
      tx
        .select({
          id: aiMessages.id,
          role: aiMessages.role,
          content: aiMessages.content,
          parts: aiMessages.parts,
          createdAt: aiMessages.createdAt,
        })
        .from(aiMessages)
        .where(
          and(
            eq(aiMessages.businessId, businessId),
            eq(aiMessages.conversationId, conversationId),
            inArray(aiMessages.role, ["user", "assistant"]),
          ),
        )
        .orderBy(asc(aiMessages.createdAt), asc(aiMessages.id)),
      tx
        .select({
          id: bookings.id,
          code: bookings.code,
          status: bookings.status,
          customerId: bookings.customerId,
        })
        .from(bookings)
        .where(
          and(eq(bookings.businessId, businessId), eq(bookings.aiConversationId, conversationId)),
        ),
      tx
        .select({
          id: handoffRequests.id,
          name: handoffRequests.name,
          email: handoffRequests.email,
          message: handoffRequests.message,
          status: handoffRequests.status,
          createdAt: handoffRequests.createdAt,
          repliedAt: handoffRequests.repliedAt,
          customerId: handoffRequests.customerId,
        })
        .from(handoffRequests)
        .where(
          and(
            eq(handoffRequests.businessId, businessId),
            eq(handoffRequests.conversationId, conversationId),
          ),
        )
        .orderBy(asc(handoffRequests.createdAt)),
    ]);
    return { ...conversation, messages, bookings: linked, questions };
  });
}

/** Bookings the AI changed (moved or cancelled) are found by code in the confirmations. */
export async function bookingsByCode(
  claims: RlsClaims,
  businessId: string,
  codes: string[],
): Promise<{ id: string; code: string; customerId: string }[]> {
  if (codes.length === 0) return [];
  return withRls(claims, (tx) =>
    tx
      .select({ id: bookings.id, code: bookings.code, customerId: bookings.customerId })
      .from(bookings)
      .where(and(eq(bookings.businessId, businessId), inArray(bookings.code, codes))),
  );
}

export type AiUsage = {
  aiEnabled: boolean;
  plan: "free" | "pro";
  /** This calendar month, in the business's timezone. */
  conversations: number;
  aiBookings: number;
  tokens: number;
  tokenBudget: number;
  openQuestions: number;
  chatsToday: number;
  bookedToday: number;
};

export async function getAiUsage(
  claims: RlsClaims,
  businessId: string,
  { zone, today }: { zone: string; today: string },
): Promise<AiUsage | null> {
  const monthStart = zonedInstant(`${today.slice(0, 8)}01`, "00:00", zone);
  const dayStart = zonedInstant(today, "00:00", zone);
  return withRls(claims, async (tx) => {
    const [business] = await tx
      .select({
        aiEnabled: businesses.aiEnabled,
        plan: businesses.plan,
        tokenBudget: businesses.aiMonthlyTokenBudget,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    if (!business) return null;
    const [[chats], [booked], [tokens], [open]] = await Promise.all([
      tx
        .select({
          month: sql<number>`count(*)::int`,
          today: sql<number>`(count(*) filter (where ${aiConversations.startedAt} >= ${dayStart.toISOString()}::timestamptz))::int`,
        })
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.businessId, businessId),
            gte(aiConversations.startedAt, monthStart),
          ),
        ),
      tx
        .select({
          month: sql<number>`count(*)::int`,
          today: sql<number>`(count(*) filter (where ${bookings.createdAt} >= ${dayStart.toISOString()}::timestamptz))::int`,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.businessId, businessId),
            eq(bookings.source, "ai"),
            gte(bookings.createdAt, monthStart),
          ),
        ),
      tx
        .select({
          n: sql<number>`coalesce(sum(coalesce(${aiMessages.inputTokens}, 0) + coalesce(${aiMessages.outputTokens}, 0)), 0)::int`,
        })
        .from(aiMessages)
        .where(and(eq(aiMessages.businessId, businessId), gte(aiMessages.createdAt, monthStart))),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(handoffRequests)
        .where(and(eq(handoffRequests.businessId, businessId), eq(handoffRequests.status, "open"))),
    ]);
    return {
      aiEnabled: business.aiEnabled,
      plan: business.plan,
      tokenBudget: business.tokenBudget,
      conversations: chats?.month ?? 0,
      chatsToday: chats?.today ?? 0,
      aiBookings: booked?.month ?? 0,
      bookedToday: booked?.today ?? 0,
      tokens: tokens?.n ?? 0,
      openQuestions: open?.n ?? 0,
    };
  });
}

// ── FAQ ───────────────────────────────────────────────────────────────

export type FaqRow = { id: string; question: string; answer: string; sortOrder: number };

export async function listFaqs(claims: RlsClaims, businessId: string): Promise<FaqRow[]> {
  return withRls(claims, (tx) =>
    tx
      .select({
        id: faqs.id,
        question: faqs.question,
        answer: faqs.answer,
        sortOrder: faqs.sortOrder,
      })
      .from(faqs)
      .where(eq(faqs.businessId, businessId))
      .orderBy(asc(faqs.sortOrder), asc(faqs.createdAt), asc(faqs.id)),
  );
}

/** Add at the end. Owners only (RLS: a staff member's insert raises 42501). */
export async function insertFaq(
  claims: RlsClaims,
  businessId: string,
  values: { question: string; answer: string },
): Promise<string> {
  return withRls(claims, async (tx) => {
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${faqs.sortOrder}), -1)::int` })
      .from(faqs)
      .where(eq(faqs.businessId, businessId));
    const id = crypto.randomUUID();
    await tx.insert(faqs).values({ id, businessId, ...values, sortOrder: (last?.n ?? -1) + 1 });
    return id;
  });
}

/** False when it isn't there (or RLS hid it). */
export async function updateFaq(
  claims: RlsClaims,
  businessId: string,
  faqId: string,
  values: { question: string; answer: string },
): Promise<boolean> {
  return withRls(claims, async (tx) => {
    const rows = await tx
      .update(faqs)
      .set(values)
      .where(and(eq(faqs.id, faqId), eq(faqs.businessId, businessId)))
      .returning({ id: faqs.id });
    return rows.length > 0;
  });
}

export async function deleteFaq(
  claims: RlsClaims,
  businessId: string,
  faqId: string,
): Promise<boolean> {
  return withRls(claims, async (tx) => {
    const rows = await tx
      .delete(faqs)
      .where(and(eq(faqs.id, faqId), eq(faqs.businessId, businessId)))
      .returning({ id: faqs.id });
    return rows.length > 0;
  });
}

/** Rewrite the order: `ids` must be exactly this business's FAQs. False otherwise. */
export async function reorderFaqs(
  claims: RlsClaims,
  businessId: string,
  ids: string[],
): Promise<boolean> {
  return withRls(claims, async (tx) => {
    const current = await tx
      .select({ id: faqs.id })
      .from(faqs)
      .where(eq(faqs.businessId, businessId));
    const known = new Set(current.map((r) => r.id));
    if (ids.length !== known.size || !ids.every((id) => known.has(id))) return false;
    for (const [index, id] of ids.entries()) {
      const rows = await tx
        .update(faqs)
        .set({ sortOrder: index })
        .where(and(eq(faqs.id, id), eq(faqs.businessId, businessId)))
        .returning({ id: faqs.id });
      if (rows.length === 0) return false;
    }
    return true;
  });
}

export async function countFaqs(claims: RlsClaims, businessId: string): Promise<number> {
  return withRls(claims, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(faqs)
      .where(eq(faqs.businessId, businessId));
    return row?.n ?? 0;
  });
}

// ── switch and questions ──────────────────────────────────────────────

/** Owners only (RLS on businesses). False when nothing was updated. */
export async function setAiEnabled(
  claims: RlsClaims,
  businessId: string,
  enabled: boolean,
): Promise<boolean> {
  return withRls(claims, async (tx) => {
    const rows = await tx
      .update(businesses)
      .set({ aiEnabled: enabled })
      .where(eq(businesses.id, businessId))
      .returning({ id: businesses.id });
    return rows.length > 0;
  });
}

/** Mark a question for the team answered. Owners only (RLS). False when nothing changed. */
export async function markQuestionAnswered(
  claims: RlsClaims,
  businessId: string,
  questionId: string,
  now: Date,
): Promise<boolean> {
  return withRls(claims, async (tx) => {
    const rows = await tx
      .update(handoffRequests)
      .set({ status: "replied", repliedAt: now, repliedBy: claims.sub })
      .where(
        and(
          eq(handoffRequests.id, questionId),
          eq(handoffRequests.businessId, businessId),
          eq(handoffRequests.status, "open"),
        ),
      )
      .returning({ id: handoffRequests.id });
    return rows.length > 0;
  });
}

/** The business's plan, for the switch (Pro turns the receptionist on). */
export async function getBusinessPlan(
  claims: RlsClaims,
  businessId: string,
): Promise<"free" | "pro" | null> {
  return withRls(claims, async (tx) => {
    const [row] = await tx
      .select({ plan: businesses.plan })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    return row?.plan ?? null;
  });
}
