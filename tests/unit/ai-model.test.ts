import { describe, expect, it } from "vitest";

import { chatModelConfig, DEFAULT_MODELS } from "@/server/ai/model";

/* AI_PROVIDER + AI_MODEL pick the model; a missing key means no model (503), not a crash. */

const keys = { GOOGLE_GENERATIVE_AI_API_KEY: "g-key", ANTHROPIC_API_KEY: "a-key" };

describe("chatModelConfig", () => {
  it("defaults to the current Gemini Flash model", () => {
    expect(chatModelConfig({ AI_PROVIDER: "gemini", ...keys })).toEqual({
      provider: "gemini",
      modelId: DEFAULT_MODELS.gemini,
      apiKey: "g-key",
    });
    expect(DEFAULT_MODELS.gemini).toBe("gemini-3.5-flash-lite");
  });

  it("switches provider and model by config alone", () => {
    expect(chatModelConfig({ AI_PROVIDER: "anthropic", ...keys })).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-5-5",
      apiKey: "a-key",
    });
    expect(
      chatModelConfig({ AI_PROVIDER: "gemini", AI_MODEL: "gemini-3.6-flash", ...keys })?.modelId,
    ).toBe("gemini-3.6-flash");
  });

  it("is null without the selected provider's key, even if the other one is set", () => {
    expect(chatModelConfig({ AI_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a-key" })).toBeNull();
    expect(
      chatModelConfig({ AI_PROVIDER: "anthropic", GOOGLE_GENERATIVE_AI_API_KEY: "g-key" }),
    ).toBeNull();
  });
});
