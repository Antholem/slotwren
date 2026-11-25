import { describe, expect, it } from "vitest";

import { seedAiConversations } from "../../scripts/seed/ai-conversations";
import { generateLumenData } from "../../scripts/seed/generate";
import { CUSTOMERS } from "../../scripts/seed/lumen-studio";
import { BOOKING_CODE_PATTERN } from "@/server/booking/codes";

const DAY = 86_400_000;
const NOWS = [
  new Date("2026-10-29T03:00:00Z"),
  new Date("2026-11-25T23:30:00Z"), // early morning in Manila
  new Date("2026-12-31T10:00:00Z"),
];

describe.each(NOWS)("seedAiConversations (now = %s)", (now) => {
  const generated = generateLumenData({ now });
  const ai = seedAiConversations({
    now,
    bookings: generated.bookings,
    timeOff: generated.timeOff,
    emailFor: (i) => `c${i}@example.com`,
    customerName: (i) => CUSTOMERS[i]!.name,
  });
  const ids = { booked: "b-booked", moved: "b-moved", cancelled: "b-cancelled" };

  it("has one conversation per outcome, all within the last two weeks", () => {
    expect(ai.conversations.map((c) => c.key)).toEqual([
      "booked",
      "moved",
      "cancelled",
      "handed",
      "faq",
    ]);
    for (const c of ai.conversations) {
      expect(c.startedAt.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(now.getTime() - c.startedAt.getTime()).toBeLessThan(14 * DAY);
      for (const m of c.messages(ids)) {
        expect(m.createdAt.getTime()).toBeGreaterThanOrEqual(c.startedAt.getTime());
      }
    }
  });

  it("records each confirmation and the hand-off the way the chat does", () => {
    const kinds = ai.conversations.flatMap((c) =>
      c
        .messages(ids)
        .flatMap((m) =>
          (m.parts as { type?: string; data?: { kind?: string; confirmed?: boolean } }[])
            .filter((p) => p.type === "data-confirmation" || p.type === "data-handoff")
            .map((p) =>
              p.type === "data-handoff" ? "handoff" : `${p.data!.kind}:${p.data!.confirmed}`,
            ),
        ),
    );
    expect(kinds).toEqual(["book:true", "reschedule:true", "cancel:true", "handoff"]);
    expect(ai.conversations.find((c) => c.key === "handed")!.question).toBeTruthy();
  });

  it("uses tokens like real chats, and has tool calls with their results", () => {
    const messages = ai.conversations.flatMap((c) => c.messages(ids));
    const tokens = messages.reduce((n, m) => n + (m.inputTokens ?? 0) + (m.outputTokens ?? 0), 0);
    expect(tokens).toBeGreaterThan(10_000);
    const calls = JSON.stringify(messages.map((m) => m.parts)).match(/"tool-call"/g) ?? [];
    const results = JSON.stringify(messages.map((m) => m.parts)).match(/"tool-result"/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(results.length).toBe(calls.length);
  });

  it("books only free times: no overlap with generated bookings, time off or each other", () => {
    const busy = [
      ...generated.bookings
        .filter((b) => b.status === "confirmed" || b.status === "pending")
        .map((b) => ({ staff: b.staff, start: b.bufferedStart, end: b.bufferedEnd })),
      ...generated.timeOff.map((t) => ({ staff: t.staff, start: t.startsAt, end: t.endsAt })),
    ];
    const live = ai.bookings.filter((b) => b.status === "confirmed");
    for (const b of live) {
      expect(b.code).toMatch(BOOKING_CODE_PATTERN);
      expect(b.startsAt.getTime()).toBeGreaterThan(now.getTime());
      const clash = busy.some(
        (x) => x.staff === b.staff && x.start < b.endsAt && b.startsAt < x.end,
      );
      expect(clash, `${b.key} clashes`).toBe(false);
    }
    expect(new Set(ai.bookings.map((b) => b.code)).size).toBe(3);
    const seededCodes = new Set(ai.bookings.map((b) => b.code));
    expect(generated.bookings.filter((b) => seededCodes.has(b.code))).toEqual([]);
  });
});
