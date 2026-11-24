import "server-only";

import type { ModelMessage } from "ai";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import type { AiBusinessContext } from "@/server/ai/prompt";

import { adminQuery, type TenantScoped } from "../../admin";
import {
  aiConversations,
  aiMessages,
  availabilityRules,
  businesses,
  customers,
  faqs,
  handoffRequests,
  services,
} from "../../schema";
import { getBookingPage } from "./booking-page";

/*
 * The AI receptionist (/api/chat/[slug]): what it may know about a business,
 * and its transcripts. No signed-in user, so adminDb, always by businessId.
 * The context holds public fields only (tests/integration/public-data.test.ts):
 * the services and staff the booking page offers, their hours, the rules and
 * the FAQs. Never customers, contact details, notes or settings.
 */

/** Everything the system prompt is built from, or null for an unknown business. */
export const getAiContext = adminQuery(
  async (db, { businessId }: TenantScoped): Promise<AiBusinessContext | null> => {
    // The same bookable services and staff as the booking page.
    const page = await getBookingPage(businessId);
    if (!page) return null;
    const serviceIds = page.services.map((s) => s.id);
    const staffIds = page.staff.map((p) => p.id);

    const [[rules], descriptions, hours, faqRows] = await Promise.all([
      db
        .select({
          minNoticeMin: businesses.minNoticeMin,
          slotIntervalMin: businesses.slotIntervalMin,
        })
        .from(businesses)
        .where(eq(businesses.id, businessId)),
      serviceIds.length
        ? db
            .select({ id: services.id, description: services.description })
            .from(services)
            .where(and(eq(services.businessId, businessId), inArray(services.id, serviceIds)))
        : [],
      staffIds.length
        ? db
            .select({
              staffId: availabilityRules.staffId,
              weekday: availabilityRules.weekday,
              startTime: availabilityRules.startTime,
              endTime: availabilityRules.endTime,
            })
            .from(availabilityRules)
            .where(
              and(
                eq(availabilityRules.businessId, businessId),
                inArray(availabilityRules.staffId, staffIds),
              ),
            )
        : [],
      db
        .select({ question: faqs.question, answer: faqs.answer })
        .from(faqs)
        .where(eq(faqs.businessId, businessId))
        .orderBy(asc(faqs.sortOrder), asc(faqs.createdAt)),
    ]);
    if (!rules) return null;

    const { business } = page;
    return {
      business: {
        name: business.name,
        timezone: business.timezone,
        currency: business.currency,
        address: business.address,
        minNoticeMin: rules.minNoticeMin,
        maxDaysAhead: business.maxDaysAhead,
        slotIntervalMin: rules.slotIntervalMin,
        cancellationWindowHours: business.cancellationWindowHours,
        openingHours: business.openingHours,
      },
      services: page.services.map((s) => ({
        name: s.name,
        description: descriptions.find((d) => d.id === s.id)?.description ?? null,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
        staffNames: page.staff.filter((p) => p.serviceIds.includes(s.id)).map((p) => p.name),
      })),
      staff: page.staff.map((p) => ({
        name: p.name,
        title: p.title,
        hours: hours
          .filter((h) => h.staffId === p.id)
          .map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
      })),
      faqs: faqRows,
    };
  },
);

/** A conversation of this business with its customer-turn count, or null. */
export const findConversation = adminQuery(
  async (
    db,
    { businessId, conversationId }: TenantScoped & { conversationId: string },
  ): Promise<{ id: string; userTurns: number } | null> => {
    const [row] = await db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(
        and(eq(aiConversations.id, conversationId), eq(aiConversations.businessId, businessId)),
      );
    if (!row) return null;
    const [turns] = await db
      .select({ n: count() })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.businessId, businessId),
          eq(aiMessages.conversationId, row.id),
          eq(aiMessages.role, "user"),
        ),
      );
    return { id: row.id, userTurns: turns?.n ?? 0 };
  },
);

export const startConversation = adminQuery(
  async (
    db,
    { businessId, channel }: TenantScoped & { channel: "page" | "widget" },
  ): Promise<string> => {
    const [row] = await db
      .insert(aiConversations)
      .values({ businessId, channel })
      .returning({ id: aiConversations.id });
    return row!.id;
  },
);

/**
 * An assistant turn's `parts` hold the model's response messages (its text,
 * tool calls and tool results, as the AI SDK returned them) so the next
 * request replays the conversation exactly, tools included. Earlier rows hold
 * a single text part; those replay as plain text.
 */
function isResponseMessages(parts: unknown): parts is ModelMessage[] {
  return (
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        ((p as { role?: unknown }).role === "assistant" ||
          (p as { role?: unknown }).role === "tool"),
    )
  );
}

/** The conversation so far as model messages, oldest first. */
export const loadTranscript = adminQuery(
  async (
    db,
    { businessId, conversationId }: TenantScoped & { conversationId: string },
  ): Promise<ModelMessage[]> => {
    const rows = await db
      .select({ role: aiMessages.role, content: aiMessages.content, parts: aiMessages.parts })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.businessId, businessId),
          eq(aiMessages.conversationId, conversationId),
          inArray(aiMessages.role, ["user", "assistant"]),
        ),
      )
      .orderBy(asc(aiMessages.createdAt), asc(aiMessages.id));
    return rows.flatMap((row): ModelMessage[] => {
      if (row.role === "user") return [{ role: "user", content: row.content }];
      if (isResponseMessages(row.parts)) return row.parts;
      return [{ role: "assistant", content: row.content }];
    });
  },
);

/** Append a turn and bump the conversation's last activity. */
export const saveMessage = adminQuery(
  async (
    db,
    {
      businessId,
      conversationId,
      role,
      content,
      parts,
      inputTokens,
      outputTokens,
    }: TenantScoped & {
      conversationId: string;
      role: "user" | "assistant";
      /** Plain text, for previews and search. */
      content: string;
      /** Default: one text part. Assistant turns: the model's response messages. */
      parts?: unknown[];
      inputTokens?: number;
      outputTokens?: number;
    },
  ): Promise<void> => {
    await db.transaction(async (tx) => {
      await tx.insert(aiMessages).values({
        businessId,
        conversationId,
        role,
        content,
        parts: parts ?? [{ type: "text", text: content }],
        inputTokens,
        outputTokens,
      });
      await tx
        .update(aiConversations)
        .set({ lastMessageAt: sql`now()` })
        .where(
          and(eq(aiConversations.id, conversationId), eq(aiConversations.businessId, businessId)),
        );
    });
  },
);

/**
 * "Message the team": an open question the owner sees on the customer's
 * profile (step 3.6). The customer is found by email in this business, or
 * created with what they typed; an existing customer's record is never
 * changed from here (as on the booking page). Marks the chat handed off.
 */
export const saveHandoff = adminQuery(
  async (
    db,
    {
      businessId,
      conversationId,
      name,
      email,
      message,
    }: TenantScoped & { conversationId: string; name: string; email: string; message: string },
  ): Promise<void> => {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, businessId),
            sql`lower(${customers.email}) = lower(${email})`,
          ),
        );
      const customerId =
        existing?.id ??
        (
          await tx
            .insert(customers)
            .values({ businessId, name, email })
            .onConflictDoNothing()
            .returning({ id: customers.id })
        )[0]?.id ??
        null;
      await tx.insert(handoffRequests).values({
        businessId,
        conversationId,
        customerId,
        name,
        email,
        message,
      });
      await tx
        .update(aiConversations)
        .set({
          outcome: "handed_off",
          visitorName: name,
          visitorEmail: email,
          ...(customerId ? { customerId } : {}),
        })
        .where(
          and(eq(aiConversations.id, conversationId), eq(aiConversations.businessId, businessId)),
        );
    });
  },
);

/** Every customer and assistant row of a conversation, oldest first: the chat after a refresh. */
export const loadHistoryRows = adminQuery(
  async (db, { businessId, conversationId }: TenantScoped & { conversationId: string }) =>
    db
      .select({
        id: aiMessages.id,
        role: aiMessages.role,
        content: aiMessages.content,
        parts: aiMessages.parts,
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
);
