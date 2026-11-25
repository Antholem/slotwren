/**
 * Five AI receptionist conversations for the Lumen Studio demo, one per
 * outcome on /app/ai: Booked, Rescheduled, Cancelled, Handed off (with an
 * open question) and No action (an FAQ answer). Dated within the last two
 * weeks of the seed time, so the nightly demo reset (this seed) always shows
 * fresh ones and the 90-day retention never removes them.
 *
 * Stored exactly as the chat stores them: customer turns as text, assistant
 * turns as the model's response messages (tool calls and results), and
 * Confirm / hand-off rows with their data parts, so the transcript view, the
 * outcome filters and the token usage all read them like real chats. Pure:
 * seed.ts inserts the result.
 */
import { formatInZone } from "../../src/lib/dates";
import { nextDate, zonedInstant, zonedParts } from "../../src/lib/time-off";
import { gmtOffset } from "../../src/lib/timezones";

import type { GeneratedBooking, GeneratedTimeOff } from "./generate";
import { BUSINESS, HOURS, SERVICES, type ServiceKey, type StaffKey } from "./lumen-studio";

const ZONE = BUSINESS.timezone;
const DAY = 86_400_000;
const MIN = 60_000;

export type SeedBooking = {
  key: "booked" | "moved" | "cancelled";
  code: string;
  staff: StaffKey;
  service: ServiceKey;
  customerIndex: number;
  startsAt: Date;
  endsAt: Date;
  status: "confirmed" | "cancelled";
  source: "ai" | "page" | "widget";
  createdAt: Date;
  cancelledAt: Date | null;
  /** Reschedule: where it was before the chat moved it. */
  movedFrom: Date | null;
};

export type SeedMessage = {
  role: "user" | "assistant";
  content: string;
  parts: unknown[];
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
};

export type SeedConversation = {
  key: "booked" | "moved" | "cancelled" | "handed" | "faq";
  startedAt: Date;
  lastMessageAt: Date;
  customerIndex: number | null;
  visitorName: string | null;
  visitorEmail: string | null;
  outcome: "booked" | "handed_off" | "answered";
  /** Which seeded booking it made or changed. */
  booking: SeedBooking["key"] | null;
  /** Built once the booking ids exist (seed.ts passes them in). */
  messages: (ids: Record<SeedBooking["key"], string>) => SeedMessage[];
  question: string | null;
};

const service = (key: ServiceKey) => SERVICES.find((s) => s.key === key)!;
const day = (d: Date) => formatInZone(d, ZONE, "EEE d MMM");
const time = (d: Date) => formatInZone(d, ZONE, "HH:mm");
const when = (d: Date) => `${day(d)}, ${time(d)} (${gmtOffset(ZONE, d)})`;
const staffName = (key: StaffKey) => key[0]!.toUpperCase() + key.slice(1);
const price = (cents: number) => `$${(cents / 100).toFixed(0)}`;

/**
 * The first start at or after `fromDay` (business-local) inside `staff`'s hours
 * that doesn't touch a generated booking, time off or an earlier pick.
 */
function freeSlot(
  staff: StaffKey,
  durationMin: number,
  fromDay: string,
  taken: { staff: StaffKey; start: Date; end: Date }[],
  times = ["10:30", "11:00", "14:00", "15:00", "10:00", "16:00"],
): Date {
  for (let offset = 0; offset < 30; offset++) {
    const date = nextDate(fromDay, offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const hours = HOURS[staff].find((h) => h.weekday === weekday);
    if (!hours) continue;
    for (const t of times) {
      if (t < hours.start || t >= hours.end) continue;
      const start = zonedInstant(date, t, ZONE);
      const end = new Date(start.getTime() + durationMin * MIN);
      if (time(end) > hours.end) continue;
      const clash = taken.some((b) => b.staff === staff && b.start < end && start < b.end);
      if (!clash) return start;
    }
  }
  throw new Error(`No free seed slot for ${staff}`);
}

/** Model response messages: tool calls, their results, then the reply. */
function assistantTurn(
  calls: { id: string; tool: string; input: unknown; output: unknown }[],
  reply: string,
): unknown[] {
  return [
    {
      role: "assistant",
      content: calls.map((c) => ({
        type: "tool-call",
        toolCallId: c.id,
        toolName: c.tool,
        input: c.input,
      })),
    },
    {
      role: "tool",
      content: calls.map((c) => ({
        type: "tool-result",
        toolCallId: c.id,
        toolName: c.tool,
        output: { type: "json", value: c.output },
      })),
    },
    { role: "assistant", content: [{ type: "text", text: reply }] },
  ];
}

const text = (t: string) => [{ type: "text", text: t }];

export function seedAiConversations({
  now,
  bookings,
  timeOff,
  emailFor,
  customerName,
}: {
  now: Date;
  bookings: GeneratedBooking[];
  timeOff: GeneratedTimeOff[];
  emailFor: (customerIndex: number) => string;
  customerName: (customerIndex: number) => string;
}): { bookings: SeedBooking[]; conversations: SeedConversation[] } {
  const taken = [
    ...bookings
      .filter((b) => b.status === "confirmed" || b.status === "pending")
      .map((b) => ({ staff: b.staff, start: b.bufferedStart, end: b.bufferedEnd })),
    ...timeOff.map((t) => ({ staff: t.staff, start: t.startsAt, end: t.endsAt })),
  ];
  const today = zonedParts(now, ZONE).date;
  const ago = (days: number, hhmm: string) => zonedInstant(nextDate(today, -days), hhmm, ZONE);
  const after = (start: Date, minutes: number) => new Date(start.getTime() + minutes * MIN);

  const haircut = service("haircut");
  const pick = (staff: StaffKey, fromDays: number) => {
    const start = freeSlot(staff, haircut.durationMin, nextDate(today, fromDays), taken);
    const end = after(start, haircut.durationMin);
    taken.push({ staff, start, end });
    return { start, end };
  };

  // ── the bookings the chats made or changed ──
  const booked = pick("jonah", 4);
  const movedTo = pick("mia", 6);
  const movedFrom = pick("mia", 3);
  taken.pop(); // the old time is free again after the move
  const cancelledSlot = pick("aiko", 5);
  taken.pop(); // cancelled: frees the slot

  const bookedAt = ago(2, "16:12");
  const movedAt = ago(5, "11:05");
  const cancelledAt = ago(8, "09:41");
  const seedBookings: SeedBooking[] = [
    {
      key: "booked",
      code: "SW-4MPX-31",
      staff: "jonah",
      service: "haircut",
      customerIndex: 0, // Ana Santos
      startsAt: booked.start,
      endsAt: booked.end,
      status: "confirmed",
      source: "ai",
      createdAt: after(bookedAt, 2),
      cancelledAt: null,
      movedFrom: null,
    },
    {
      key: "moved",
      code: "SW-7HQR-58",
      staff: "mia",
      service: "haircut",
      customerIndex: 3, // Mei Wong
      startsAt: movedTo.start,
      endsAt: movedTo.end,
      status: "confirmed",
      source: "page",
      createdAt: new Date(movedAt.getTime() - 9 * DAY),
      cancelledAt: null,
      movedFrom: movedFrom.start,
    },
    {
      key: "cancelled",
      code: "SW-2KDN-14",
      staff: "aiko",
      service: "haircut",
      customerIndex: 4, // Carlos Reyes
      startsAt: cancelledSlot.start,
      endsAt: cancelledSlot.end,
      status: "cancelled",
      source: "widget",
      createdAt: new Date(cancelledAt.getTime() - 6 * DAY),
      cancelledAt: after(cancelledAt, 2),
      movedFrom: null,
    },
  ];
  const [b1, b2, b3] = seedBookings as [SeedBooking, SeedBooking, SeedBooking];
  const card = (b: SeedBooking, kind: "book" | "reschedule" | "cancel", bookingId: string) => ({
    kind,
    bookingId,
    code: b.code,
    service: haircut.name,
    staff: staffName(b.staff),
    day: day(b.startsAt),
    time: `${time(b.startsAt)} – ${time(b.endsAt)}`,
    email: emailFor(b.customerIndex),
    freeUntil:
      kind === "cancel"
        ? null
        : when(new Date(b.startsAt.getTime() - BUSINESS.cancellationWindowHours * 3_600_000)),
    googleCalendarUrl: null,
    icsPath: null,
  });
  const confirmation = (
    b: SeedBooking,
    kind: "book" | "reschedule" | "cancel",
    bookingId: string,
    message: string,
  ) => [
    { type: "text", text: message },
    {
      type: "data-confirmation",
      data: { proposalId: `seed-${b.key}`, kind, confirmed: true, card: card(b, kind, bookingId) },
    },
  ];
  const offered = (b: SeedBooking) => {
    const others = (["mia", "aiko"] as const).map((staff, i) =>
      after(b.startsAt, (i + 1) * 60 - 90),
    );
    return [
      {
        startsAt: others[0]!.toISOString(),
        when: when(others[0]!),
        day: day(others[0]!),
        time: time(others[0]!),
        staff: "Mia",
      },
      {
        startsAt: b.startsAt.toISOString(),
        when: when(b.startsAt),
        day: day(b.startsAt),
        time: time(b.startsAt),
        staff: "Jonah",
      },
      {
        startsAt: others[1]!.toISOString(),
        when: when(others[1]!),
        day: day(others[1]!),
        time: time(others[1]!),
        staff: "Aiko",
      },
    ];
  };

  const conversations: SeedConversation[] = [
    {
      key: "booked",
      startedAt: bookedAt,
      lastMessageAt: after(bookedAt, 2),
      customerIndex: 0,
      visitorName: null,
      visitorEmail: null,
      outcome: "booked",
      booking: "booked",
      question: null,
      messages: (ids) => {
        const ask = `Anything ${formatInZone(b1.startsAt, ZONE, "EEEE")} morning for a haircut?`;
        const times = offered(b1);
        const reply = `${day(b1.startsAt)} has three openings for a ${haircut.name} (45 min, ${price(haircut.priceCents)}): ${times.map((t) => `${t.time} with ${t.staff}`).join(", ")}. Which suits you?`;
        const proposal = {
          proposalId: "seed-booked",
          kind: "book",
          service: haircut.name,
          staff: "Jonah",
          durationMin: 45,
          startsAt: b1.startsAt.toISOString(),
          when: when(b1.startsAt),
          day: day(b1.startsAt),
          time: `${time(b1.startsAt)} – ${time(b1.endsAt)}`,
          zone: gmtOffset(ZONE, b1.startsAt),
          previousWhen: null,
          price: price(haircut.priceCents),
          code: null,
          customer: { name: null, email: null, phone: null },
          cancellationWindowHours: BUSINESS.cancellationWindowHours,
          expiresAt: after(bookedAt, 11).toISOString(),
        };
        return [
          {
            role: "user",
            content: ask,
            parts: text(ask),
            inputTokens: null,
            outputTokens: null,
            createdAt: bookedAt,
          },
          {
            role: "assistant",
            content: reply,
            parts: assistantTurn(
              [
                {
                  id: "seed-b-1",
                  tool: "checkAvailability",
                  input: {
                    service: haircut.name,
                    date: zonedParts(b1.startsAt, ZONE).date,
                    partOfDay: "morning",
                  },
                  output: {
                    status: "ok",
                    service: { name: haircut.name, durationMin: 45 },
                    staff: "anyone",
                    customerTimezone: ZONE,
                    times,
                    moreTimes: 0,
                    nextOpening: null,
                  },
                },
              ],
              reply,
            ),
            inputTokens: 3412,
            outputTokens: 96,
            createdAt: after(bookedAt, 0.2),
          },
          {
            role: "user",
            content: `${time(b1.startsAt)} with Jonah, please`,
            parts: text(`${time(b1.startsAt)} with Jonah, please`),
            inputTokens: null,
            outputTokens: null,
            createdAt: after(bookedAt, 1),
          },
          {
            role: "assistant",
            content: "Here are the details. Check them and tap Confirm booking.",
            parts: assistantTurn(
              [
                {
                  id: "seed-b-2",
                  tool: "proposeBooking",
                  input: {
                    service: haircut.name,
                    staff: "Jonah",
                    startsAt: b1.startsAt.toISOString(),
                  },
                  output: { status: "proposed", card: proposal },
                },
              ],
              "Here are the details. Check them and tap Confirm booking.",
            ),
            inputTokens: 3987,
            outputTokens: 41,
            createdAt: after(bookedAt, 1.2),
          },
          {
            role: "assistant",
            content: `Booked: ${haircut.name} with Jonah, ${when(b1.startsAt)}. Booking code ${b1.code}.`,
            parts: confirmation(
              b1,
              "book",
              ids.booked,
              `Booked: ${haircut.name} with Jonah, ${when(b1.startsAt)}. Booking code ${b1.code}.`,
            ),
            inputTokens: null,
            outputTokens: null,
            createdAt: after(bookedAt, 2),
          },
        ];
      },
    },
    {
      key: "moved",
      startedAt: movedAt,
      lastMessageAt: after(movedAt, 3),
      customerIndex: 3,
      visitorName: null,
      visitorEmail: null,
      outcome: "answered",
      booking: "moved",
      question: null,
      messages: (ids) => {
        const ask = `Can I move my booking ${b2.code} to ${formatInZone(b2.startsAt, ZONE, "EEEE")}? Email is ${emailFor(3)}`;
        const reply = `Found it: ${haircut.name} with Mia on ${when(b2.movedFrom!)}. ${time(b2.startsAt)} on ${day(b2.startsAt)} is free with Mia. Tap Confirm new time to move it.`;
        return [
          {
            role: "user",
            content: ask,
            parts: text(ask),
            inputTokens: null,
            outputTokens: null,
            createdAt: movedAt,
          },
          {
            role: "assistant",
            content: reply,
            parts: assistantTurn(
              [
                {
                  id: "seed-m-1",
                  tool: "lookUpBooking",
                  input: { code: b2.code, email: emailFor(3) },
                  output: {
                    status: "found",
                    booking: {
                      code: b2.code,
                      service: haircut.name,
                      staff: "Mia",
                      when: when(b2.movedFrom!),
                      status: "confirmed",
                      price: price(haircut.priceCents),
                      canChangeOnline: true,
                    },
                  },
                },
                {
                  id: "seed-m-2",
                  tool: "proposeReschedule",
                  input: { code: b2.code, email: emailFor(3), startsAt: b2.startsAt.toISOString() },
                  output: {
                    status: "proposed",
                    card: {
                      proposalId: "seed-moved",
                      kind: "reschedule",
                      service: haircut.name,
                      staff: "Mia",
                      durationMin: 45,
                      startsAt: b2.startsAt.toISOString(),
                      when: when(b2.startsAt),
                      day: day(b2.startsAt),
                      time: `${time(b2.startsAt)} – ${time(b2.endsAt)}`,
                      zone: gmtOffset(ZONE, b2.startsAt),
                      previousWhen: when(b2.movedFrom!),
                      price: price(haircut.priceCents),
                      code: b2.code,
                      customer: { name: customerName(3), email: emailFor(3), phone: null },
                      cancellationWindowHours: BUSINESS.cancellationWindowHours,
                      expiresAt: after(movedAt, 11).toISOString(),
                    },
                  },
                },
              ],
              reply,
            ),
            inputTokens: 4120,
            outputTokens: 88,
            createdAt: after(movedAt, 0.3),
          },
          {
            role: "assistant",
            content: `Moved: ${haircut.name} with Mia is now ${when(b2.startsAt)}. Booking code ${b2.code}.`,
            parts: confirmation(
              b2,
              "reschedule",
              ids.moved,
              `Moved: ${haircut.name} with Mia is now ${when(b2.startsAt)}. Booking code ${b2.code}.`,
            ),
            inputTokens: null,
            outputTokens: null,
            createdAt: after(movedAt, 3),
          },
        ];
      },
    },
    {
      key: "cancelled",
      startedAt: cancelledAt,
      lastMessageAt: after(cancelledAt, 2),
      customerIndex: 4,
      visitorName: null,
      visitorEmail: null,
      outcome: "answered",
      booking: "cancelled",
      question: null,
      messages: (ids) => {
        const ask = `I need to cancel ${b3.code}, sorry. ${emailFor(4)}`;
        const reply = `No problem. That's ${haircut.name} with Aiko on ${when(b3.startsAt)}. Tap Cancel booking to confirm.`;
        return [
          {
            role: "user",
            content: ask,
            parts: text(ask),
            inputTokens: null,
            outputTokens: null,
            createdAt: cancelledAt,
          },
          {
            role: "assistant",
            content: reply,
            parts: assistantTurn(
              [
                {
                  id: "seed-c-1",
                  tool: "proposeCancel",
                  input: { code: b3.code, email: emailFor(4) },
                  output: {
                    status: "proposed",
                    card: {
                      proposalId: "seed-cancelled",
                      kind: "cancel",
                      service: haircut.name,
                      staff: "Aiko",
                      durationMin: 45,
                      startsAt: b3.startsAt.toISOString(),
                      when: when(b3.startsAt),
                      day: day(b3.startsAt),
                      time: `${time(b3.startsAt)} – ${time(b3.endsAt)}`,
                      zone: gmtOffset(ZONE, b3.startsAt),
                      previousWhen: null,
                      price: price(haircut.priceCents),
                      code: b3.code,
                      customer: { name: customerName(4), email: emailFor(4), phone: null },
                      cancellationWindowHours: BUSINESS.cancellationWindowHours,
                      expiresAt: after(cancelledAt, 11).toISOString(),
                    },
                  },
                },
              ],
              reply,
            ),
            inputTokens: 3655,
            outputTokens: 52,
            createdAt: after(cancelledAt, 0.3),
          },
          {
            role: "assistant",
            content: `Cancelled: ${haircut.name} on ${when(b3.startsAt)} (booking ${b3.code}).`,
            parts: confirmation(
              b3,
              "cancel",
              ids.cancelled,
              `Cancelled: ${haircut.name} on ${when(b3.startsAt)} (booking ${b3.code}).`,
            ),
            inputTokens: null,
            outputTokens: null,
            createdAt: after(cancelledAt, 2),
          },
        ];
      },
    },
    {
      key: "handed",
      startedAt: ago(1, "15:40"),
      lastMessageAt: after(ago(1, "15:40"), 2),
      customerIndex: 1, // Liam Ortiz
      visitorName: "Liam Ortiz",
      visitorEmail: emailFor(1),
      outcome: "handed_off",
      booking: null,
      question: "Can I bring my own hair dye for a colour refresh?",
      messages: () => {
        const at = ago(1, "15:40");
        const ask = "Can I bring my own hair dye for a colour refresh?";
        const notSure = "I'm not sure — I can pass this to the team.";
        const sent = "Thanks, I've passed your question to the team. Someone will reply by email.";
        return [
          {
            role: "user",
            content: ask,
            parts: text(ask),
            inputTokens: null,
            outputTokens: null,
            createdAt: at,
          },
          {
            role: "assistant",
            content: notSure,
            parts: [
              {
                role: "assistant",
                content: [
                  { type: "text", text: notSure },
                  {
                    type: "tool-call",
                    toolCallId: "seed-h-1",
                    toolName: "offerHandoff",
                    input: { question: ask },
                  },
                ],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: "seed-h-1",
                    toolName: "offerHandoff",
                    output: { type: "json", value: { status: "handoff", question: ask } },
                  },
                ],
              },
            ],
            inputTokens: 2988,
            outputTokens: 37,
            createdAt: after(at, 0.2),
          },
          {
            role: "assistant",
            content: sent,
            parts: [
              { type: "text", text: sent },
              { type: "data-handoff", data: { sent: true } },
            ],
            inputTokens: null,
            outputTokens: null,
            createdAt: after(at, 2),
          },
        ];
      },
    },
    {
      key: "faq",
      startedAt: ago(0, "09:15") > now ? ago(1, "18:20") : ago(0, "09:15"),
      lastMessageAt: ago(0, "09:15") > now ? after(ago(1, "18:20"), 1) : after(ago(0, "09:15"), 1),
      customerIndex: null,
      visitorName: null,
      visitorEmail: null,
      outcome: "answered",
      booking: null,
      question: null,
      messages: () => {
        const at = ago(0, "09:15") > now ? ago(1, "18:20") : ago(0, "09:15");
        const ask = "Is there parking near the studio?";
        // The FAQ's own answer (lumen-studio.ts), as the assistant gives it.
        const reply =
          "Yes, there's a public car park two minutes' walk away. Street parking is limited.";
        return [
          {
            role: "user",
            content: ask,
            parts: text(ask),
            inputTokens: null,
            outputTokens: null,
            createdAt: at,
          },
          {
            role: "assistant",
            content: reply,
            parts: text(reply),
            inputTokens: 2875,
            outputTokens: 29,
            createdAt: after(at, 0.1),
          },
        ];
      },
    },
  ];

  return { bookings: seedBookings, conversations };
}
