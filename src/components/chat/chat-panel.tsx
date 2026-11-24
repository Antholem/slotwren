"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ChevronDown, RotateCcw, SendHorizontal, Sparkle, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type RefObject, useEffect, useId, useRef, useState } from "react";

import { BusinessMark } from "@/components/booking/booking-layout";
import { rememberManageToken } from "@/components/booking/manage-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMediaQuery } from "@/hooks/use-media-query";
import type {
  ChatDataParts,
  ChatErrorBody,
  ChatHistory,
  ChatMessage,
  ConfirmFailure,
  ConfirmSuccess,
  OfferedTime,
  ProposalCard,
} from "@/lib/chat";
import { CHAT_OFF_MESSAGE, MAX_MESSAGE_CHARS } from "@/lib/chat";
import { formatInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";

import {
  BookedCard,
  ConfirmCard,
  HandoffForm,
  SlotChips,
  ToolStatus,
  TypingDots,
} from "./chat-parts";
import { forgetConversationId, readConversationId, rememberConversationId } from "./chat-storage";

/*
 * The AI receptionist's chat (docs/design/ai-receptionist): a side panel on
 * desktop (the page stays usable beside it) and a bottom sheet on phones (a
 * modal: focus stays inside, Escape closes, focus returns to the button).
 *
 * - The browser keeps only the conversation id (sessionStorage); after a
 *   refresh the conversation comes back from the server.
 * - Replies stream into the log; screen readers hear each reply once it has
 *   finished (one polite announcement), not every token.
 * - Times arrive as chips: tapping one asks for that time. Proposals show as
 *   Confirm cards; only the customer's tap books (CLAUDE.md, rule 7).
 */

export type ChatPanelProps = {
  slug: string;
  business: { name: string; logoUrl: string | null };
  /** For the "Book a …" suggestion. */
  firstService: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  launcherRef: RefObject<HTMLButtonElement | null>;
  /** A reply arrived while the chat was closed. */
  onUnread: () => void;
};

type Part = ChatMessage["parts"][number];
type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
};
type Confirmation = ChatDataParts["confirmation"];

const isTool = (part: Part): part is Part & ToolPart => part.type.startsWith("tool-");
const textOf = (message: ChatMessage) =>
  message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();

/** The `message` of a refused request, or a generic line. */
/** The receptionist was switched off (503 ai_unavailable). */
function chatIsOff(error: Error | undefined): boolean {
  if (!error) return false;
  try {
    return (JSON.parse(error.message) as Partial<ChatErrorBody>).error === "ai_unavailable";
  } catch {
    return false;
  }
}

function errorText(error: Error): string {
  try {
    const body = JSON.parse(error.message) as Partial<ChatErrorBody>;
    if (typeof body.message === "string") return body.message;
  } catch {
    // A stream error or a network failure.
  }
  return "Sorry, something went wrong on our side. Please try again.";
}

const dayName = (date: unknown, pattern: string) =>
  typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? formatInZone(new Date(`${date}T12:00:00Z`), "UTC", pattern)
    : null;

const customerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function useReducedMotion() {
  return useMediaQuery("(prefers-reduced-motion: reduce)", true);
}

export function ChatPanel({
  slug,
  business,
  firstService,
  open,
  onOpenChange,
  launcherRef,
  onUnread,
}: ChatPanelProps) {
  const desktop = useMediaQuery("(min-width: 64rem)", true);
  const reducedMotion = useReducedMotion();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  // The conversation id, read by the transport and the cards (not render state).
  const [session] = useState(() => ({ id: readConversationId(slug) }));
  const [history, setHistory] = useState<"loading" | "ready">(session.id ? "loading" : "ready");
  const [greetedAt] = useState(() => formatInZone(new Date(), customerZone(), "HH:mm"));
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: `/api/chat/${slug}`,
        // The server names the conversation in a header, even when the reply fails.
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const conversation = response.headers.get("x-conversation-id");
          if (conversation) {
            session.id = conversation;
            rememberConversationId(slug, conversation);
          }
          return response;
        },
        // Only the newest customer message and the id: the server replays the rest.
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages.findLast((m) => m.role === "user");
          return {
            body: {
              conversationId: session.id ?? undefined,
              text: last ? textOf(last) : "",
              timezone: customerZone(),
            },
          };
        },
      }),
  );

  const { messages, setMessages, sendMessage, regenerate, status, error } = useChat<ChatMessage>({
    transport,
    onFinish: ({ message }) => {
      const said = textOf(message);
      const proposal = message.parts.some(
        (p) => isTool(p) && (p as ToolPart).output?.status === "proposed",
      );
      setAnnouncement(
        [said, proposal ? "Check the details, then confirm." : ""].filter(Boolean).join(" ") ||
          "The assistant replied.",
      );
      if (!openRef.current) onUnread();
    },
    onError: () => setAnnouncement("The reply failed. You can retry."),
  });
  const busy = status === "submitted" || status === "streaming";
  // Switched off by the business: say so, keep the page's own booking flow.
  const [offAtLoad, setOffAtLoad] = useState(false);
  const off = offAtLoad || (status === "error" && chatIsOff(error));

  // After a refresh: the conversation so far, from the server.
  useEffect(() => {
    if (!session.id) return;
    const controller = new AbortController();
    fetch(`/api/chat/${slug}?conversationId=${session.id}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          const body = (await response.json()) as ChatHistory;
          setMessages(body.messages);
        } else if (response.status === 503) {
          setOffAtLoad(true);
        } else if (response.status === 404) {
          forgetConversationId(slug);
          session.id = null;
        }
      })
      .catch(() => {
        // Offline or aborted: start from the greeting.
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistory("ready");
      });
    return () => controller.abort();
  }, [slug, session, setMessages]);

  // Keep the newest message in view.
  useEffect(() => {
    const log = logRef.current;
    if (!log || !open) return;
    log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }, [messages, status, open, reducedMotion]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || off) return;
    void sendMessage({ text: trimmed });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    send(draft);
    setDraft("");
  }

  const pick = (t: OfferedTime) => send(`${t.day}, ${t.time} with ${t.staff}, please`);

  /** Confirm succeeded: the booked card, and the manage link kept for this tab. */
  function confirmed(result: ConfirmSuccess, proposalId: string) {
    if (result.manageToken) rememberManageToken(result.bookingId, result.manageToken);
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          { type: "text", text: result.message },
          {
            type: "data-confirmation",
            data: {
              proposalId,
              kind: result.kind,
              confirmed: true,
              card: result.card,
            },
          },
        ],
      },
    ]);
    setAnnouncement(result.message);
  }

  /** "Just taken": fresh times as chips under the card. */
  function failed(failure: ConfirmFailure, proposalId: string) {
    setAnnouncement(failure.message);
    if (failure.error !== "slot_taken") return;
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          { type: "text", text: failure.message },
          {
            type: "data-confirmation",
            data: {
              proposalId,
              kind: "book",
              confirmed: false,
              error: failure.error,
              alternatives: failure.alternatives ?? [],
            },
          },
        ],
      },
    ]);
  }

  // What happened to each proposal and hand-off, from later messages.
  const settled = new Map<string, Confirmation>();
  const handoffSentAfter = new Set<number>();
  messages.forEach((message, index) => {
    for (const part of message.parts) {
      if (part.type === "data-confirmation" && part.data.proposalId) {
        settled.set(part.data.proposalId, part.data);
      }
      if (part.type === "data-handoff") handoffSentAfter.add(index);
    }
  });
  const handoffSent = (index: number) => [...handoffSentAfter].some((i) => i > index);
  const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");

  function renderPart(part: Part, key: string, index: number, message: ChatMessage) {
    const current = index === lastAssistant && !busy;
    if (part.type === "text") {
      // A confirmation's text is said by its card.
      const confirmedCard = message.parts.some(
        (p) => p.type === "data-confirmation" && p.data.confirmed,
      );
      if (!part.text.trim() || confirmedCard) return null;
      return (
        <p
          key={key}
          className="max-w-[85%] rounded-2xl border bg-card px-4 py-3 text-body whitespace-pre-wrap"
        >
          {part.text}
        </p>
      );
    }
    if (part.type === "data-confirmation") {
      const data = part.data;
      if (data.confirmed && data.card) return <BookedCard key={key} booked={data.card} />;
      if (data.alternatives?.length) {
        return <SlotChips key={key} times={data.alternatives} disabled={!current} onPick={pick} />;
      }
      return null;
    }
    if (!isTool(part)) return null;
    const tool = part as ToolPart;
    const name = tool.type.slice("tool-".length);
    const done = tool.state === "output-available";
    const output = tool.output;

    if (name === "checkAvailability") {
      const day = dayName(tool.input?.date, "EEEE d MMM");
      const times = output?.status === "ok" ? ((output.times as OfferedTime[]) ?? []) : [];
      return (
        <div key={key} className="flex flex-col gap-3">
          <ToolStatus
            done={done}
            label={
              done
                ? `Checked ${day ?? "availability"}`
                : `Checking ${dayName(tool.input?.date, "EEEE") ?? "availability"}…`
            }
          />
          {done && <SlotChips times={times.slice(0, 6)} disabled={!current} onPick={pick} />}
        </div>
      );
    }
    if (name === "lookUpBooking") {
      return (
        <ToolStatus
          key={key}
          done={done}
          label={done ? "Looked up your booking" : "Looking up your booking…"}
        />
      );
    }
    if (name === "listServices") {
      return (
        <ToolStatus
          key={key}
          done={done}
          label={done ? "Checked services" : "Checking services…"}
        />
      );
    }
    if (name.startsWith("propose")) {
      if (!done) return <ToolStatus key={key} done={false} label="Preparing the details…" />;
      if (output?.status === "proposed") {
        const card = output.card as ProposalCard;
        const outcome = settled.get(card.proposalId);
        return (
          <ConfirmCard
            key={key}
            slug={slug}
            card={card}
            conversationId={() => session.id}
            settled={
              outcome
                ? outcome.confirmed
                  ? { state: "confirmed" }
                  : {
                      state: "failed",
                      failure: {
                        ok: false,
                        error: outcome.error ?? "bad_request",
                        message:
                          outcome.error === "slot_taken"
                            ? "That time was just taken."
                            : "Nothing was changed.",
                      },
                    }
                : null
            }
            onConfirmed={(result) => confirmed(result, card.proposalId)}
            onFailed={(failure) => failed(failure, card.proposalId)}
            onChange={() => send("I'd like a different time, please.")}
          />
        );
      }
      const alternatives = (output?.alternatives as OfferedTime[] | undefined) ?? [];
      return alternatives.length ? (
        <SlotChips key={key} times={alternatives} disabled={!current} onPick={pick} />
      ) : null;
    }
    if (name === "offerHandoff" && done) {
      return (
        <HandoffForm
          key={key}
          slug={slug}
          businessName={business.name}
          question={String(output?.question ?? "")}
          conversationId={() => session.id}
          sent={handoffSent(index)}
          onSent={(message) => {
            setMessages((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                parts: [
                  { type: "text", text: message },
                  { type: "data-handoff", data: { sent: true } },
                ],
              },
            ]);
            setAnnouncement(message);
          }}
        />
      );
    }
    return null;
  }

  const suggestions = [
    ...(firstService ? [`Book a ${firstService.toLowerCase()}`] : []),
    "Prices",
    "Opening hours",
  ];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={!desktop}>
      <DialogPrimitive.Portal>
        {!desktop && (
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0" />
        )}
        <DialogPrimitive.Content
          aria-describedby={`${id}-note`}
          // Desktop: a panel beside the page, not a modal; clicks outside leave it open.
          onInteractOutside={desktop ? (event) => event.preventDefault() : undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            launcherRef.current?.focus();
          }}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border bg-background text-foreground shadow-xl outline-none",
            desktop
              ? "right-6 bottom-24 h-[min(42rem,calc(100dvh-8rem))] w-[26rem] rounded-2xl"
              : "inset-x-0 bottom-0 h-[92dvh] rounded-t-2xl",
            "motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0",
            !desktop && "motion-safe:data-open:slide-in-from-bottom-8",
          )}
        >
          <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
            <BusinessMark business={business} className="size-11 text-label" />
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-title">
                {business.name}
              </DialogPrimitive.Title>
              <p className="flex items-center gap-1 text-body-sm text-muted-foreground">
                <Sparkle aria-hidden className="size-3.5 text-primary" /> AI assistant
              </p>
            </div>
            {desktop && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                onClick={() => onOpenChange(false)}
              >
                <ChevronDown aria-hidden className="size-5" />
                <span className="sr-only">Minimise chat</span>
              </Button>
            )}
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="size-11">
                <X aria-hidden className="size-5" />
                <span className="sr-only">Close chat</span>
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div
            ref={logRef}
            role="log"
            aria-live="off"
            aria-label="Conversation"
            aria-busy={busy || history === "loading"}
            className="flex flex-1 flex-col gap-3 overflow-y-auto bg-background px-4 py-4"
          >
            <p className="mt-auto text-center text-body-sm text-muted-foreground">
              Today <span className="font-mono tabular-nums">{greetedAt}</span>
            </p>
            <p className="flex items-center gap-1 text-label text-primary">
              <Sparkle aria-hidden className="size-4" /> {business.name}&apos;s assistant
            </p>
            <p className="max-w-[85%] rounded-2xl border bg-card px-4 py-3 text-body">
              Hi! I&apos;m {business.name}&apos;s assistant. I can answer questions or book you in.
            </p>
            {history === "loading" && (
              <div aria-hidden className="flex flex-col gap-3">
                <span className="h-12 w-2/3 self-end rounded-2xl bg-muted motion-safe:animate-pulse" />
                <span className="h-16 w-3/4 rounded-2xl bg-muted motion-safe:animate-pulse" />
              </div>
            )}
            {history === "ready" && messages.length === 0 && (
              <ul aria-label="Suggestions" className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => send(s)}
                      className="min-h-11 rounded-full border border-input bg-card px-4 text-body outline-none hover:border-primary focus-visible:ring-[3px] focus-visible:ring-ring"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {messages.map((message, index) =>
              message.role === "user" ? (
                <p
                  key={message.id}
                  className="max-w-[85%] self-end rounded-2xl bg-primary px-4 py-3 text-body whitespace-pre-wrap text-primary-foreground"
                >
                  <span className="sr-only">You: </span>
                  {textOf(message)}
                </p>
              ) : (
                <div key={message.id} className="flex flex-col gap-3">
                  {message.parts.map((part, i) =>
                    renderPart(part, `${message.id}-${i}`, index, message),
                  )}
                </div>
              ),
            )}
            {status === "submitted" && <TypingDots />}
            {off && (
              <p role="status" className="rounded-2xl border bg-card px-4 py-3 text-body">
                {CHAT_OFF_MESSAGE}
              </p>
            )}
            {status === "error" && error && !off && (
              <div
                role="alert"
                className="flex flex-col gap-3 rounded-2xl border border-danger bg-card p-4"
              >
                <p className="text-body text-danger-text">{errorText(error)}</p>
                <Button
                  type="button"
                  className="h-11 w-fit text-body"
                  onClick={() => void regenerate()}
                >
                  <RotateCcw aria-hidden /> Retry
                </Button>
              </div>
            )}
          </div>

          <div aria-live="polite" className="sr-only">
            {announcement}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-2 border-t bg-card px-4 pt-3 pb-3">
            <div className="flex items-center gap-2">
              <Label htmlFor={`${id}-input`} className="sr-only">
                Ask a question or book
              </Label>
              <Input
                ref={inputRef}
                id={`${id}-input`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={MAX_MESSAGE_CHARS}
                placeholder="Ask a question or book"
                autoComplete="off"
                className="h-12 rounded-full px-4 text-body"
              />
              <Button
                type="submit"
                size="icon"
                disabled={busy || off || !draft.trim()}
                className="size-12 shrink-0 rounded-full"
              >
                <SendHorizontal aria-hidden className="size-5" />
                <span className="sr-only">Send</span>
              </Button>
            </div>
            <p id={`${id}-note`} className="text-center text-caption text-muted-foreground">
              AI assistant · bookings always need your confirmation
            </p>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
