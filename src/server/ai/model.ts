import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import { env, type ServerEnv } from "@/env";

/*
 * The AI receptionist's model. AI_PROVIDER picks the provider and AI_MODEL the
 * model, so switching (Gemini now, Claude later) is a config change, not a code
 * change. Keys are passed explicitly from the validated env, never read from
 * process.env by the SDK.
 */

export type AiProvider = ServerEnv["AI_PROVIDER"];

/**
 * Used when AI_MODEL is unset. Gemini: Flash-Lite, the free-tier model with the
 * most requests a day (~500, vs ~20 for 3.8 Flash) that handles tool calls.
 */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-haiku-5-5",
};

export type ChatModelConfig = { provider: AiProvider; modelId: string; apiKey: string };

/** Which model to use, or null when the provider's key is missing. */
export function chatModelConfig(
  e: Pick<
    ServerEnv,
    "AI_PROVIDER" | "AI_MODEL" | "GOOGLE_GENERATIVE_AI_API_KEY" | "ANTHROPIC_API_KEY"
  >,
): ChatModelConfig | null {
  const provider = e.AI_PROVIDER;
  const apiKey = provider === "gemini" ? e.GOOGLE_GENERATIVE_AI_API_KEY : e.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { provider, modelId: e.AI_MODEL ?? DEFAULT_MODELS[provider], apiKey };
}

export type ChatModel = {
  model: LanguageModel;
  provider: AiProvider;
  modelId: string;
  /** Longest a reply may take before the customer sees an error instead. */
  timeoutMs: number;
};

/** A stalled provider ends in an error message, not an endless spinner. */
export const CHAT_TIMEOUT_MS = 45_000;

/**
 * The chat model, or null when AI isn't configured (no key): the chat route
 * answers 503 rather than failing mid-stream.
 */
export function getChatModel(): ChatModel | null {
  const config = chatModelConfig(env);
  if (!config) return null;
  const { provider, modelId, apiKey } = config;
  // No thinking override: Gemini 3.x Flash defaults to "low" through the SDK,
  // and rejects "minimal" (it differs by model, so leave it to the provider).
  const model =
    provider === "gemini"
      ? createGoogle({ apiKey })(modelId)
      : createAnthropic({ apiKey })(modelId);
  return { model, provider, modelId, timeoutMs: CHAT_TIMEOUT_MS };
}
