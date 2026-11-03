import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it.each(["/app", "/app/calendar?view=week", "/onboarding"])("keeps the local path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["app"],
    ["https://evil.example/app"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["/\t/evil.example"],
    ["/\n/evil.example"],
    ["javascript:alert(1)"],
  ])("falls back to the dashboard for %j", (value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});
