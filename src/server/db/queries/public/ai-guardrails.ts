import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";

import { adminQuery, type TenantScoped } from "../../admin";
import { aiGuardrailEvents, aiMessages, businesses, handoffRequests } from "../../schema";

/*
 * The AI receptionist's guardrails (src/server/ai/guardrails.ts): the
 * business's token budget and use this month, its guardrail events, and how
 * many questions a customer has waiting. No signed-in user: adminDb, always
 * by businessId.
 */

export type BudgetBusiness = {
  budget: number;
  timezone: string;
  name: string;
  brandColor: string;
  address: string | null;
  logoUrl: string | null;
};

export const getBudget = adminQuery(
  async (db, { businessId }: TenantScoped): Promise<BudgetBusiness | null> => {
    const [row] = await db
      .select({
        budget: businesses.aiMonthlyTokenBudget,
        timezone: businesses.timezone,
        name: businesses.name,
        brandColor: businesses.brandColor,
        address: businesses.address,
        logoUrl: businesses.logoUrl,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    return row ?? null;
  },
);

/** Tokens the business's chats used in [from, to). */
export const tokensUsed = adminQuery(
  async (
    db,
    { businessId, from, to }: TenantScoped & { from: Date; to: Date },
  ): Promise<number> => {
    const [row] = await db
      .select({
        n: sql<number>`coalesce(sum(coalesce(${aiMessages.inputTokens}, 0) + coalesce(${aiMessages.outputTokens}, 0)), 0)::int`,
      })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.businessId, businessId),
          gte(aiMessages.createdAt, from),
          lt(aiMessages.createdAt, to),
        ),
      );
    return row?.n ?? 0;
  },
);

export type GuardrailKind = (typeof aiGuardrailEvents.$inferInsert)["kind"];

/**
 * Record a guardrail event. With a `period`, only the first of its kind in
 * that period is kept: true means this call recorded it (send the email).
 */
export const recordGuardrailEvent = adminQuery(
  async (
    db,
    {
      businessId,
      kind,
      period = null,
      detail = null,
    }: TenantScoped & {
      kind: GuardrailKind;
      period?: string | null;
      detail?: Record<string, unknown> | null;
    },
  ): Promise<boolean> => {
    const rows = await db
      .insert(aiGuardrailEvents)
      .values({ businessId, kind, period, detail })
      .onConflictDoNothing()
      .returning({ id: aiGuardrailEvents.id });
    return rows.length > 0;
  },
);

/** Questions this email has waiting for the team at this business. */
export const openQuestionsFor = adminQuery(
  async (db, { businessId, email }: TenantScoped & { email: string }): Promise<number> => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(handoffRequests)
      .where(
        and(
          eq(handoffRequests.businessId, businessId),
          eq(handoffRequests.status, "open"),
          sql`lower(${handoffRequests.email}) = lower(${email})`,
        ),
      );
    return row?.n ?? 0;
  },
);
