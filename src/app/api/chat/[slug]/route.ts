import {
  createUIMessageStreamResponse,
  isStepCount,
  type ModelMessage,
  streamText,
  toUIMessageStream,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import { z } from "zod";

import {
  CHAT_OFF_MESSAGE,
  type ChatErrorBody,
  type ChatHistory,
  type ChatMessage,
  MAX_MESSAGE_CHARS,
  MAX_TURNS,
} from "@/lib/chat";
import { SLUG_PATTERN } from "@/lib/slug";
import { isValidTimeZone } from "@/lib/timezones";
import { RESTING_MESSAGE, UNAVAILABLE_MESSAGE } from "@/lib/ai-guardrails";
import { checkBudget, describe, isProviderLimited, withinDailyCap } from "@/server/ai/guardrails";
import { getChatModel } from "@/server/ai/model";
import { toChatMessages } from "@/server/ai/history";
import { buildSystemPrompt } from "@/server/ai/prompt";
import { receptionistTools } from "@/server/ai/tools";
import {
  findConversation,
  getAiContext,
  loadHistoryRows,
  loadTranscript,
  saveMessage,
  startConversation,
} from "@/server/db/queries/public/ai-chat";
import { recordGuardrailEvent } from "@/server/db/queries/public/ai-guardrails";
import { listProposalOutcomes } from "@/server/db/queries/public/ai-proposals";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";
import { clientIp, rateLimit } from "@/server/rate-limit";

/*
 * POST /api/chat/<slug>  { conversationId?, text, timezone? }
 *
 * The AI receptionist. Public, no login. Grounded answers plus tools
 * (src/server/ai/tools.ts) that read availability and the customer's own
 * booking, and propose changes for a Confirm card; at most 6 steps a turn. Nothing is
 * booked here: only /api/chat/<slug>/confirm does that, after the customer's tap.
 *
 * Guardrails (step 4.6, src/server/ai/guardrails.ts), before any model call:
 * the business's monthly token budget (503 ai_resting at 100%; hand-off still
 * works) and the shared daily cap (503 ai_unavailable). Costs are bounded: the
 * last 12 turns, 5 model calls and a 400-token reply per message.
 * A provider refusing for load shows the polite "not available" line.
 *
 * Streams an AI SDK UI message stream; the first chunk's metadata
 * carries the conversation id for the next request. The transcript lives in
 * ai_conversations / ai_messages and is replayed to the model from there, so
 * the client never supplies history. Tool calls and results are saved with the
 * reply (ai_messages.parts) and replayed with it. 404 when the business is unknown or its
 * AI is off (or it isn't on Pro); 503 when no model is configured.
 *
 * Never logs prompts, messages or keys: errors are logged by name and HTTP
 * status with the business and conversation ids.
 */

const MAX_BODY_BYTES = 16 * 1024;

const body = z.object({
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1),
  // The customer's zone, for offered times. Unknown or junk: the business's.
  timezone: z.string().max(64).refine(isValidTimeZone).optional().catch(undefined),
});

/** Model calls a turn may take (tool calls plus the answer), so the model can't loop. */
const MAX_STEPS = 5;
/** Longest reply, in tokens: a few sentences. */
const MAX_OUTPUT_TOKENS = 400;
/** Stored turns replayed to the model; the booking-status section covers what's older. */
const HISTORY_ROWS = 12;

const NO_STORE = { "Cache-Control": "no-store" };

const refuse = (status: number, error: ChatErrorBody["error"], message: string, headers = {}) =>
  Response.json({ error, message } satisfies ChatErrorBody, {
    status,
    headers: { ...NO_STORE, ...headers },
  });

const notFound = () => refuse(404, "not_found", "Not found");

/** The business exists but its receptionist is off (or it isn't on Pro): say so politely. */
const chatOff = () => refuse(503, "ai_unavailable", CHAT_OFF_MESSAGE);

/** 404 for an unknown business, 503 when its chat is off, else the business. */
async function chatBusiness(slug: string) {
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  if (!business) return { refused: notFound() } as const;
  if (!business.aiEnabled) return { refused: chatOff() } as const;
  return { business } as const;
}

/**
 * GET /api/chat/<slug>?conversationId=…  The conversation so far, for the chat
 * after a page refresh (the browser keeps only the id, in sessionStorage).
 * An unknown id, or another business's, is a 404.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/chat/[slug]">) {
  const { slug } = await params;
  const found = await chatBusiness(slug);
  if (found.refused) return found.refused;
  const { business } = found;
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("conversationId"));
  if (!id.success) return notFound();
  const limited = await rateLimit("slots", {
    ip: clientIp(request.headers),
    businessId: business.id,
  });
  if (!limited.ok) {
    return refuse(429, "rate_limited", limited.message, {
      "Retry-After": String(limited.retryAfterSec),
    });
  }
  const existing = await findConversation({ businessId: business.id, conversationId: id.data });
  if (!existing) return notFound();
  const rows = await loadHistoryRows({ businessId: business.id, conversationId: existing.id });
  return Response.json(
    { conversationId: existing.id, messages: toChatMessages(rows) } satisfies ChatHistory,
    { headers: NO_STORE },
  );
}

export async function POST(request: Request, { params }: RouteContext<"/api/chat/[slug]">) {
  const { slug } = await params;
  const found = await chatBusiness(slug);
  if (found.refused) return found.refused;
  const { business } = found;
  const businessId = business.id;

  const limited = await rateLimit("chat", { ip: clientIp(request.headers), businessId });
  if (!limited.ok) {
    return refuse(429, "rate_limited", limited.message, {
      "Retry-After": String(limited.retryAfterSec),
    });
  }

  // Measured, not trusted from Content-Length (absent on chunked bodies).
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return refuse(413, "message_too_long", "That message is too long.");
  }
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Not JSON: refused below.
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) return refuse(400, "bad_request", "Type a message to send.");
  const { text } = parsed.data;
  if (text.length > MAX_MESSAGE_CHARS) {
    return refuse(
      400,
      "message_too_long",
      `Messages can be up to ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`,
    );
  }

  const chat = await getChatModel();
  if (!chat) {
    return refuse(
      503,
      "ai_unavailable",
      "The assistant isn't available right now. Please try later.",
    );
  }

  // The business's monthly budget first (resting costs nothing), then the shared cap.
  const budget = await checkBudget(businessId);
  if (budget.state === "exhausted") return refuse(503, "ai_resting", RESTING_MESSAGE);
  if (!(await withinDailyCap(businessId))) {
    return refuse(503, "ai_unavailable", UNAVAILABLE_MESSAGE);
  }

  // An unknown id (or another business's) starts a new conversation: never append to it.
  const existing = parsed.data.conversationId
    ? await findConversation({ businessId, conversationId: parsed.data.conversationId })
    : null;
  if (existing && existing.userTurns >= MAX_TURNS) {
    return refuse(
      422,
      "conversation_limit",
      "This chat has reached its limit. Start a new chat to keep going.",
    );
  }

  const context = await getAiContext({ businessId });
  if (!context) return notFound();

  const conversationId = existing?.id ?? (await startConversation({ businessId, channel: "page" }));
  const [history, proposals] = existing
    ? await Promise.all([
        loadTranscript({ businessId, conversationId, limit: HISTORY_ROWS }),
        listProposalOutcomes({ businessId, conversationId }),
      ])
    : [[], []];
  // Retry after a failed reply: the same message is already the last turn.
  const last = history.at(-1);
  const retry = last?.role === "user" && last.content === text;
  if (!retry) await saveMessage({ businessId, conversationId, role: "user", content: text });

  const messages: ModelMessage[] = retry ? history : [...history, { role: "user", content: text }];
  const log = { businessId, conversationId, provider: chat.provider, model: chat.modelId };
  const now = new Date();
  const customerTimezone = parsed.data.timezone ?? context.business.timezone;

  const result = streamText({
    model: chat.model,
    instructions: buildSystemPrompt(context, now, { customerTimezone, proposals }),
    messages,
    // Bound to this business and conversation here, never by the model.
    tools: receptionistTools({ businessId, conversationId, customerTimezone, now }),
    stopWhen: isStepCount(MAX_STEPS),
    timeout: { totalMs: chat.timeoutMs },
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    onError: ({ error }) => {
      const limited = isProviderLimited(error);
      console.error(
        limited
          ? "[ai-chat] Provider refused (rate limit, quota or overload)"
          : "[ai-chat] Model stream failed",
        log,
        describe(error),
      );
      if (limited) {
        void recordGuardrailEvent({
          businessId,
          kind: "provider_limited",
          detail: { provider: chat.provider, ...describe(error) },
        }).catch(() => {});
      }
    },
    onAbort: () => console.error("[ai-chat] Model timed out", log, `${chat.timeoutMs} ms`),
    onEnd: async ({ steps, responseMessages, totalUsage }) => {
      const reply = steps
        .map((step) => step.text.trim())
        .filter(Boolean)
        .join("\n\n");
      if (!reply && !steps.some((step) => step.toolCalls.length > 0)) {
        console.warn("[ai-chat] Empty reply", log);
        return;
      }
      try {
        await saveMessage({
          businessId,
          conversationId,
          role: "assistant",
          content: reply,
          // Text, tool calls and tool results, for the replay and the transcript.
          parts: responseMessages,
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
        });
      } catch (error) {
        console.error("[ai-chat] Saving the reply failed", log, describe(error));
      }
    },
  });
  // Run to the end (and save the reply) even if the customer closes the chat.
  void result.consumeStream();

  return createUIMessageStreamResponse({
    // The id in a header too, so the chat has it even when the reply fails.
    headers: { ...NO_STORE, "X-Conversation-Id": conversationId },
    stream: toUIMessageStream<ToolSet, ChatMessage>({
      // A timeout arrives as an abort, which the chat would end silently: show it as an error.
      stream: result.stream.pipeThrough(
        new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
          transform(part, controller) {
            controller.enqueue(
              part.type === "abort" ? { type: "error", error: new Error("Timed out") } : part,
            );
          },
        }),
      ),
      sendReasoning: false,
      messageMetadata: ({ part }) => (part.type === "start" ? { conversationId } : undefined),
      // Never a raw provider error: the polite line when it's refusing for load.
      onError: (error) =>
        isProviderLimited(error)
          ? UNAVAILABLE_MESSAGE
          : "Sorry, something went wrong on our side. Please try again.",
    }),
  });
}
