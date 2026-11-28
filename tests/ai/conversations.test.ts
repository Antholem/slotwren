import { afterAll, describe, it, vi } from "vitest";

import type { ChatModel } from "@/server/ai/model";

import { connectTestDb } from "../support/db";
import { createWorld, type World } from "./harness";
import { SCRIPTS } from "./scripts";

/*
 * The AI receptionist's 19 scripted conversations with the scripted mock
 * model (never a real provider or key), in CI. `pnpm ai:eval` runs the same
 * scripts against the real model (tests/ai/eval.test.ts).
 */

const model = vi.hoisted(() => ({ current: null as ChatModel | null }));
vi.mock("@/server/ai/model", () => ({ getChatModel: () => model.current }));

const { db, close } = connectTestDb();
const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds) await w.fixture.cleanup();
  await close();
});

describe("AI receptionist conversations (mock model)", () => {
  it.each(SCRIPTS.map((s) => [s.name, s] as const))("%s", async (_name, script) => {
    const world = await createWorld(db, {
      kind: "mock",
      setModel: (m) => {
        model.current = m;
      },
    });
    worlds.push(world);
    await script.run(world);
  });
});
