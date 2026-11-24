// Ask the AI receptionist one question from the terminal and print its reply.
//
//   pnpm ai:ask "How much is a haircut?"
//   pnpm ai:ask "And on Saturday?" <conversationId>   # continue a conversation
//
// Talks to a running app (pnpm dev, or pnpm build && pnpm start). Env:
//   AI_ASK_URL   base URL, default http://localhost:3000
//   AI_ASK_SLUG  business slug, default lumen-studio
//
// Prints one JSON line: { status, conversationId, reply, tools }. `tools` lists
// the tool calls the model made, with their inputs and outputs.

const [text, conversationId] = process.argv.slice(2);
if (!text) {
  console.error('Usage: pnpm ai:ask "<question>" [conversationId]');
  process.exit(1);
}

const base = (process.env.AI_ASK_URL ?? "http://localhost:3000").replace(/\/$/, "");
const slug = process.env.AI_ASK_SLUG ?? "lumen-studio";

const res = await fetch(`${base}/api/chat/${slug}`, {
  method: "POST",
  // A documentation-range IP: its own rate-limit bucket, apart from the browser's.
  headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.50" },
  // Offered times come back in this zone (the machine's, like a browser).
  body: JSON.stringify({
    text,
    conversationId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
});
const raw = await res.text();
if (!res.ok) {
  console.log(JSON.stringify({ status: res.status, body: raw }));
  process.exit(1);
}

let reply = "";
let id = conversationId;
const tools = new Map();
for (const line of raw.split("\n")) {
  if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
  const chunk = JSON.parse(line.slice(6));
  if (chunk.type === "text-delta") reply += chunk.delta;
  if (chunk.messageMetadata?.conversationId) id = chunk.messageMetadata.conversationId;
  if (chunk.type === "error") reply += `[error: ${chunk.errorText}]`;
  if (chunk.type === "tool-input-available") {
    tools.set(chunk.toolCallId, { tool: chunk.toolName, input: chunk.input });
  }
  if (chunk.type === "tool-output-available" && tools.has(chunk.toolCallId)) {
    tools.get(chunk.toolCallId).output = chunk.output;
  }
}
console.log(
  JSON.stringify(
    { status: res.status, conversationId: id, reply, tools: [...tools.values()] },
    null,
    2,
  ),
);
