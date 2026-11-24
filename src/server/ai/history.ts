import type { ChatMessage } from "@/lib/chat";

/*
 * A stored conversation (ai_messages rows) as the chat UI's messages, so a
 * refresh shows the same chat: text, tool results (slot chips, Confirm cards,
 * the hand-off form) and confirmations. Pure, for tests.
 *
 * Assistant rows hold either the model's response messages (assistant and
 * tool messages, with tool calls and results) or UI parts written by Confirm
 * and hand-off (text plus a data-confirmation / data-handoff part).
 */

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts: unknown;
};

type Part = ChatMessage["parts"][number];
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/** A tool result's value as the tool returned it. */
function outputValue(output: unknown): unknown {
  if (!isObj(output)) return output;
  if (output.type === "json" || output.type === "text") return output.value;
  return output;
}

function assistantParts(row: StoredMessage): Part[] {
  const stored = Array.isArray(row.parts) ? row.parts : [];
  const responseMessages =
    stored.length > 0 &&
    stored.every((m) => isObj(m) && (m.role === "assistant" || m.role === "tool"));
  if (!responseMessages) {
    // Confirm / hand-off rows (UI parts), or an old text-only row.
    const ui = stored.filter(
      (p): p is Part =>
        isObj(p) &&
        ((p.type === "text" && typeof p.text === "string") ||
          p.type === "data-confirmation" ||
          p.type === "data-handoff"),
    );
    return ui.length ? ui : [{ type: "text", text: row.content }];
  }

  const parts: Part[] = [];
  const tools = new Map<string, Obj>();
  for (const message of stored as Obj[]) {
    const content = message.content;
    if (typeof content === "string") {
      if (content) parts.push({ type: "text", text: content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!isObj(item)) continue;
      if (item.type === "text" && typeof item.text === "string" && item.text) {
        parts.push({ type: "text", text: item.text });
      } else if (item.type === "tool-call" && typeof item.toolCallId === "string") {
        const part: Obj = {
          type: `tool-${String(item.toolName)}`,
          toolCallId: item.toolCallId,
          state: "input-available",
          input: item.input,
        };
        tools.set(item.toolCallId, part);
        parts.push(part as Part);
      } else if (item.type === "tool-result" && typeof item.toolCallId === "string") {
        const part = tools.get(item.toolCallId);
        if (part) {
          part.state = "output-available";
          part.output = outputValue(item.output);
        }
      }
    }
  }
  return parts;
}

export function toChatMessages(rows: StoredMessage[]): ChatMessage[] {
  return rows.flatMap((row): ChatMessage[] => {
    if (row.role === "user") {
      return [{ id: row.id, role: "user", parts: [{ type: "text", text: row.content }] }];
    }
    if (row.role !== "assistant") return [];
    const parts = assistantParts(row);
    return parts.length ? [{ id: row.id, role: "assistant", parts }] : [];
  });
}
