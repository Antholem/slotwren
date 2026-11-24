import "server-only";

import { z } from "zod";

import { err, ok, type Result } from "@/lib/result";
import type { Actor } from "@/server/catalog/services";
import { pgError } from "@/server/db/errors";
import {
  countFaqs,
  deleteFaq,
  insertFaq,
  markQuestionAnswered,
  reorderFaqs,
  setAiEnabled,
  updateFaq,
} from "@/server/db/queries/ai";

/*
 * The AI receptionist page's server actions, minus reading the session:
 * authorise (owners only; RLS agrees), validate, write, and return Result
 * values with messages safe to show. Tested in tests/integration/ai-dashboard.test.ts.
 */

export const FAQ_LIMITS = { question: 200, answer: 1000, count: 50 } as const;

export const faqSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Add the question.")
    .max(FAQ_LIMITS.question, `Keep the question under ${FAQ_LIMITS.question} characters.`),
  answer: z
    .string()
    .trim()
    .min(1, "Add the answer.")
    .max(
      FAQ_LIMITS.answer,
      `Keep the answer under ${FAQ_LIMITS.answer.toLocaleString("en-US")} characters.`,
    ),
});

const OWNERS_ONLY = "Only owners can change the assistant. Ask an owner to make this change.";
const FAQ_GONE = "That answer no longer exists. Refresh to see the latest list.";
const idSchema = z.uuid();

type FaqError = "forbidden" | "invalid_input" | "not_found" | "limit";

function invalid(error: z.ZodError) {
  const { fieldErrors } = z.flattenError(error);
  const first = Object.values(fieldErrors).flat()[0] as string | undefined;
  return err("invalid_input", first ?? "Check the highlighted fields.", fieldErrors);
}

/** RLS refusing a write (42501) is the same answer as the role check. */
async function asOwner<T, E extends string>(
  actor: Actor,
  work: () => Promise<Result<T, E>>,
): Promise<Result<T, E | "forbidden">> {
  if (actor.role !== "owner") return err("forbidden", OWNERS_ONLY);
  try {
    return await work();
  } catch (error) {
    if (pgError(error).code === "42501") return err("forbidden", OWNERS_ONLY);
    throw error;
  }
}

/** Add an answer (no `faqId`) or change one. New chats use it right away. */
export async function saveFaq(
  actor: Actor,
  input: unknown,
  faqId?: string,
): Promise<Result<{ id: string }, FaqError>> {
  return asOwner(actor, async () => {
    if (faqId !== undefined && !idSchema.safeParse(faqId).success) {
      return err("not_found", FAQ_GONE);
    }
    const parsed = faqSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    if (faqId) {
      const found = await updateFaq(actor.claims, actor.businessId, faqId, parsed.data);
      return found ? ok({ id: faqId }) : err("not_found", FAQ_GONE);
    }
    if ((await countFaqs(actor.claims, actor.businessId)) >= FAQ_LIMITS.count) {
      return err(
        "limit",
        `You can have up to ${FAQ_LIMITS.count} answers. Remove one to add another.`,
      );
    }
    return ok({ id: await insertFaq(actor.claims, actor.businessId, parsed.data) });
  });
}

export async function removeFaq(
  actor: Actor,
  faqId: string,
): Promise<Result<null, "forbidden" | "not_found">> {
  return asOwner(actor, async () => {
    if (!idSchema.safeParse(faqId).success) return err("not_found", FAQ_GONE);
    return (await deleteFaq(actor.claims, actor.businessId, faqId))
      ? ok(null)
      : err("not_found", FAQ_GONE);
  });
}

/** `ids`: every answer, in the new order. */
export async function orderFaqs(
  actor: Actor,
  ids: unknown,
): Promise<Result<null, "forbidden" | "invalid_input">> {
  return asOwner(actor, async () => {
    const parsed = z.array(z.uuid()).max(FAQ_LIMITS.count).safeParse(ids);
    if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
      return err("invalid_input", "Refresh to see the latest list, then try again.");
    }
    return (await reorderFaqs(actor.claims, actor.businessId, parsed.data))
      ? ok(null)
      : err("invalid_input", "The list changed meanwhile. Refresh and try again.");
  });
}

/**
 * Turn the receptionist on or off. On needs the Pro plan: `ai_enabled` alone is
 * a preference, and the chat runs only when it's on **and** the plan is Pro.
 */
export async function switchAi(
  actor: Actor & { plan: "free" | "pro" },
  enabled: unknown,
): Promise<Result<{ enabled: boolean }, "forbidden" | "invalid_input" | "needs_pro">> {
  return asOwner(actor, async () => {
    if (typeof enabled !== "boolean") return err("invalid_input", "Choose on or off.");
    if (enabled && actor.plan !== "pro") {
      return err("needs_pro", "The AI receptionist is part of the Pro plan.");
    }
    return (await setAiEnabled(actor.claims, actor.businessId, enabled))
      ? ok({ enabled })
      : err("forbidden", OWNERS_ONLY);
  });
}

export async function answerQuestion(
  actor: Actor,
  questionId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<Result<null, "forbidden" | "not_found">> {
  if (actor.role !== "owner") {
    return err("forbidden", "Only owners can mark a question answered.");
  }
  if (!idSchema.safeParse(questionId).success) {
    return err("not_found", "That question is gone or already answered. Refresh to see it.");
  }
  return (await markQuestionAnswered(actor.claims, actor.businessId, questionId, now))
    ? ok(null)
    : err("not_found", "That question is gone or already answered. Refresh to see it.");
}
