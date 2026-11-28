import { randomUUID } from "node:crypto";

import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as confirmRoute } from "@/app/api/chat/[slug]/confirm/route";
import { POST as handoffRoute } from "@/app/api/chat/[slug]/handoff/route";
import { POST as chatRoute } from "@/app/api/chat/[slug]/route";
import { mockReceptionistModel } from "@/server/ai/mock-model";
import type { ChatModel } from "@/server/ai/model";
import * as schema from "@/server/db/schema";

import { connectTestDb, createFixtureBusiness } from "../support/db";

/*
 * Another website can make its visitors' browsers POST to the chat: a
 * "simple" text/plain request needs no preflight, so it would arrive (and
 * spend model calls) even though that site can't read the answer. The chat,
 * Confirm and hand-off routes take JSON only, and refuse a browser that says
 * the request is cross-site. Nothing is saved or spent for a refused one.
 */

const model = vi.hoisted(() => ({ current: null as ChatModel | null }));
vi.mock("@/server/ai/model", () => ({ getChatModel: () => model.current }));

/** The three routes, called the same way (each takes the slug). */
type Route = (
  request: Request,
  context: { params: Promise<{ slug: string }> },
) => Promise<Response>;
const ROUTES: [string, Route, string][] = [
  ["chat", chatRoute as unknown as Route, ""],
  ["confirm", confirmRoute as unknown as Route, "/confirm"],
  ["hand-off", handoffRoute as unknown as Route, "/handoff"],
];

let ip = 0;
const nextIp = () => `198.18.80.${(ip++ % 250) + 1}`;

describe("chat POSTs from another site", () => {
  const { db, close } = connectTestDb();
  let a: Awaited<ReturnType<typeof createFixtureBusiness>>;
  const mock = mockReceptionistModel();

  const post = (route: Route, path: string, headers: Record<string, string>, body: unknown) =>
    route(
      new Request(`http://localhost/api/chat/${a.business.slug}${path}`, {
        method: "POST",
        headers: { "x-forwarded-for": nextIp(), ...headers },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ slug: a.business.slug }) },
    );

  const bodyFor = (path: string) =>
    path === "/confirm"
      ? { conversationId: randomUUID(), proposalId: randomUUID() }
      : path === "/handoff"
        ? { name: "Sam", email: `sam-${randomUUID().slice(0, 6)}@example.com`, message: "Hi?" }
        : { text: "Hello" };

  const saved = async () => {
    const [conversations] = await db
      .select({ n: count() })
      .from(schema.aiConversations)
      .where(eq(schema.aiConversations.businessId, a.business.id));
    const [questions] = await db
      .select({ n: count() })
      .from(schema.handoffRequests)
      .where(eq(schema.handoffRequests.businessId, a.business.id));
    return { conversations: conversations!.n, questions: questions!.n };
  };

  beforeAll(async () => {
    a = await createFixtureBusiness(db);
    await db
      .update(schema.businesses)
      .set({ onboardedAt: new Date(), aiEnabled: true, plan: "pro" })
      .where(eq(schema.businesses.id, a.business.id));
    model.current = { model: mock, provider: "mock", modelId: "mock", timeoutMs: 5_000 };
  });

  afterAll(async () => {
    await a?.cleanup();
    await close();
  });

  it.each(ROUTES)(
    "%s: a text/plain POST (no preflight) is refused, nothing saved",
    async (_n, route, path) => {
      const before = await saved();
      const response = await post(route, path, { "content-type": "text/plain" }, bodyFor(path));
      expect(response.status).toBe(415);
      expect(await response.json()).toMatchObject({ error: "bad_request" });
      expect(await saved()).toEqual(before);
      expect(mock.doStreamCalls).toHaveLength(0);
    },
  );

  it.each(ROUTES)("%s: no Content-Type at all is refused too", async (_n, route, path) => {
    const response = await post(route, path, {}, bodyFor(path));
    expect(response.status).toBe(415);
  });

  it.each(ROUTES)(
    "%s: JSON a browser marks cross-site (or same-site) is refused",
    async (_n, route, path) => {
      for (const site of ["cross-site", "same-site", "none"]) {
        const response = await post(
          route,
          path,
          { "content-type": "application/json", "sec-fetch-site": site },
          bodyFor(path),
        );
        expect(response.status, site).toBe(403);
      }
      expect(mock.doStreamCalls).toHaveLength(0);
    },
  );

  it("same-origin JSON (the booking page, the widget's iframe) is answered", async () => {
    const response = await post(
      chatRoute as unknown as Route,
      "",
      { "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" },
      { text: "Hello" },
    );
    expect(response.status).toBe(200);
    await response.text();
    // A server-to-server caller sends no Sec-Fetch-Site: JSON is enough.
    const handoff = await post(
      handoffRoute as unknown as Route,
      "/handoff",
      { "content-type": "application/json" },
      bodyFor("/handoff"),
    );
    expect(handoff.status).toBe(200);
  });
});
