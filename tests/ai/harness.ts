import { randomBytes } from "node:crypto";

import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { and, count, eq } from "drizzle-orm";

import { POST as confirmRoute } from "@/app/api/chat/[slug]/confirm/route";
import { POST as handoffRoute } from "@/app/api/chat/[slug]/handoff/route";
import { POST as chatRoute } from "@/app/api/chat/[slug]/route";
import type { ConfirmResponse, HandoffResponse, OfferedTime, ProposalCard } from "@/lib/chat";
import { formatInZone } from "@/lib/dates";
import { nextDate, zonedInstant, zonedParts } from "@/lib/time-off";
import type { ChatModel } from "@/server/ai/model";
import * as schema from "@/server/db/schema";

import type { connectTestDb } from "../support/db";
import { bookingValues, createFixtureBusiness } from "../support/db";

/*
 * The AI receptionist's scripted conversations (tests/ai/scripts.ts) run
 * through the real routes: /api/chat/[slug], its Confirm and its hand-off,
 * against a fresh Lumen-like business per script. In CI the model is a
 * scripted mock (each turn says which tool calls and replies it plays); in
 * `pnpm ai:eval` the same turns go to the real model and the same checks run.
 */

export const ZONE = "Asia/Manila";
export type Db = ReturnType<typeof connectTestDb>["db"];
type Fixture = Awaited<ReturnType<typeof createFixtureBusiness>>;

// ── the scripted mock ────────────────────────────────────────────────

type Obj = Record<string, unknown>;

/** What a mock step can read: tool results so far (this turn and replayed history). */
export type MockContext = {
  /** Outputs of `tool`'s calls, oldest first. */
  outputs: (tool: string) => Obj[];
  /** Times offered by the latest availability check. */
  times: () => OfferedTime[];
  /** The latest proposal card. */
  card: () => ProposalCard | null;
};

type Value<T> = T | ((ctx: MockContext) => T);

/** One model call: some text, and/or tool calls (then the next step answers). */
export type MockStep = { text?: Value<string>; tools?: { name: string; input: Value<Obj> }[] };

export const tool = (name: string, input: Value<Obj> = {}): MockStep => ({
  tools: [{ name, input }],
});
export const reply = (text: Value<string>): MockStep => ({ text });

type Prompt = Parameters<MockLanguageModelV4["doStream"]>[0]["prompt"];
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;

function contextOf(prompt: Prompt): MockContext {
  const results: { tool: string; value: Obj }[] = prompt.flatMap((m) =>
    m.role === "tool"
      ? m.content.flatMap((part) => {
          if (part.type !== "tool-result") return [];
          const output = part.output as { type: string; value?: unknown };
          return output.type === "json" && output.value && typeof output.value === "object"
            ? [{ tool: part.toolName, value: output.value as Obj }]
            : [];
        })
      : [],
  );
  const outputs = (name: string) => results.filter((r) => r.tool === name).map((r) => r.value);
  return {
    outputs,
    times: () => (outputs("checkAvailability").at(-1)?.times as OfferedTime[] | undefined) ?? [],
    card: () =>
      (results.filter((r) => r.value.status === "proposed").at(-1)?.value.card as ProposalCard) ??
      null,
  };
}

const usage = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 40, text: 40, reasoning: undefined },
};
let callId = 0;

/** A model that plays `steps`, one per model call in this turn. */
export function scriptedModel(steps: MockStep[]): MockLanguageModelV4 {
  let index = 0;
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const step = steps[index++] ?? {};
      const ctx = contextOf(prompt);
      const value = <T>(v: Value<T>): T =>
        typeof v === "function" ? (v as (c: MockContext) => T)(ctx) : v;
      const chunks: StreamPart[] = [];
      const text = step.text === undefined ? "" : value(step.text);
      if (text) {
        chunks.push({ type: "text-start", id: "t" });
        chunks.push({ type: "text-delta", id: "t", delta: text });
        chunks.push({ type: "text-end", id: "t" });
      }
      for (const t of step.tools ?? []) {
        chunks.push({
          type: "tool-call",
          toolCallId: `script-${++callId}`,
          toolName: t.name,
          input: JSON.stringify(value(t.input)),
        });
      }
      chunks.push({
        type: "finish",
        finishReason: { unified: step.tools?.length ? "tool-calls" : "stop", raw: undefined },
        usage,
      });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

// ── the world a script runs in ───────────────────────────────────────

export type ToolCall = { name: string; input: Obj; output: Obj };
export type Turn = { status: number; text: string; tools: ToolCall[]; errors: string[] };

export type Mode =
  { kind: "mock"; setModel: (model: ChatModel) => void } | { kind: "real"; pauseMs: number };

/** A business like Lumen Studio: three staff, two services, closed Mondays. */
export class World {
  conversationId: string | undefined;
  timezone = ZONE;
  private ip = Math.floor(Math.random() * 200);

  constructor(
    readonly db: Db,
    readonly fixture: Fixture,
    readonly staff: Record<"Mia" | "Jonah" | "Aiko", string>,
    readonly colourId: string,
    private readonly mode: Mode,
  ) {}

  get slug() {
    return this.fixture.business.slug;
  }
  get businessId() {
    return this.fixture.business.id;
  }
  get name() {
    return this.fixture.business.name;
  }
  get customerEmail() {
    return this.fixture.customer.email;
  }
  get real() {
    return this.mode.kind === "real";
  }

  // ── calendar (business-local) ──
  today() {
    return zonedParts(new Date(), ZONE).date;
  }
  /** The first open day (not Monday) at least `ahead` days from today. */
  openDay(ahead: number): string {
    let date = nextDate(this.today(), ahead);
    while (new Date(`${date}T12:00:00Z`).getUTCDay() === 1) date = nextDate(date);
    return date;
  }
  /** The next date (1–7 days ahead) falling on `weekday` (0 = Sunday). */
  next(weekday: number): string {
    let date = nextDate(this.today(), 1);
    while (new Date(`${date}T12:00:00Z`).getUTCDay() !== weekday) date = nextDate(date);
    return date;
  }
  /** "Wednesday 2 December" */
  label(date: string) {
    return formatInZone(new Date(`${date}T12:00:00Z`), "UTC", "EEEE d MMMM");
  }
  at(date: string, time: string) {
    return zonedInstant(date, time, ZONE);
  }

  // ── talking to the routes ──
  private nextIp() {
    this.ip = (this.ip + 1) % 250;
    return `198.19.${Math.floor(Math.random() * 250)}.${this.ip + 1}`;
  }

  /** The customer sends `text`; in mock mode the model plays `steps`. */
  async say(text: string, steps: MockStep[] = []): Promise<Turn> {
    if (this.mode.kind === "mock") {
      this.mode.setModel({
        model: scriptedModel(steps),
        provider: "mock",
        modelId: "script",
        timeoutMs: 10_000,
      });
    } else if (this.mode.pauseMs > 0) {
      // Free tiers count requests per minute: space the turns out.
      await new Promise((resolve) =>
        setTimeout(resolve, this.mode.kind === "real" ? this.mode.pauseMs : 0),
      );
    }
    const response = await chatRoute(
      new Request(`http://localhost/api/chat/${this.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": this.nextIp() },
        body: JSON.stringify({
          text,
          conversationId: this.conversationId,
          timezone: this.timezone,
        }),
      }),
      { params: Promise.resolve({ slug: this.slug }) },
    );
    this.conversationId = response.headers.get("x-conversation-id") ?? this.conversationId;
    if (response.status !== 200) {
      return { status: response.status, text: "", tools: [], errors: [await response.text()] };
    }
    const chunks = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)) as Obj);
    const calls = new Map<string, ToolCall>();
    for (const c of chunks) {
      if (c.type === "tool-input-available") {
        calls.set(String(c.toolCallId), {
          name: String(c.toolName),
          input: (c.input ?? {}) as Obj,
          output: {},
        });
      }
      if (c.type === "tool-output-available" && calls.has(String(c.toolCallId))) {
        calls.get(String(c.toolCallId))!.output = (c.output ?? {}) as Obj;
      }
    }
    return {
      status: 200,
      text: chunks
        .filter((c) => c.type === "text-delta")
        .map((c) => c.delta)
        .join(""),
      tools: [...calls.values()],
      errors: chunks.filter((c) => c.type === "error").map((c) => String(c.errorText)),
    };
  }

  async confirm(proposalId: string, customer?: { name: string; email: string }) {
    const response = await confirmRoute(
      new Request(`http://localhost/api/chat/${this.slug}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": this.nextIp() },
        body: JSON.stringify({ conversationId: this.conversationId, proposalId, customer }),
      }),
      { params: Promise.resolve({ slug: this.slug }) },
    );
    return { status: response.status, body: (await response.json()) as ConfirmResponse };
  }

  async handoff(payload: { name: string; email: string; message: string }) {
    const response = await handoffRoute(
      new Request(`http://localhost/api/chat/${this.slug}/handoff`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": this.nextIp() },
        body: JSON.stringify({ conversationId: this.conversationId, ...payload }),
      }),
      { params: Promise.resolve({ slug: this.slug }) },
    );
    return { status: response.status, body: (await response.json()) as HandoffResponse };
  }

  // ── the database ──
  async bookingCount() {
    const [row] = await this.db
      .select({ n: count() })
      .from(schema.bookings)
      .where(eq(schema.bookings.businessId, this.businessId));
    return row!.n;
  }
  async proposals() {
    return this.db
      .select()
      .from(schema.aiProposals)
      .where(eq(schema.aiProposals.businessId, this.businessId));
  }
  async booking(id: string) {
    const [row] = await this.db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    return row ?? null;
  }
  /** An existing booking for the fixture customer (Ana Santos). */
  async existingBooking(staff: keyof World["staff"], startsAt: Date) {
    const [row] = await this.db
      .insert(schema.bookings)
      .values(bookingValues(this.fixture, startsAt, { staffId: this.staff[staff] }))
      .returning();
    return row!;
  }
  async faq(question: string, answer: string) {
    await this.db
      .insert(schema.faqs)
      .values({ businessId: this.businessId, question, answer, sortOrder: 10 });
  }
  async timeOff(staff: keyof World["staff"], date: string) {
    await this.db.insert(schema.timeOff).values({
      businessId: this.businessId,
      staffId: this.staff[staff],
      startsAt: this.at(date, "00:00"),
      endsAt: this.at(nextDate(date), "00:00"),
      allDay: true,
    });
  }
  async handoffQuestions() {
    return this.db
      .select()
      .from(schema.handoffRequests)
      .where(eq(schema.handoffRequests.businessId, this.businessId));
  }
  async bookingsAt(staff: keyof World["staff"], startsAt: Date) {
    return this.db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.businessId, this.businessId),
          eq(schema.bookings.staffId, this.staff[staff]),
          eq(schema.bookings.startsAt, startsAt),
        ),
      );
  }
}

/** A fresh business for one script. */
export async function createWorld(db: Db, mode: Mode): Promise<World> {
  const fixture = await createFixtureBusiness(db);
  const businessId = fixture.business.id;
  await db
    .update(schema.businesses)
    .set({
      name: `Lumen Studio ${randomBytes(2).toString("hex")}`,
      onboardedAt: new Date(),
      aiEnabled: true,
      plan: "pro",
      minNoticeMin: 60,
      cancellationWindowHours: 24,
      address: "12 Lumen Lane, Makati",
      settings: {
        openingHours: [2, 3, 4, 5, 6, 0].map((weekday) => ({
          weekday,
          start: "09:00",
          end: "18:00",
        })),
      },
    })
    .where(eq(schema.businesses.id, businessId));
  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId));
  fixture.business = business!;

  await db
    .update(schema.services)
    .set({ name: "Haircut & Style", durationMin: 45, priceCents: 3500, bufferAfterMin: 0 })
    .where(eq(schema.services.id, fixture.service.id));
  const [jonah, aiko] = await db
    .insert(schema.staff)
    .values([
      { businessId, name: "Jonah", color: "violet" },
      { businessId, name: "Aiko", color: "pink" },
    ])
    .returning();
  const staff = { Mia: fixture.staff.id, Jonah: jonah!.id, Aiko: aiko!.id };
  const [colour] = await db
    .insert(schema.services)
    .values({ businessId, name: "Colour Refresh", durationMin: 90, priceCents: 8000 })
    .returning();
  await db.insert(schema.staffServices).values([
    ...Object.values(staff).map((staffId) => ({
      businessId,
      staffId,
      serviceId: fixture.service.id,
    })),
    { businessId, staffId: staff.Mia, serviceId: colour!.id },
    { businessId, staffId: staff.Aiko, serviceId: colour!.id },
  ]);
  await db.insert(schema.availabilityRules).values(
    Object.values(staff).flatMap((staffId) =>
      [2, 3, 4, 5, 6, 0].map((weekday) => ({
        businessId,
        staffId,
        weekday,
        startTime: "09:00",
        endTime: "18:00",
      })),
    ),
  );
  await db.insert(schema.faqs).values({
    businessId,
    question: "Is there parking nearby?",
    answer: "Yes, a public car park two minutes' walk away.",
  });
  return new World(db, fixture, staff, colour!.id, mode);
}

/** The calls of one tool in a turn. */
export const calls = (turn: Turn, name: string) => turn.tools.filter((t) => t.name === name);
