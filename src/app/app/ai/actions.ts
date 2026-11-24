"use server";

import { refresh } from "next/cache";

import { getDashboardContext } from "@/server/auth/dashboard";
import { getBusinessPlan } from "@/server/db/queries/ai";
import { answerQuestion, orderFaqs, removeFaq, saveFaq, switchAi } from "@/server/catalog/ai";

/*
 * The AI receptionist page's actions (and "Mark answered" on a customer's
 * profile). Owners only: the catalog checks the role, RLS checks again.
 */

async function actor() {
  const { claims, business, role } = await getDashboardContext();
  return { claims, businessId: business.id, role };
}

export async function switchAiAction(enabled: boolean) {
  const { claims, business, role } = await getDashboardContext();
  const plan = (await getBusinessPlan(claims, business.id)) ?? "free";
  const result = await switchAi({ claims, businessId: business.id, role, plan }, enabled);
  if (result.ok) refresh();
  return result;
}

export async function saveFaqAction(input: unknown, faqId?: string) {
  const result = await saveFaq(await actor(), input, faqId);
  if (result.ok) refresh();
  return result;
}

export async function removeFaqAction(faqId: string) {
  const result = await removeFaq(await actor(), faqId);
  if (result.ok) refresh();
  return result;
}

export async function orderFaqsAction(ids: string[]) {
  const result = await orderFaqs(await actor(), ids);
  if (result.ok) refresh();
  return result;
}

export async function answerQuestionAction(questionId: string) {
  const result = await answerQuestion(await actor(), questionId);
  if (result.ok) refresh();
  return result;
}
