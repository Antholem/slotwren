"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2, Send } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ChatErrorBody, type ChatMessage, MAX_MESSAGE_CHARS } from "@/lib/chat";

/*
 * A plain chat box for trying the AI receptionist (steps 4.1–4.2), shown on
 * /b/[slug] only when AI_CHAT_PREVIEW=1. The real chat UI is step 4.4. The
 * browser keeps only the conversation id (in memory); the server holds the
 * transcript.
 */

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
          return { body: { conversationId: body?.conversationId, text } };
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
            <p key={message.id} className="text-body whitespace-pre-wrap">
              <span className="font-medium">{message.role === "user" ? "You" : "Assistant"}: </span>
              {message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}
            </p>
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
