import "server-only";

import { APICallError } from "ai";

import { AiBudgetWarningEmail } from "@/emails/ai-budget-warning";
import { env } from "@/env";
import { type BudgetState, budgetState, monthWindow } from "@/lib/ai-guardrails";
import { formatInZone } from "@/lib/dates";
import { afterResponse } from "@/server/after-response";
import {
  type BudgetBusiness,
  getBudget,
  recordGuardrailEvent,
  tokensUsed,
} from "@/server/db/queries/public/ai-guardrails";
import { getOwnerEmails } from "@/server/db/queries/system/owners";
import { sendEmail } from "@/server/email/send";
import { adjustCounter, limitAll, sharedStoreConfigured } from "@/server/rate-limit";

/*
 * The AI receptionist's guardrails, checked before any model call
 * (/api/chat/[slug]): the business's monthly token budget (reset on the 1st
 * in its timezone; the owner is emailed once at 80%; at 100% the chat rests),
 * and the shared daily cap across every business. Also: telling a provider's
 * "too many requests" apart from a bug, and logging errors without content.
 */

export type BudgetCheck = { state: BudgetState; used: number; budget: number; period: string };

const percent = (used: number, budget: number) =>
  budget > 0 ? Math.min(100, Math.floor((used / budget) * 100)) : 100;

async function emailOwners(
  businessId: string,
  business: BudgetBusiness,
  used: number,
  resetsAt: Date,
) {
  const to = await getOwnerEmails({ businessId });
  if (to.length === 0) return;
  const numbers = (n: number) => n.toLocaleString("en-US");
  const share = `${percent(used, business.budget)}%`;
  await sendEmail({
    to,
    subject: `Your AI receptionist has used ${share} of this month's budget`,
    react: AiBudgetWarningEmail({
      business: {
        name: business.name,
        brandColor: business.brandColor,
        address: business.address,
        logoUrl: business.logoUrl,
      },
      share,
      used: numbers(used),
      budget: numbers(business.budget),
      resetsOn: formatInZone(resetsAt, business.timezone, "d MMMM"),
      dashboardUrl: new URL("/app/ai", env.NEXT_PUBLIC_APP_URL).toString(),
    }),
    logLines: [`AI budget warning for the owners of ${business.name}`],
  });
}

/** Where the business stands this month; records events (and emails once) as thresholds pass. */
export async function checkBudget(businessId: string, now = new Date()): Promise<BudgetCheck> {
  const business = await getBudget({ businessId });
  if (!business) return { state: "exhausted", used: 0, budget: 0, period: "" };
  const { start, end, period } = monthWindow(now, business.timezone);
  const used = await tokensUsed({ businessId, from: start, to: end });
  const state = budgetState(used, business.budget);

  if (state !== "ok") {
    // Once a month: only the first insert for this period wins.
    const first = await recordGuardrailEvent({
      businessId,
      kind: "budget_warning",
      period,
      detail: { used, budget: business.budget },
    });
    if (first) {
      await afterResponse(async () => {
        try {
          await emailOwners(businessId, business, used, end);
        } catch (error) {
          console.error("[ai-guardrails] Budget email failed", { businessId, ...describe(error) });
        }
      }, undefined);
    }
  }
  // After the warning, so the latest event says what's happening now.
  if (state === "exhausted") {
    await recordGuardrailEvent({ businessId, kind: "budget_exhausted", period, detail: { used } });
  }
  return { state, used, budget: business.budget, period };
}

/**
 * The shared daily cap: take one model call from it, across every business,
 * and from this business's share of it (a quarter), so one business can't
 * spend everyone's. Called before the first call of a turn and again before
 * each further step. Fails closed: a store error refuses.
 */
export async function allowModelCall(businessId: string, now = Date.now()): Promise<boolean> {
  const result = await limitAll(
    [
      ["ai:calls:business", businessId],
      ["ai:calls", "all"],
    ],
    now,
  );
  if (!result.ok) {
    await recordGuardrailEvent({
      businessId,
      kind: "global_cap",
      period: new Date(now).toISOString().slice(0, 10),
      detail: { limit: result.limit },
    });
  }
  return result.ok;
}

/**
 * Whether the AI may run at all here. On Vercel Production the caps and
 * reservations must be shared across instances (Upstash); without it each
 * instance would count on its own, so the chat stays off instead.
 */
export function aiStoreReady(): boolean {
  if (env.VERCEL_ENV !== "production" || sharedStoreConfigured()) return true;
  if (!warnedNoStore) {
    warnedNoStore = true;
    console.error("[ai-guardrails] Upstash isn't configured on Production; the AI chat is off.");
  }
  return false;
}
let warnedNoStore = false;

// ── token reservations ────────────────────────────────────────────────

/**
 * What one model call may cost, in tokens: the prompt as sent (about four
 * characters a token, rounded up) plus the longest reply. Reserved before
 * the call so parallel messages can't all pass a budget that has room for one.
 */
export function estimateCallTokens(promptChars: number, maxOutputTokens: number): number {
  return Math.ceil(promptChars / 4) + maxOutputTokens;
}

/** Reservations expire on their own if a request dies before releasing them. */
const RESERVATION_TTL_SEC = 600;
const reservationKey = (businessId: string) => `ai:reserved:${businessId}`;

export type Reservation = "reserved" | "over_budget" | "unavailable";

/**
 * Reserve `tokens` of the business's monthly budget for a call. Nothing is
 * held unless "reserved": "over_budget" when this month's use plus everything
 * reserved would pass the budget, "unavailable" when the store can't be asked.
 */
export async function reserveTokens(
  businessId: string,
  tokens: number,
  { used, budget }: { used: number; budget: number },
): Promise<Reservation> {
  try {
    const reserved = await adjustCounter(reservationKey(businessId), tokens, RESERVATION_TTL_SEC);
    if (used + reserved <= budget) return "reserved";
    await adjustCounter(reservationKey(businessId), -tokens, RESERVATION_TTL_SEC);
    return "over_budget";
  } catch (error) {
    console.error("[ai-guardrails] Reserving tokens failed; refusing", describe(error));
    return "unavailable";
  }
}

/** Hand back reserved tokens once the turn's real usage is saved. */
export async function releaseTokens(businessId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  try {
    const left = await adjustCounter(reservationKey(businessId), -tokens, RESERVATION_TTL_SEC);
    // The counter expired meanwhile and restarted at 0: never leave it below.
    if (left < 0) await adjustCounter(reservationKey(businessId), -left, RESERVATION_TTL_SEC);
  } catch (error) {
    // The reservation expires by itself (RESERVATION_TTL_SEC).
    console.error("[ai-guardrails] Releasing tokens failed", describe(error));
  }
}

const LIMITED =
  /\b(rate.?limit|quota|resource.?exhausted|overloaded|high demand|too many requests)\b/i;

/**
 * The provider is refusing for load, not because of us: rate limit, quota,
 * overload. The customer gets the polite "not available" message.
 */
export function isProviderLimited(error: unknown): boolean {
  const nested = error as { cause?: unknown; errors?: unknown[]; lastError?: unknown };
  const candidates = [error, nested?.cause, nested?.lastError, ...(nested?.errors ?? [])];
  return candidates.some((e) => {
    if (APICallError.isInstance(e) && [429, 503, 529].includes(e.statusCode ?? 0)) return true;
    return e instanceof Error && LIMITED.test(e.message);
  });
}

/** Safe log fields for an error: its kind and status, never prompts, messages or keys. */
export function describe(error: unknown): { error: string; status?: number } {
  if (APICallError.isInstance(error)) return { error: error.name, status: error.statusCode };
  if (error instanceof Error) return { error: error.name };
  return { error: "Unknown" };
}
