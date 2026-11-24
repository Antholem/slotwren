import { describe, expect, it } from "vitest";

import { type StoredMessage, toChatMessages } from "@/server/ai/history";

/*
 * A stored conversation back into the chat's messages after a refresh: text,
 * tool calls with their results (chips, Confirm cards, the hand-off form) and
 * the confirmation and hand-off rows.
 */

const card = { proposalId: "p1", kind: "book" };

describe("toChatMessages", () => {
  it("rebuilds text, tool results and data parts in order", () => {
    const rows: StoredMessage[] = [
      { id: "u1", role: "user", content: "Anything Saturday?", parts: [] },
      {
        id: "a1",
        role: "assistant",
        content: "Here are the times.",
        parts: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "c1",
                toolName: "checkAvailability",
                input: { date: "2026-11-28" },
                providerOptions: { google: { thoughtSignature: "x" } },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "c1",
                toolName: "checkAvailability",
                output: { type: "json", value: { status: "ok", times: [] } },
              },
            ],
          },
          { role: "assistant", content: [{ type: "text", text: "Here are the times." }] },
        ],
      },
      {
        id: "a2",
        role: "assistant",
        content: "Booked: …",
        parts: [
          { type: "text", text: "Booked: …" },
          { type: "data-confirmation", data: { ...card, confirmed: true } },
        ],
      },
      {
        id: "a3",
        role: "assistant",
        content: "Thanks",
        parts: [
          { type: "text", text: "Thanks" },
          { type: "data-handoff", data: { sent: true } },
        ],
      },
      { id: "s1", role: "system", content: "never shown", parts: [] },
    ];
    expect(toChatMessages(rows)).toEqual([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Anything Saturday?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-checkAvailability",
            toolCallId: "c1",
            state: "output-available",
            input: { date: "2026-11-28" },
            output: { status: "ok", times: [] },
          },
          { type: "text", text: "Here are the times." },
        ],
      },
      {
        id: "a2",
        role: "assistant",
        parts: [
          { type: "text", text: "Booked: …" },
          { type: "data-confirmation", data: { ...card, confirmed: true } },
        ],
      },
      {
        id: "a3",
        role: "assistant",
        parts: [
          { type: "text", text: "Thanks" },
          { type: "data-handoff", data: { sent: true } },
        ],
      },
    ]);
  });

  it("keeps a tool call without a result as still running, and old text-only rows as text", () => {
    const messages = toChatMessages([
      {
        id: "a1",
        role: "assistant",
        content: "",
        parts: [
          {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "c1", toolName: "listServices", input: {} }],
          },
        ],
      },
      { id: "a2", role: "assistant", content: "Hello", parts: [{ type: "text", text: "Hello" }] },
      { id: "a3", role: "assistant", content: "Plain", parts: [] },
    ]);
    expect(messages[0]!.parts[0]).toMatchObject({
      type: "tool-listServices",
      state: "input-available",
    });
    expect(messages[1]!.parts).toEqual([{ type: "text", text: "Hello" }]);
    expect(messages[2]!.parts).toEqual([{ type: "text", text: "Plain" }]);
  });

  it("drops unknown part types rather than passing them to the browser", () => {
    const [message] = toChatMessages([
      {
        id: "a1",
        role: "assistant",
        content: "Hi",
        parts: [
          { type: "text", text: "Hi" },
          { type: "something-else", secret: 1 },
        ],
      },
    ]);
    expect(message!.parts).toEqual([{ type: "text", text: "Hi" }]);
  });
});
