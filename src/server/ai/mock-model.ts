import "server-only";

import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { NOT_SURE_REPLY } from "./prompt";

/*
 * AI_PROVIDER=mock: a scripted receptionist with no key and no network, for
 * Playwright (CI has no AI keys) and for working on the chat UI. It reads the
 * same system prompt and conversation a real model gets and calls the same
 * tools, so the whole flow runs for real: tools, proposals, Confirm. env.ts
 * refuses it on Vercel Production.
 *
 * The customer's latest message picks the move:
 * - "Sat 28 Nov, 10:30 with Mia" (a chip) → proposeBooking for that offered time
 * - book / haircut / available / Saturday → checkAvailability, then offer times
 * - team / parking / tattoo / not sure    → the not-sure line + offerHandoff
 * - contains "[fail]"                     → an error the first time, fine on Retry
 * - contains "[stall]"                    → no reply the first time (the timeout), fine on Retry
 * - contains "[loop]"                     → calls a tool every step (the step cap ends it)
 * - code / homework / legal / medical / other companies / "ignore your instructions"
 *                                         → a polite refusal that steers back to booking
 * - anything else                         → a short greeting
 */

type Prompt = Parameters<MockLanguageModelV4["doStream"]>[0]["prompt"];
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer T>
    ? T
    : never;
type Obj = Record<string, unknown>;

/** Messages that already failed once (per process): Retry then succeeds. */
const failedOnce = new Set<string>();
let calls = 0;

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

function text(reply: string): StreamPart[] {
  const words = reply.split(/(?<= )/);
  return [
    { type: "text-start", id: "t" },
    ...words.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ];
}

function call(toolName: string, input: unknown): StreamPart[] {
  return [
    {
      type: "tool-call",
      toolCallId: `mock-${++calls}`,
      toolName,
      input: JSON.stringify(input),
    },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ];
}

const systemText = (prompt: Prompt) =>
  prompt
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

/** The business data block from the system prompt. */
function businessData(prompt: Prompt): { services?: { name: string }[] } {
  const match = /<business_data>\n([\s\S]*?)\n<\/business_data>/.exec(systemText(prompt));
  try {
    return match ? (JSON.parse(match[1]!) as { services?: { name: string }[] }) : {};
  } catch {
    return {};
  }
}

/** The first calendar date at least two days out: clear of minimum notice. */
function dayAfterTomorrow(prompt: Prompt): string | null {
  const dates = [...systemText(prompt).matchAll(/= (\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]!);
  return dates[2] ?? null;
}

const userText = (message: Prompt[number] | undefined) =>
  message?.role === "user"
    ? message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim()
    : "";

/** Every tool result so far, newest last. */
function toolResults(prompt: Prompt): { toolName: string; value: Obj }[] {
  return prompt.flatMap((m) =>
    m.role === "tool"
      ? m.content.flatMap((part) => {
          if (part.type !== "tool-result") return [];
          const output = part.output as { type: string; value?: unknown };
          const value = output.type === "json" ? output.value : null;
          return value && typeof value === "object"
            ? [{ toolName: part.toolName, value: value as Obj }]
            : [];
        })
      : [],
  );
}

/** What to say after a tool ran. */
function afterTool(result: { toolName: string; value: Obj }): StreamPart[] {
  const { toolName, value } = result;
  if (toolName === "checkAvailability") {
    const times = (value.times as unknown[] | undefined) ?? [];
    return text(
      times.length
        ? "Here are the free times. Which suits you?"
        : "Nothing is free then. Would another day work?",
    );
  }
  if (toolName === "proposeBooking" || toolName === "proposeReschedule") {
    return text(
      value.status === "proposed"
        ? "Here are the details. Check them and tap Confirm booking."
        : String(value.message ?? "That time isn't available."),
    );
  }
  // The form says it all; end the turn.
  if (toolName === "offerHandoff") {
    return [{ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage }];
  }
  return text("Done.");
}

/** What a well-behaved model says to an off-topic or jailbreak message (prompt rule 9). */
const OFF_TOPIC =
  /\b(write (some |me )?code|coding|programming|python|javascript|homework|essay|poem|lawyer|legal|medical|doctor|diagnos\w*|stocks?|crypto|competitors?|other salons?|system prompt|jailbreak|ignore (all |your |the )?(previous )?(instructions|rules))\b/i;

function reply(prompt: Prompt): StreamPart[] | "fail" | "stall" {
  const last = prompt.at(-1);
  // "[loop]": a model that never stops calling tools.
  if (userText(prompt.findLast((m) => m.role === "user")).includes("[loop]")) {
    return call("listServices", {});
  }
  if (last?.role === "tool") {
    const results = toolResults(prompt);
    return afterTool(results.at(-1)!);
  }
  const said = userText(last);
  const lower = said.toLowerCase();

  for (const marker of ["[fail]", "[stall]"] as const) {
    if (!said.includes(marker)) continue;
    const key = `${marker}${said}`;
    if (!failedOnce.has(key)) {
      failedOnce.add(key);
      return marker === "[fail]" ? "fail" : "stall";
    }
    return text("Sorry about that. I'm here now: how can I help?");
  }

  if (OFF_TOPIC.test(said)) {
    const data = businessData(prompt) as { business?: { name?: string } };
    return text(
      `I can only help with ${data.business?.name ?? "this business"} and booking here. Would you like to book an appointment or ask about our services?`,
    );
  }

  // A slot chip: "10:30 with Mia, please".
  const chip = /(\d{1,2}:\d{2}) with ([^,.!?]+)/i.exec(said);
  if (chip) {
    const [, time, staff] = chip;
    const checked = toolResults(prompt)
      .filter((r) => r.toolName === "checkAvailability" && r.value.status === "ok")
      .at(-1)?.value;
    const offered =
      (checked?.times as { startsAt: string; day: string; time: string; staff: string }[]) ?? [];
    // "Sat 28 Nov, 10:30 with Mia": the day too, when the chip named one.
    const named = offered.some((t) => said.includes(t.day));
    const pick = offered.find(
      (t) =>
        t.time === time &&
        t.staff.toLowerCase() === staff!.trim().toLowerCase() &&
        (!named || said.includes(t.day)),
    );
    const service = (checked?.service as { id: string } | undefined)?.id;
    if (pick && service) {
      return call("proposeBooking", { service, staff: pick.staff, startsAt: pick.startsAt });
    }
  }

  if (/\b(book|haircut|appointment|available|free|saturday|time)\b/i.test(lower)) {
    const service = businessData(prompt).services?.[0]?.name;
    const date = dayAfterTomorrow(prompt);
    if (service && date) return call("checkAvailability", { service, date, days: 3 });
  }

  if (/\b(team|parking|tattoo|tattoos|dye|not sure)\b/i.test(lower)) {
    return [...text(NOT_SURE_REPLY).slice(0, -1), ...call("offerHandoff", { question: said })];
  }

  return text("Hi! I can answer questions or book you in.");
}

/** A fresh mock receptionist model. */
export function mockReceptionistModel() {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-receptionist",
    doStream: async ({ prompt }) => {
      const next = reply(prompt);
      if (next === "fail") {
        return {
          stream: simulateReadableStream<StreamPart>({
            chunks: [{ type: "error", error: new Error("Mock provider failure") }],
          }),
        };
      }
      if (next === "stall") {
        // Never answers: the route's timeout ends it.
        return { stream: new ReadableStream<StreamPart>() };
      }
      return {
        stream: simulateReadableStream({ chunks: next, chunkDelayInMs: 15 }),
      };
    },
  });
}
