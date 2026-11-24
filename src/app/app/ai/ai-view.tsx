"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Loader2,
  MessagesSquare,
  Pencil,
  Search,
  Sparkle,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { PageBody } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  OUTCOME_LABELS,
  OUTCOMES,
  TRANSCRIPT_RANGE_LABELS,
  TRANSCRIPT_RANGES,
  TRANSCRIPT_RETENTION_DAYS,
  type TranscriptFilters,
  transcriptFiltersQuery,
  type TranscriptItem,
  type TranscriptOutcome,
  TRANSCRIPTS_PAGE_SIZE,
} from "@/lib/ai-transcripts";
import { formatInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AiUsage, FaqRow, TranscriptRow } from "@/server/db/queries/ai";

import { MarkAnsweredButton } from "./mark-answered";
import { orderFaqsAction, removeFaqAction, saveFaqAction, switchAiAction } from "./actions";

/*
 * /app/ai, as in docs/design/owner-dashboard/6-ai-receptionist: the switch and
 * the numbers, the conversations (filters and paging in the URL), the open
 * transcript, and "What the assistant knows" (the FAQ). Below xl the open
 * transcript replaces the list, with a way back.
 */

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

type Row = Omit<TranscriptRow, "startedAt" | "lastMessageAt"> & {
  startedAt: string;
  lastMessageAt: string;
};

export type OpenTranscript = {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  channel: "page" | "widget";
  outcome: TranscriptOutcome;
  customerId: string | null;
  customerName: string | null;
  items: TranscriptItem[];
  questions: {
    id: string;
    name: string;
    email: string;
    message: string;
    status: "open" | "replied" | "closed";
    createdAt: string;
    repliedAt: string | null;
    customerId: string | null;
  }[];
};

const OUTCOME_STYLE: Record<TranscriptOutcome, string> = {
  booked: "border-success text-success-text",
  rescheduled: "border-info text-info-text",
  cancelled: "border-border text-muted-foreground",
  handed_off: "border-warning text-warning-text",
  none: "border-border text-muted-foreground",
};

function OutcomeBadge({ outcome }: { outcome: TranscriptOutcome }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border bg-card px-2.5 py-0.5 text-caption",
        OUTCOME_STYLE[outcome],
      )}
    >
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

export function AiView({
  filters,
  rows,
  total,
  today,
  zone,
  role,
  slug,
  usage,
  faqs,
  faqLimits,
  open,
  missing,
}: {
  filters: TranscriptFilters;
  rows: Row[];
  total: number;
  today: string;
  zone: string;
  role: "owner" | "staff";
  slug: string;
  usage: AiUsage | null;
  faqs: FaqRow[];
  faqLimits: { question: number; answer: number; count: number };
  open: OpenTranscript | null;
  /** ?c= names a conversation that isn't there (deleted, or another business's). */
  missing: boolean;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [faqDraft, setFaqDraft] = useState<string | null>(null);

  const href = (next: Partial<TranscriptFilters>) =>
    `/app/ai${transcriptFiltersQuery({ ...filters, ...next })}` as Route;
  function go(next: Partial<TranscriptFilters>) {
    startNavigation(() => router.replace(href({ page: 1, c: null, ...next }), { scroll: false }));
  }

  const showing = filters.c !== null;
  const pages = Math.max(1, Math.ceil(total / TRANSCRIPTS_PAGE_SIZE));

  return (
    <PageBody>
      <AiHeader usage={usage} role={role} slug={slug} />

      {/* Sized by the content area, not the window: the sidebar takes its share. */}
      <div className="@container">
        <div className="grid items-start gap-6 @3xl:grid-cols-[20rem_minmax(0,1fr)] @min-[71rem]:grid-cols-[20rem_minmax(0,1fr)_22rem]">
          <section
            aria-labelledby="conversations"
            className={cn(
              "flex-col gap-4 rounded-xl border bg-card p-5",
              showing ? "hidden @3xl:flex" : "flex",
            )}
          >
            <h2 id="conversations" className="text-title">
              Conversations
            </h2>
            <Toolbar filters={filters} onChange={go} />
            <div
              className={cn("flex flex-col", navigating && "opacity-60")}
              aria-busy={navigating || undefined}
            >
              {rows.length === 0 ? (
                <EmptyList filtered={total === 0 && hasFilters(filters)} />
              ) : (
                <ul aria-label="Conversations" className="-mx-5 flex flex-col divide-y border-y">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <Link
                        href={href({ c: row.id })}
                        scroll={false}
                        aria-current={row.id === filters.c ? "true" : undefined}
                        className={cn(
                          "flex flex-col gap-1 px-5 py-4 hover:bg-muted/50",
                          row.id === filters.c && "bg-primary-tint/40",
                          focusRing,
                        )}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-label">
                            {row.customerName ?? "Visitor"}
                          </span>
                          <span className="shrink-0 font-mono text-body-sm text-muted-foreground tabular-nums">
                            {stamp(row.startedAt, zone, today)}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-body-sm text-muted-foreground">
                          {row.firstQuestion ?? "No message"}
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <OutcomeBadge outcome={row.outcome} />
                          {row.openQuestion && (
                            <span className="inline-flex items-center gap-1 text-caption text-warning-text">
                              <span aria-hidden className="size-2 rounded-full bg-warning" />
                              Needs reply
                            </span>
                          )}
                          <span className="ml-auto text-caption text-muted-foreground">
                            <span className="font-mono tabular-nums">{row.messageCount}</span>{" "}
                            {row.messageCount === 1 ? "message" : "messages"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {total > 0 && (
              <nav
                aria-label="Conversation pages"
                className="flex items-center justify-between gap-3"
              >
                <p className="text-body-sm text-muted-foreground">
                  <span className="font-mono tabular-nums">{total}</span>{" "}
                  {total === 1 ? "conversation" : "conversations"}
                </p>
                {pages > 1 && (
                  <div className="flex items-center gap-2">
                    <PageLink
                      href={href({ page: filters.page - 1, c: null })}
                      disabled={filters.page <= 1}
                      label="Previous page"
                    >
                      <ChevronLeft aria-hidden className="size-5" />
                    </PageLink>
                    <span className="font-mono text-body-sm tabular-nums">
                      {filters.page} / {pages}
                    </span>
                    <PageLink
                      href={href({ page: filters.page + 1, c: null })}
                      disabled={filters.page >= pages}
                      label="Next page"
                    >
                      <ChevronRight aria-hidden className="size-5" />
                    </PageLink>
                  </div>
                )}
              </nav>
            )}
            <p className="text-caption text-muted-foreground">
              Transcripts are kept for {TRANSCRIPT_RETENTION_DAYS} days, then deleted. Bookings and
              customers stay.
            </p>
          </section>

          <section
            aria-label="Transcript"
            className={cn(
              "min-w-0 flex-col rounded-xl border bg-card",
              // Long JSON and emails wrap instead of widening the column.
              "[overflow-wrap:anywhere]",
              showing ? "flex" : "hidden @3xl:flex",
            )}
          >
            {showing && (
              <Link
                href={href({ c: null })}
                scroll={false}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 px-5 pt-3 text-label text-primary @3xl:hidden",
                  focusRing,
                )}
              >
                <ArrowLeft aria-hidden className="size-4" /> All conversations
              </Link>
            )}
            {open ? (
              <Transcript
                transcript={open}
                zone={zone}
                role={role}
                onAddAnswer={(question) => setFaqDraft(question)}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <MessagesSquare aria-hidden className="size-8 text-muted-foreground" />
                <p className="text-body text-muted-foreground">
                  {missing
                    ? "That conversation is gone. Transcripts are deleted after 90 days."
                    : "Pick a conversation to read it."}
                </p>
              </div>
            )}
          </section>

          <FaqPanel
            faqs={faqs}
            role={role}
            limits={faqLimits}
            draft={faqDraft}
            onDraftUsed={() => setFaqDraft(null)}
          />
        </div>
      </div>
    </PageBody>
  );
}

const hasFilters = (f: TranscriptFilters) => Boolean(f.q || f.outcome || f.range !== "past30");

function EmptyList({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <Sparkle aria-hidden className="size-7 text-primary" />
      <p className="text-body text-muted-foreground">
        {filtered
          ? "No conversations match. Try another date range or clear the search."
          : "No conversations yet. When customers chat on your booking page, they show up here."}
      </p>
      {filtered && (
        <Link
          href={"/app/ai?range=all" as Route}
          className={cn(
            "min-h-11 content-center text-label text-primary underline underline-offset-4",
            focusRing,
          )}
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}

/** Today: "16:12"; earlier: "23 Nov". */
function stamp(iso: string, zone: string, today: string) {
  const date = new Date(iso);
  return formatInZone(date, zone, "yyyy-MM-dd") === today
    ? formatInZone(date, zone, "HH:mm")
    : formatInZone(date, zone, "d MMM");
}

// ── header: switch and numbers ────────────────────────────────────────

function AiHeader({
  usage,
  role,
  slug,
}: {
  usage: AiUsage | null;
  role: "owner" | "staff";
  slug: string;
}) {
  const id = useId();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(usage?.aiEnabled ?? false);
  const pro = usage?.plan === "pro";
  const on = enabled && pro;
  const canSwitch = role === "owner" && pro;

  function toggle(next: boolean) {
    setEnabled(next);
    start(async () => {
      const result = await switchAiAction(next);
      if (result.ok) {
        toast.success(next ? "The AI receptionist is on" : "The AI receptionist is off");
      } else {
        setEnabled(!next);
        toast.error(result.error.message);
      }
    });
  }

  const stats: [string, number][] = usage
    ? [
        ["Chats today", usage.chatsToday],
        ["Booked today", usage.bookedToday],
        ["For the team", usage.openQuestions],
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby={`${id}-title`}
        className="flex flex-col gap-6 rounded-xl border bg-card p-6 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 id={`${id}-title`} className="flex items-center gap-2 text-heading sm:text-display">
            <Sparkle aria-hidden className="size-7 text-primary" />
            AI receptionist
          </h1>
          <p className="text-body text-muted-foreground">
            Answers questions and offers times on your{" "}
            <Link
              href={`/b/${slug}` as Route}
              className={cn("text-primary underline underline-offset-4", focusRing)}
            >
              booking page
            </Link>
            .
          </p>
          <p className="text-body-sm text-muted-foreground">
            Bookings always need the customer&apos;s confirmation. The assistant never reserves a
            time on its own.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <dl className="flex gap-6">
            {stats.map(([label, value]) => (
              <div key={label}>
                <dt className="text-body-sm text-muted-foreground">{label}</dt>
                <dd className="font-mono text-heading tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex max-w-60 flex-col gap-2">
            <div className="flex items-center gap-3">
              <Label htmlFor={`${id}-switch`} className="text-label">
                {on ? "On" : "Off"}
              </Label>
              <Switch
                id={`${id}-switch`}
                size="lg"
                checked={on}
                disabled={!canSwitch || pending}
                onCheckedChange={toggle}
                aria-describedby={`${id}-switch-note`}
              />
              {pending && <Loader2 aria-label="Saving" className="size-4 animate-spin" />}
            </div>
            <p id={`${id}-switch-note`} className="text-body-sm text-muted-foreground">
              {!pro
                ? "Part of the Pro plan. Upgrades open with billing; until then, contact us to switch your plan."
                : role !== "owner"
                  ? "Only owners can switch it on or off."
                  : on
                    ? "Customers see “Ask us anything” on your booking page."
                    : "Off: the chat button is hidden and open chats stop. Booking still works."}
            </p>
          </div>
        </div>
      </section>

      {usage && (
        <section
          aria-labelledby={`${id}-usage`}
          className="flex flex-col gap-3 rounded-xl border bg-card p-6"
        >
          <h2 id={`${id}-usage`} className="text-title">
            This month
          </h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-body-sm text-muted-foreground">Conversations</dt>
              <dd className="font-mono text-heading tabular-nums">{usage.conversations}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-muted-foreground">Booked by the assistant</dt>
              <dd className="font-mono text-heading tabular-nums">{usage.aiBookings}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-muted-foreground">AI tokens used</dt>
              <dd className="font-mono text-heading tabular-nums">
                {usage.tokens.toLocaleString("en-US")}
                <span className="text-body-sm text-muted-foreground">
                  {" "}
                  of {usage.tokenBudget.toLocaleString("en-US")}
                </span>
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}

// ── conversations toolbar ─────────────────────────────────────────────

function Toolbar({
  filters,
  onChange,
}: {
  filters: TranscriptFilters;
  onChange: (next: Partial<TranscriptFilters>) => void;
}) {
  const id = useId();
  const [q, setQ] = useState(filters.q);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    if (q.trim() === filters.q) return;
    const timer = setTimeout(() => latest.current({ q: q.trim() }), 300);
    return () => clearTimeout(timer);
  }, [q, filters.q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <label htmlFor={`${id}-q`} className="sr-only">
          Search customer or booking code
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={`${id}-q`}
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search customer or booking code"
          className="h-11 pr-3 pl-9 text-body md:text-body"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Outcome"
          value={filters.outcome ?? ""}
          onChange={(value) => onChange({ outcome: (value || null) as TranscriptOutcome | null })}
          options={[
            ["", "All"],
            ...OUTCOMES.map((o) => [o, OUTCOME_LABELS[o]] as [string, string]),
          ]}
        />
        <Select
          label="Date"
          value={filters.range}
          onChange={(value) => onChange({ range: value as TranscriptFilters["range"] })}
          options={TRANSCRIPT_RANGES.map((r) => [r, TRANSCRIPT_RANGE_LABELS[r]])}
        />
      </div>
      {filters.range === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          {(["from", "to"] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${key}`} className="text-body-sm text-muted-foreground">
                {key === "from" ? "From" : "To"}
              </label>
              <Input
                id={`${id}-${key}`}
                type="date"
                value={filters[key] ?? ""}
                onChange={(event) => onChange({ [key]: event.target.value || null })}
                className="h-11 px-3 font-mono text-body tabular-nums md:text-body"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="relative flex h-11 min-w-0 items-center gap-1 rounded-lg border border-input bg-card pl-3 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
      <label htmlFor={id} className="text-body-sm text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 appearance-none bg-transparent pr-8 pl-1 text-label outline-none"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3 size-4 text-muted-foreground"
      >
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function PageLink({
  href,
  label,
  disabled,
  children,
}: {
  href: Route;
  label: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const style = cn(
    "flex size-11 items-center justify-center rounded-lg border bg-card hover:bg-muted",
    focusRing,
  );
  return disabled ? (
    <span aria-disabled="true" aria-label={label} className={cn(style, "opacity-50")}>
      {children}
    </span>
  ) : (
    <Link href={href} aria-label={label} scroll={false} className={style}>
      {children}
    </Link>
  );
}

// ── transcript ────────────────────────────────────────────────────────

const TONE: Record<"neutral" | "success" | "warning", string> = {
  neutral: "bg-muted/60",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
};

function Transcript({
  transcript,
  zone,
  role,
  onAddAnswer,
}: {
  transcript: OpenTranscript;
  zone: string;
  role: "owner" | "staff";
  onAddAnswer: (question: string) => void;
}) {
  const name = transcript.customerName ?? "Visitor";
  const time = (iso: string) => formatInZone(new Date(iso), zone, "HH:mm");
  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-2 border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-title">{name}</h2>
          <OutcomeBadge outcome={transcript.outcome} />
        </div>
        <p className="text-body-sm text-muted-foreground">
          {formatInZone(new Date(transcript.startedAt), zone, "EEE d MMM")} ·{" "}
          <span className="font-mono tabular-nums">
            {time(transcript.startedAt)} – {time(transcript.lastMessageAt)}
          </span>{" "}
          · {transcript.channel === "widget" ? "website widget" : "booking page"}
          {transcript.customerId && (
            <>
              {" · "}
              <Link
                href={`/app/customers/${transcript.customerId}` as Route}
                className={cn("text-primary underline underline-offset-4", focusRing)}
              >
                Open profile
              </Link>
            </>
          )}
        </p>
      </header>

      {transcript.questions.length > 0 && (
        <section
          aria-label="Questions for the team"
          className="flex flex-col gap-3 border-b px-5 py-4"
        >
          {transcript.questions.map((q) => (
            <div
              key={q.id}
              className={cn(
                "flex flex-col gap-2 rounded-xl p-4",
                q.status === "open" ? "bg-warning-soft" : "border bg-card",
              )}
            >
              <p className="flex items-center gap-2 text-label text-warning-text">
                {q.status === "open" ? (
                  <>
                    <span aria-hidden className="size-2 rounded-full bg-warning" />
                    Question for the team
                  </>
                ) : (
                  <>
                    <CircleCheck aria-hidden className="size-4 text-success" />
                    <span className="text-success-text">Answered</span>
                  </>
                )}
              </p>
              <p className="text-body">&ldquo;{q.message}&rdquo;</p>
              <p className="text-body-sm text-muted-foreground">
                {q.name} · {q.email} · From the AI chat · email not verified
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild className="h-11 w-fit px-5 text-label">
                  <a href={`mailto:${q.email}`}>Reply by email</a>
                </Button>
                {role === "owner" && q.status === "open" && (
                  <MarkAnsweredButton questionId={q.id} />
                )}
                {role === "owner" && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-fit px-4 text-label"
                    onClick={() => onAddAnswer(q.message)}
                  >
                    Add an answer
                  </Button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      <ol aria-label={`Conversation with ${name}`} className="flex flex-col gap-3 px-5 py-5">
        {transcript.items.map((item) =>
          item.kind === "message" ? (
            <li
              key={item.id}
              className={cn(
                "flex flex-col gap-1",
                item.role === "user" ? "items-end" : "items-start",
              )}
            >
              <p
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-body whitespace-pre-wrap",
                  item.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border bg-background",
                )}
              >
                <span className="sr-only">
                  {item.role === "user" ? `${name}: ` : "Assistant: "}
                </span>
                {item.text}
              </p>
              <span className="font-mono text-caption text-muted-foreground tabular-nums">
                {item.role === "user" ? name : "Assistant"} · {time(item.at)}
              </span>
            </li>
          ) : (
            <li key={item.id}>
              <details className={cn("group rounded-xl", TONE[item.tone])}>
                <summary
                  className={cn(
                    "flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-xl px-4 py-3 text-body-sm [&::-webkit-details-marker]:hidden",
                    focusRing,
                  )}
                >
                  <span className="flex-1">
                    <span className="font-semibold">{item.label}</span>
                    {item.detail && <span> · {item.detail}</span>}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{time(item.at)}</span>
                  <span className="sr-only">, show details</span>
                </summary>
                <div className="flex flex-col gap-3 px-4 pb-4 text-body-sm text-foreground">
                  {item.bookingId && (
                    <Link
                      href={`/app/bookings?range=all&booking=${item.bookingId}` as Route}
                      className={cn("w-fit text-primary underline underline-offset-4", focusRing)}
                    >
                      Open booking {item.code}
                    </Link>
                  )}
                  <Payload title="Arguments" value={item.input} />
                  <Payload title="Result" value={item.output} />
                </div>
              </details>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

function Payload({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-caption text-muted-foreground">{title}</p>
      <pre className="max-h-64 overflow-auto rounded-lg border bg-card p-3 font-mono text-caption whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────

function FaqPanel({
  faqs,
  role,
  limits,
  draft,
  onDraftUsed,
}: {
  faqs: FaqRow[];
  role: "owner" | "staff";
  limits: { question: number; answer: number; count: number };
  /** "Add an answer" from a question in the transcript. */
  draft: string | null;
  onDraftUsed: () => void;
}) {
  const id = useId();
  const owner = role === "owner";
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [lastDraft, setLastDraft] = useState<string | null>(null);
  if (draft !== lastDraft) {
    setLastDraft(draft);
    if (draft !== null) setEditing("new");
  }
  const [pending, start] = useTransition();

  function move(index: number, by: -1 | 1) {
    const order = faqs.map((f) => f.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + by, 0, moved!);
    start(async () => {
      const result = await orderFaqsAction(order);
      if (!result.ok) toast.error(result.error.message);
    });
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 @3xl:col-span-2 @min-[71rem]:col-span-1"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-title">
          What the assistant knows
        </h2>
        {owner && editing !== "new" && faqs.length < limits.count && (
          <Button
            type="button"
            variant="secondary"
            className="h-11 border px-4 text-label"
            onClick={() => setEditing("new")}
          >
            Add question
          </Button>
        )}
      </div>
      <p className="text-body-sm text-muted-foreground">
        Answers to common questions, on top of your services, hours and policies.
        {owner ? " Changes apply to new chats right away." : " Owners can change these."}
      </p>

      {editing === "new" && (
        <FaqForm
          limits={limits}
          initial={{ question: draft ?? "", answer: "" }}
          onDone={() => {
            setEditing(null);
            onDraftUsed();
          }}
        />
      )}

      {faqs.length === 0 && editing !== "new" ? (
        <p className="text-body text-muted-foreground">
          No answers yet. Add the questions customers ask most (parking, payment, what to bring).
        </p>
      ) : (
        <ul aria-label="Answers" className="flex flex-col divide-y">
          {faqs.map((faq, index) =>
            editing === faq.id ? (
              <li key={faq.id} className="py-3">
                <FaqForm
                  limits={limits}
                  faqId={faq.id}
                  initial={{ question: faq.question, answer: faq.answer }}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={faq.id} className="flex items-start gap-2 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h3 className="text-label">{faq.question}</h3>
                  <p className="text-body-sm whitespace-pre-wrap text-muted-foreground">
                    {faq.answer}
                  </p>
                </div>
                {owner && (
                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden className="size-4" />
                      <span className="sr-only">Move up: {faq.question}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      disabled={pending || index === faqs.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                      <span className="sr-only">Move down: {faq.question}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      onClick={() => setEditing(faq.id)}
                    >
                      <Pencil aria-hidden className="size-4" />
                      <span className="sr-only">Edit: {faq.question}</span>
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function FaqForm({
  limits,
  faqId,
  initial,
  onDone,
}: {
  limits: { question: number; answer: number };
  faqId?: string;
  initial: { question: string; answer: string };
  onDone: () => void;
}) {
  const id = useId();
  const [question, setQuestion] = useState(initial.question);
  const [answer, setAnswer] = useState(initial.answer);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await saveFaqAction({ question, answer }, faqId);
      if (result.ok) {
        toast.success(faqId ? "Answer saved" : "Answer added");
        onDone();
      } else {
        setError(result.error.message);
      }
    });
  }

  function remove() {
    if (!faqId) return;
    start(async () => {
      const result = await removeFaqAction(faqId);
      if (result.ok) {
        toast.success("Answer deleted");
        onDone();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <form
      onSubmit={save}
      aria-label={faqId ? "Edit answer" : "New answer"}
      className="flex flex-col gap-3 rounded-xl border border-primary p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-q`}>Question</Label>
        <Input
          id={`${id}-q`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={limits.question}
          required
          autoFocus
          className="h-11 text-body md:text-body"
          aria-describedby={`${id}-q-count`}
        />
        <span
          id={`${id}-q-count`}
          className="text-right font-mono text-caption text-muted-foreground tabular-nums"
        >
          {question.length}/{limits.question}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-a`}>Answer</Label>
        <Textarea
          id={`${id}-a`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={limits.answer}
          required
          rows={4}
          className="text-body md:text-body"
          aria-describedby={`${id}-a-count`}
        />
        <span
          id={`${id}-a-count`}
          className="text-right font-mono text-caption text-muted-foreground tabular-nums"
        >
          {answer.length}/{limits.answer}
        </span>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-body-sm text-danger-text">
          {error}
        </p>
      )}
      {confirmDelete ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-body-sm">Delete this answer?</p>
          <Button
            type="button"
            className="h-11 bg-destructive px-4 text-label text-destructive-foreground hover:bg-destructive-hover"
            disabled={pending}
            onClick={remove}
          >
            Delete
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-4 text-label"
            onClick={() => setConfirmDelete(false)}
          >
            Keep it
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {faqId && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto h-11 px-4 text-label text-danger-text hover:bg-danger-soft hover:text-danger-text"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" className="h-11 px-4 text-label" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" className="h-11 px-5 text-label" disabled={pending}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </form>
  );
}
