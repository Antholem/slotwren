"use client";

import {
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  Loader2,
  RotateCcw,
  Sparkle,
  Check,
} from "lucide-react";
import type { Route } from "next";
import { useEffect, useId, useState } from "react";

import { ManageLink } from "@/components/booking/manage-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConfirmedCard,
  ConfirmFailure,
  ConfirmResponse,
  ConfirmSuccess,
  HandoffResponse,
  OfferedTime,
  ProposalCard,
} from "@/lib/chat";
import { cn } from "@/lib/utils";

/*
 * The AI receptionist's cards and chips (docs/design/ai-receptionist): slot
 * chips, tool status lines, the Confirm card (nothing is booked until the
 * customer taps it), the booked card and the "Message the team" form. Tap
 * targets are 44 px; every control works by keyboard.
 */

const FOCUS =
  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// ── chips and status ──────────────────────────────────────────────────

/** Offered times as chips; tapping one asks for that time. Older chips are spent. */
export function SlotChips({
  times,
  disabled,
  onPick,
}: {
  times: OfferedTime[];
  disabled: boolean;
  onPick: (time: OfferedTime) => void;
}) {
  if (times.length === 0) return null;
  const manyDays = new Set(times.map((t) => t.day)).size > 1;
  return (
    <ul aria-label="Times you can pick" className="flex flex-wrap gap-2">
      {times.map((t) => (
        <li key={`${t.startsAt}-${t.staff}`}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(t)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border border-input bg-card px-4 text-body hover:border-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-input",
              FOCUS,
            )}
          >
            <Sparkle aria-hidden className="size-4 text-primary" />
            {manyDays && <span>{t.day}</span>}
            <span className="font-mono tabular-nums">{t.time}</span>
            <span>with {t.staff}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Checking Saturday…" while a tool runs, "Checked Saturday 28 Nov" after. */
export function ToolStatus({ done, label }: { done: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
      {done ? (
        <CircleCheck aria-hidden className="size-4 text-success" />
      ) : (
        <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
      )}
      {label}
    </p>
  );
}

export function TypingDots() {
  return (
    <div
      role="status"
      className="inline-flex h-11 items-center gap-1 rounded-2xl border bg-card px-4"
    >
      <span className="sr-only">The assistant is typing</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="size-2 rounded-full bg-muted-foreground motion-safe:animate-pulse"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

// ── Confirm ───────────────────────────────────────────────────────────

function Rows({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-right">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const ACTION = {
  book: "Confirm booking",
  reschedule: "Confirm new time",
  cancel: "Cancel booking",
} as const;

const TITLE = {
  book: "Check and confirm",
  reschedule: "Move your booking",
  cancel: "Cancel your booking",
} as const;

type Settled = { state: "confirmed" } | { state: "failed"; failure: ConfirmFailure };

/**
 * A proposal to check and confirm. Only the Confirm tap books, moves or
 * cancels (POST /api/chat/[slug]/confirm). `settled` comes from the
 * conversation: a refresh shows a confirmed card as confirmed.
 */
export function ConfirmCard({
  slug,
  card,
  conversationId,
  settled,
  onConfirmed,
  onFailed,
  onChange,
}: {
  slug: string;
  card: ProposalCard;
  conversationId: () => string | null;
  settled: Settled | null;
  onConfirmed: (result: ConfirmSuccess, customer: { name: string; email: string } | null) => void;
  onFailed: (failure: ConfirmFailure) => void;
  onChange: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(card.customer.name ?? "");
  const [email, setEmail] = useState(card.customer.email ?? "");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<ConfirmFailure | null>(null);
  const confirmed = settled?.state === "confirmed";
  const shownFailure = failure ?? (settled?.state === "failed" ? settled.failure : null);
  // Turns true when the proposal's ten minutes are up (the server refuses it then too).
  const [lapsed, setLapsed] = useState(() => Date.parse(card.expiresAt) <= Date.now());
  useEffect(() => {
    if (lapsed) return;
    const timer = setTimeout(() => setLapsed(true), Date.parse(card.expiresAt) - Date.now());
    return () => clearTimeout(timer);
  }, [card.expiresAt, lapsed]);
  const expired = !confirmed && lapsed;
  const book = card.kind === "book";
  // Retrying helps after a hiccup, not when the time is gone or the request spent.
  const canRetry =
    shownFailure &&
    !["slot_taken", "expired", "used", "too_late", "not_active"].includes(shownFailure.error);

  async function confirm() {
    const conversation = conversationId();
    if (!conversation || sending) return;
    if (book && (!name.trim() || !email.trim())) {
      setFailure({ ok: false, error: "bad_request", message: "Add your name and email to book." });
      return;
    }
    setSending(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/chat/${slug}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation,
          proposalId: card.proposalId,
          ...(book ? { customer: { name: name.trim(), email: email.trim() } } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as ConfirmResponse | null;
      if (body?.ok) {
        onConfirmed(body, book ? { name: name.trim(), email: email.trim() } : null);
      } else {
        const failed: ConfirmFailure = body ?? {
          ok: false,
          error: "bad_request",
          message: "Nothing was booked. Please try again.",
        };
        setFailure(failed);
        onFailed(failed);
      }
    } catch {
      setFailure({
        ok: false,
        error: "bad_request",
        message: "Nothing was booked. Please try again.",
      });
    } finally {
      setSending(false);
    }
  }

  const rows = [
    {
      label: "Service",
      value: (
        <>
          {card.service} · <span className="font-mono tabular-nums">{card.durationMin} min</span>
        </>
      ),
    },
    { label: "With", value: card.staff },
    {
      label: card.kind === "reschedule" ? "New time" : "When",
      value: (
        <>
          {card.day} · <span className="font-mono tabular-nums">{card.time}</span>
        </>
      ),
    },
    ...(card.previousWhen ? [{ label: "Was", value: card.previousWhen }] : []),
    ...(card.code
      ? [{ label: "Code", value: <span className="font-mono tabular-nums">{card.code}</span> }]
      : []),
    {
      label: "Price",
      value: <span className="font-mono font-medium tabular-nums">{card.price}</span>,
    },
  ];

  if (confirmed) {
    return (
      <section
        aria-label={`${card.service} with ${card.staff}, confirmed`}
        className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
      >
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-primary-tint px-3 py-1 text-label text-primary-tint-foreground">
          <span aria-hidden className="size-2 rounded-full bg-primary" />
          Confirmed by you
        </span>
        <h3 className="text-title">
          {card.service} with {card.staff}
        </h3>
        <Rows rows={rows} />
        {(name || email) && (
          <div className="border-t pt-3">
            <Rows
              rows={[
                ...(name ? [{ label: "Name", value: name }] : []),
                ...(email ? [{ label: "Email", value: email }] : []),
              ]}
            />
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex flex-col gap-4 rounded-2xl border-2 bg-card p-5",
        shownFailure ? "border-danger" : "border-dashed border-warning",
      )}
    >
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-warning bg-warning-soft px-3 py-1 text-label text-warning-text">
        <Clock aria-hidden className="size-4" />
        {book ? "Not booked yet" : "Not changed yet"}
      </span>
      <h3 id={`${id}-title`} className="text-title">
        {TITLE[card.kind]}
      </h3>
      <Rows rows={rows} />
      <div className="flex flex-col gap-3 border-t pt-4">
        {book ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={80}
                disabled={sending || expired}
                className="h-11 text-body"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-email`}>Email</Label>
              <Input
                id={`${id}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                maxLength={254}
                disabled={sending || expired}
                className="h-11 text-body"
              />
            </div>
          </>
        ) : (
          <Rows
            rows={[
              ...(card.customer.name ? [{ label: "Name", value: card.customer.name }] : []),
              ...(card.customer.email ? [{ label: "Email", value: card.customer.email }] : []),
            ]}
          />
        )}
      </div>
      {shownFailure ? (
        <div
          role="alert"
          className="flex gap-2 rounded-xl bg-danger-soft p-3 text-body-sm text-danger-text"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-semibold">
              We couldn&apos;t complete the {book ? "booking" : "change"}.
            </strong>{" "}
            {shownFailure.message}
          </p>
        </div>
      ) : expired ? (
        <p className="flex gap-2 text-body-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          This expired. Ask the assistant for the time again.
        </p>
      ) : (
        <p className="flex gap-2 text-body-sm">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <span>
            Nothing {book ? "is booked" : "changes"} until you tap{" "}
            <strong className="font-semibold">{ACTION[card.kind]}</strong>.
            {card.kind !== "cancel" &&
              (card.cancellationWindowHours > 0
                ? ` Free cancellation up to ${card.cancellationWindowHours} h before.`
                : " Free cancellation any time before.")}
          </span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="secondary"
          className="h-11 border text-body"
          onClick={onChange}
          disabled={sending}
        >
          Change
        </Button>
        <Button
          type="button"
          className="h-11 text-body"
          onClick={confirm}
          disabled={sending || expired || (!!shownFailure && !canRetry)}
        >
          {sending ? (
            <Loader2 aria-hidden className="motion-safe:animate-spin" />
          ) : shownFailure && canRetry ? (
            <RotateCcw aria-hidden />
          ) : null}
          {shownFailure && canRetry ? "Retry" : ACTION[card.kind]}
        </Button>
      </div>
    </section>
  );
}

// ── booked ────────────────────────────────────────────────────────────

const BOOKED_TITLE = {
  book: "You're booked",
  reschedule: "Your booking moved",
  cancel: "Booking cancelled",
} as const;

export function BookedCard({ booked }: { booked: ConfirmedCard }) {
  const id = useId();
  const cancelled = booked.kind === "cancel";
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
    >
      <div className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary-tint-foreground">
          <Check aria-hidden className="size-6" />
        </span>
        <div>
          <h3 id={`${id}-title`} className="text-title">
            {BOOKED_TITLE[booked.kind]}
          </h3>
          <p className="text-body text-muted-foreground">
            {booked.day} · <span className="font-mono tabular-nums">{booked.time}</span>
          </p>
        </div>
      </div>
      <div className="border-t pt-4">
        <Rows
          rows={[
            { label: "Booking", value: `${booked.service} with ${booked.staff}` },
            { label: "Code", value: <span className="font-mono tabular-nums">{booked.code}</span> },
          ]}
        />
      </div>
      {!cancelled && (
        <p className="text-body-sm text-muted-foreground">
          {booked.email
            ? `We've emailed the details to ${booked.email}.`
            : "We've emailed the details."}
          {booked.freeUntil ? ` Free cancellation until ${booked.freeUntil}.` : ""}
        </p>
      )}
      {booked.googleCalendarUrl && booked.icsPath && (
        <div className="flex flex-col gap-2">
          <p className="text-label">Add to calendar</p>
          <div className="grid grid-cols-3 gap-2">
            <Button asChild variant="secondary" className="h-11 border text-body">
              <a href={booked.googleCalendarUrl} target="_blank" rel="noopener noreferrer">
                Google<span className="sr-only"> Calendar (opens in a new tab)</span>
              </a>
            </Button>
            <Button asChild variant="secondary" className="h-11 border text-body">
              <a href={booked.icsPath as Route}>
                Apple<span className="sr-only"> Calendar</span>
              </a>
            </Button>
            <Button asChild variant="secondary" className="h-11 border text-body">
              <a href={booked.icsPath as Route} download={`${booked.code}.ics`}>
                <span className="font-mono">.ics</span>
                <span className="sr-only"> file</span>
              </a>
            </Button>
          </div>
        </div>
      )}
      {!cancelled && (
        <ManageLink
          bookingId={booked.bookingId}
          fallback="To change it later, use the link in your confirmation email."
          className="inline-flex min-h-11 w-fit items-center text-body font-medium text-primary underline underline-offset-4 hover:no-underline"
        />
      )}
    </section>
  );
}

// ── hand-off ──────────────────────────────────────────────────────────

/** "Message the team": an open question the owner answers by email. */
export function HandoffForm({
  slug,
  businessName,
  question,
  conversationId,
  sent,
  onSent,
}: {
  slug: string;
  businessName: string;
  question: string;
  conversationId: () => string | null;
  sent: boolean;
  onSent: (message: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(question);
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
        <CircleCheck aria-hidden className="size-4 text-success" /> Sent to the team
      </p>
    );
  }
  if (dismissed) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-11 w-fit rounded-full px-4 text-body"
        onClick={() => setDismissed(false)}
      >
        Message the team
      </Button>
    );
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const conversation = conversationId();
    if (!conversation || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/chat/${slug}/handoff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversation, name, email, message }),
      });
      const body = (await response.json().catch(() => null)) as HandoffResponse | null;
      if (body?.ok) onSent(body.message);
      else setError(body?.message ?? "That didn't send. Please try again.");
    } catch {
      setError("That didn't send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={send}
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
    >
      <h3 id={`${id}-title`} className="text-title">
        Message the team
      </h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
          maxLength={80}
          className="h-11 text-body"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input
          id={`${id}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          maxLength={254}
          className="h-11 text-body"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-question`}>Your question</Label>
        <Textarea
          id={`${id}-question`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          maxLength={1000}
          rows={3}
          className="text-body"
        />
      </div>
      <p className="text-body-sm text-muted-foreground">
        A person from {businessName} will reply by email.
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft p-3 text-body-sm text-danger-text">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-body"
          onClick={() => setDismissed(true)}
        >
          Not now
        </Button>
        <Button type="submit" className="h-11 text-body" disabled={sending}>
          {sending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}
          Send to the team
        </Button>
      </div>
    </form>
  );
}
