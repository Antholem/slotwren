import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "@/lib/result";

describe("Result", () => {
  it("narrows on ok", () => {
    const result: Result<number, "SLOT_TAKEN"> = Math.random() > 2 ? err("SLOT_TAKEN", "x") : ok(1);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toBe(1);
  });

  it("carries a stable code and a user-safe message", () => {
    expect(err("SLOT_TAKEN", "That time was just taken")).toEqual({
      ok: false,
      error: { code: "SLOT_TAKEN", message: "That time was just taken", fieldErrors: undefined },
    });
  });
});
