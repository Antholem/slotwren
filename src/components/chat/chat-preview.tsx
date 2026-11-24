"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2, Send } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type ChatErrorBody,
  type ChatMessage,
  type ConfirmResponse,
  MAX_MESSAGE_CHARS,
  type ProposalCard,
} from "@/lib/chat";

/*
 * A plain chat box for trying the AI receptionist, shown on /b/[slug] only
 * when AI_CHAT_PREVIEW=1. The real chat UI (slot chips, styled cards) is step
 * 4.4. The browser keeps only the conversation id (in memory); the server
 * holds the transcript. Proposals show as a bare card whose Confirm button is
 * the only thing that books.
 */

/** A proposal from a propose* tool part, if this part is one. */
function proposalOf(part: ChatMessage["parts"][number]): ProposalCard | null {
  if (!part.type.startsWith("tool-propose") || !("state" in part)) return null;
  if (part.state !== "output-available") return null;
  const output = part.output as { status?: string; card?: ProposalCard } | undefined;
  return output?.status === "proposed" && output.card ? output.card : null;
}

const VERB = { book: "Book", reschedule: "Move", cancel: "Cancel" } as const;

function ConfirmCard({
  slug,
  conversationId,
  card,
}: {
  slug: string;
  conversationId: string | undefined;
  card: ProposalCard;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [result, setResult] = useState<string | null>(null);

  async function confirm() {
    if (!conversationId || state === "sending" || state === "done") return;
    setState("sending");
    try {
      const response = await fetch(`/api/chat/${slug}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, proposalId: card.proposalId }),
      });
      const body = (await response.json()) as ConfirmResponse;
      setState(body.ok ? "done" : "failed");
      setResult(
        body.ok
          ? body.message
          : [
              body.message,
              ...(body.alternatives ?? []).map((a) => `${a.when} with ${a.staff}`),
            ].join(" · "),
      );
    } catch {
      setState("failed");
      setResult("Sorry, something went wrong. Please try again.");
    }
  }

  return (
    <div className="rounded-xl border bg-background p-3 text-body-sm">
      <p className="font-medium">
        {VERB[card.kind]}: {card.service} with {card.staff}
      </p>
      <p className="font-mono tabular-nums">
        {card.previousWhen ? `${card.previousWhen} → ` : ""}
        {card.when} · {card.price}
      </p>
      <p>
        {card.customer.name} · {card.customer.email}
      </p>
      <p className="text-muted-foreground">
        Not {card.kind === "book" ? "booked" : "changed"} yet.
      </p>
      {result && (
        <p role="status" className="mt-2">
          {result}
        </p>
      )}
      {state !== "done" && (
        <Button
          type="button"
          onClick={confirm}
          disabled={state === "sending" || !conversationId}
          className="mt-2 h-11"
        >
          {state === "sending" && <Loader2 aria-hidden className="animate-spin" />} Confirm
        </Button>
      )}
    </div>
  );
}

/** The `message` of a refused request, or a generic line. */
function errorText(error: Error): string {
  try {
    const body = JSON.parse(error.message) as Partial<ChatErrorBody>;
    if (typeof body.message === "string") return body.message;
  } catch {
    // Not one of our JSON errors (network failure, stream error).
  }
  return "Sorry, something went wrong. Please try again.";
}

export function ChatPreview({ slug, businessName }: { slug: string; businessName: string }) {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: `/api/chat/${slug}`,
        // Only the new message and the id: the server replays the rest.
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages.at(-1);
          const text =
            last?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          return { body: { conversationId: body?.conversationId, text, timezone } };
        },
      }),
  );
  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport,
    onFinish: ({ message }) => {
      if (message.metadata?.conversationId) setConversationId(message.metadata.conversationId);
    },
  });
  const busy = status === "submitted" || status === "streaming";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void sendMessage({ text }, { body: { conversationId } });
  }

  return (
    <section aria-labelledby={`${inputId}-heading`} className="mx-auto mb-4 w-full max-w-6xl px-5">
      <div className="rounded-2xl border bg-card p-4">
        <h2 id={`${inputId}-heading`} className="text-title">
          Ask {businessName}{" "}
          <span className="text-body-sm text-muted-foreground">(AI preview)</span>
        </h2>
        <div role="log" aria-live="polite" aria-relevant="additions" className="my-3 space-y-2">
          {messages.length === 0 && (
            <p className="text-body-sm text-muted-foreground">
              Ask about services, prices, hours or the cancellation policy.
            </p>
          )}
          {messages.map((message) => (
            <div key={message.id} className="space-y-2">
              <p className="text-body whitespace-pre-wrap">
                <span className="font-medium">
                  {message.role === "user" ? "You" : "Assistant"}:{" "}
                </span>
                {message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}
              </p>
              {message.parts.map((part, i) => {
                const card = proposalOf(part);
                return card ? (
                  <ConfirmCard
                    key={card.proposalId ?? i}
                    slug={slug}
                    conversationId={conversationId ?? message.metadata?.conversationId}
                    card={card}
                  />
                ) : null;
              })}
            </div>
          ))}
          {status === "submitted" && (
            <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Thinking…
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-body-sm text-danger-text">
              {errorText(error)}
            </p>
          )}
        </div>
        <form onSubmit={submit} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor={inputId} className="sr-only">
              Your message
            </Label>
            <Input
              id={inputId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_MESSAGE_CHARS}
              placeholder="Type your question"
              autoComplete="off"
              className="h-11"
            />
          </div>
          <Button type="submit" disabled={busy || !draft.trim()} className="h-11">
            <Send aria-hidden /> Send
          </Button>
        </form>
      </div>
    </section>
  );
}
