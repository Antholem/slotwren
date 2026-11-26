import { afterAll, describe, it } from "vitest";

import { env } from "@/env";
import { getChatModel } from "@/server/ai/model";

import { connectTestDb } from "../support/db";
import { createWorld, type World } from "./harness";
import { SCRIPTS } from "./scripts";

/*
 * `pnpm ai:eval`: the 15 scripted conversations against the real model that
 * AI_PROVIDER / AI_MODEL pick, with the same checks as CI's mock run. Never
 * part of `pnpm test` or CI (its own Vitest project; a manual GitHub workflow
 * runs it with a repo secret). Use it before switching providers.
 *
 * Free tiers limit requests per minute: AI_EVAL_PAUSE_MS spaces the turns
 * (default 6 s).
 */

const { db, close } = connectTestDb();
const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds) await w.fixture.cleanup();
  await close();
});

const chat = await getChatModel();
const pauseMs = Number(process.env.AI_EVAL_PAUSE_MS ?? 6000);

describe.skipIf(!chat || chat.provider === "mock")(
  `AI receptionist conversations (${env.AI_PROVIDER} · ${chat?.modelId ?? "no key"})`,
  () => {
    it.each(SCRIPTS.map((s) => [s.name, s] as const))("%s", async (_name, script) => {
      const world = await createWorld(db, { kind: "real", pauseMs });
      worlds.push(world);
      await script.run(world);
    });
  },
);
