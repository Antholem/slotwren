import {
  createUIMessageStreamResponse,
  type ModelMessage,
  type StepResult,
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
import {
  CAPPED_MESSAGE,
  CONVERSATION_LIMIT_MESSAGE,
  CONVERSATION_TOKEN_LIMIT,
  RESTING_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from "@/lib/ai-guardrails";
import {
  aiStoreReady,
  allowModelCall,
  checkBudget,
  describe,
  estimateCallTokens,
  isProviderLimited,
  releaseTokens,
  reserveTokens,
} from "@/server/ai/guardrails";
import { getChatModel } from "@/server/ai/model";
import { toChatMessages } from "@/server/ai/history";
import { systemPromptParts } from "@/server/ai/prompt";
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
import { clientIp, limitAll, rateLimit } from "@/server/rate-limit";
import { refuseCrossSite } from "@/server/same-site";

/*
 * POST /api/chat/<slug>  { conversationId?, text, timezone?, channel? }
 *
 * The AI receptionist. Public, no login. Grounded answers plus tools
 * (src/server/ai/tools.ts) that read availability and the customer's own
 * booking, and propose changes for a Confirm card; at most 5 model calls a
 * turn. Nothing is booked here: only /api/chat/<slug>/confirm does that, after
 * the customer's tap. Only from the app's own pages: JSON, and same-origin
 * when the browser says (src/server/same-site.ts).
 *
 * Guardrails (src/server/ai/guardrails.ts), before any model call:
 * - per IP: messages a minute and a day, and new chats a day; per business a minute;
 * - the business's monthly token budget (503 ai_resting at 100%; hand-off still
 *   works), with each call's estimated cost reserved first, so parallel
 *   messages can't overshoot it;
 * - each conversation's token limit (422 conversation_limit);
 * - the shared daily model-call cap and the business's quarter of it (503
 *   ai_unavailable), taken before every call; failing closed;
 * - on Vercel Production, a shared store (Upstash) for all of the above.
 * Costs are bounded: the last 12 turns, 5 model calls and a 400-token reply
 * per message. A provider refusing for load shows the polite "not available" line.
 *
 * Streams an AI SDK UI message stream; the first chunk's metadata carries the
 * conversation id for the next request. The transcript lives in
 * ai_conversations / ai_messages and is replayed to the model from there, so
 * the client never supplies history. Tool calls and results are saved with the
 * reply (ai_messages.parts) and replayed with it; a reply cut short (error,
 * timeout) is saved as far as it got, marked `interrupted`. Every call's usage
 * is saved, whatever happens. 404 when the business is unknown; 503 when its
 * AI is off (or it isn't on Pro) or no model is configured.
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
  // Where the chat is: the booking page, or the website widget's iframe.
  channel: z.enum(["page", "widget"]).optional().catch(undefined),
});

/** Model calls a turn may take (tool calls plus the answer), so the model can't loop. */
const MAX_STEPS = 5;
/** Longest reply, in tokens: a few sentences. */
const MAX_OUTPUT_TOKENS = 400;
/** Stored turns replayed to the model; the booking-status section covers what's older. */
const HISTORY_ROWS = 12;
/** Tool definitions ride along with every call: roughly this many characters. */
const TOOL_SCHEMA_CHARS = 4_000;

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
 * The system prompt as the provider takes it. Claude: the stable part (rules
 * and business data) as its own block marked for prompt caching, so later
 * messages and tool steps of this business read it from the cache.
 */
function instructionsFor(provider: string, { stable, live }: { stable: string; live: string }) {
  if (provider !== "anthropic") return `${stable}\n\n${live}`;
  return [
    {
      role: "system" as const,
      content: stable,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } },
    },
    { role: "system" as const, content: live },
  ];
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
  // Only from the app's own pages (the widget's iframe is one).
  const crossSite = refuseCrossSite(request);
  if (crossSite) return refuse(crossSite.status, "bad_request", crossSite.message);

  const { slug } = await params;
  const found = await chatBusiness(slug);
  if (found.refused) return found.refused;
  const { business } = found;
  const businessId = business.id;
  const ip = clientIp(request.headers);

  // A minute (IP and business), then the IP's messages today, however many chats.
  const minute = await rateLimit("chat", { ip, businessId });
  const limited = minute.ok ? await limitAll([["chat:ip:day", ip]]) : minute;
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
  // Production without the shared store would count every cap per instance: stay off.
  if (!aiStoreReady()) return refuse(503, "ai_unavailable", UNAVAILABLE_MESSAGE);

  // The business's monthly budget first (resting costs nothing).
  const budget = await checkBudget(businessId);
  if (budget.state === "exhausted") return refuse(503, "ai_resting", RESTING_MESSAGE);

  // An unknown id (or another business's) starts a new conversation: never append to it.
  const existing = parsed.data.conversationId
    ? await findConversation({ businessId, conversationId: parsed.data.conversationId })
    : null;
  if (existing && existing.userTurns >= MAX_TURNS) {
    return refuse(422, "conversation_limit", CONVERSATION_LIMIT_MESSAGE);
  }
  if (!existing) {
    // A new chat for every message resets nothing: chats per IP per day are counted too.
    const chats = await limitAll([["chat:conversations:ip", ip]]);
    if (!chats.ok) {
      return refuse(429, "rate_limited", chats.message, {
        "Retry-After": String(chats.retryAfterSec),
      });
    }
  }

  const context = await getAiContext({ businessId });
  if (!context) return notFound();

  const [history, proposals] = existing
    ? await Promise.all([
        loadTranscript({ businessId, conversationId: existing.id, limit: HISTORY_ROWS }),
        listProposalOutcomes({ businessId, conversationId: existing.id }),
      ])
    : [[], []];
  // Retry after a failed reply: the same message is already the last turn.
  const retry = existing?.retryText === text;
  const messages: ModelMessage[] = retry ? history : [...history, { role: "user", content: text }];
  const now = new Date();
  const customerTimezone = parsed.data.timezone ?? context.business.timezone;
  const prompt = systemPromptParts(context, now, { customerTimezone, proposals });

  // What one call may cost: reserved before each call, released once the usage is saved.
  const perCall = estimateCallTokens(
    prompt.stable.length + prompt.live.length + JSON.stringify(messages).length + TOOL_SCHEMA_CHARS,
    MAX_OUTPUT_TOKENS,
  );
  const conversationTokens = existing?.tokens ?? 0;
  if (existing && conversationTokens + perCall > CONVERSATION_TOKEN_LIMIT) {
    return refuse(422, "conversation_limit", CONVERSATION_LIMIT_MESSAGE);
  }
  const first = await reserveTokens(businessId, perCall, budget);
  if (first === "over_budget") return refuse(503, "ai_resting", RESTING_MESSAGE);
  if (first === "unavailable") return refuse(503, "ai_unavailable", UNAVAILABLE_MESSAGE);
  let reserved = perCall;
  // The shared cap (and this business's share of it): this takes the turn's first call.
  if (!(await allowModelCall(businessId))) {
    await releaseTokens(businessId, reserved);
    return refuse(503, "ai_unavailable", UNAVAILABLE_MESSAGE);
  }

  const conversationId =
    existing?.id ??
    (await startConversation({ businessId, channel: parsed.data.channel ?? "page" }));
  if (!retry) await saveMessage({ businessId, conversationId, role: "user", content: text });
  const log = { businessId, conversationId, provider: chat.provider, model: chat.modelId };

  // Every finished step: the saved reply and its usage, however the turn ends.
  const steps: StepResult<ToolSet>[] = [];
  const tokensOf = (key: "inputTokens" | "outputTokens") =>
    steps.reduce((n, step) => n + (step.usage[key] ?? 0), 0);
  let capped = false;

  /**
   * Save what the turn produced, once: the reply, or (cut short) the steps it
   * got through, so a Confirm card survives a refresh; always its usage. Then
   * hand back the reserved tokens.
   */
  let settled: Promise<void> | null = null;
  const settle = (complete: boolean) =>
    (settled ??= (async () => {
      const inputTokens = tokensOf("inputTokens");
      const outputTokens = tokensOf("outputTokens");
      const reply = [
        ...steps.map((step) => step.text.trim()),
        complete && capped ? CAPPED_MESSAGE : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const usedTools = steps.some((step) => step.toolCalls.length > 0);
      try {
        if (reply || usedTools) {
          await saveMessage({
            businessId,
            conversationId,
            role: "assistant",
            content: reply,
            // Text, tool calls and tool results, for the replay and the transcript.
            parts: steps.flatMap((step) => step.response.messages),
            inputTokens,
            outputTokens,
            interrupted: !complete,
          });
        } else {
          if (complete) console.warn("[ai-chat] Empty reply", log);
          // Nothing to show, but the tokens were spent: a usage-only row counts them.
          if (inputTokens + outputTokens > 0) {
            await saveMessage({
              businessId,
              conversationId,
              role: "system",
              content: "",
              inputTokens,
              outputTokens,
            });
          }
        }
      } catch (error) {
        console.error("[ai-chat] Saving the reply failed", log, describe(error));
      } finally {
        await releaseTokens(businessId, reserved);
      }
    })());

  const result = streamText({
    model: chat.model,
    instructions: instructionsFor(chat.provider, prompt),
    messages,
    // Bound to this business and conversation here, never by the model.
    tools: receptionistTools({ businessId, conversationId, customerTimezone, now }),
    // Each further step is another model call: at most MAX_STEPS, and only
    // while the conversation's limit, the budget (reserved again) and the
    // shared cap allow. Stopped by one of those, the reply ends politely.
    stopWhen: async ({ steps: done }) => {
      if (done.length >= MAX_STEPS) return true;
      const spent = tokensOf("inputTokens") + tokensOf("outputTokens");
      if (conversationTokens + spent + perCall <= CONVERSATION_TOKEN_LIMIT) {
        if ((await reserveTokens(businessId, perCall, budget)) === "reserved") {
          reserved += perCall;
          if (await allowModelCall(businessId)) return false;
        }
      }
      capped = true;
      return true;
    },
    timeout: { totalMs: chat.timeoutMs },
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    onStepFinish: (step) => {
      steps.push(step);
    },
    onError: async ({ error }) => {
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
      await settle(false);
    },
    onAbort: async () => {
      console.error("[ai-chat] Model timed out", log, `${chat.timeoutMs} ms`);
      await settle(false);
    },
    onEnd: async () => {
      await settle(true);
    },
  });
  // Run to the end (and save the reply) even if the customer closes the chat,
  // and settle whatever happened, so the reservation is always released.
  void Promise.resolve(result.consumeStream())
    .catch(() => {})
    .finally(() => settle(false));

  return createUIMessageStreamResponse({
    // The id in a header too, so the chat has it even when the reply fails.
    headers: { ...NO_STORE, "X-Conversation-Id": conversationId },
    stream: toUIMessageStream<ToolSet, ChatMessage>({
      // A timeout arrives as an abort, which the chat would end silently: show it as an error.
      stream: result.stream.pipeThrough(
        new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
          transform(part, controller) {
            if (part.type === "finish" && capped) {
              // Stopped between tool steps by a limit: say so, don't just go quiet.
              controller.enqueue({ type: "text-start", id: "capped" });
              controller.enqueue({ type: "text-delta", id: "capped", text: CAPPED_MESSAGE });
              controller.enqueue({ type: "text-end", id: "capped" });
            }
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
