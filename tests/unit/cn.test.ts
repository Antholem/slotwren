import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("treats the Slotwren type scale as font sizes, keeping text colours", () => {
    expect(cn("text-sm text-primary-foreground", "text-label")).toBe(
      "text-primary-foreground text-label",
    );
    expect(cn("text-body-sm text-muted-foreground", "text-mono")).toBe(
      "text-muted-foreground text-mono",
    );
  });

  it("still lets a later colour win", () => {
    expect(cn("text-foreground", "text-danger-text")).toBe("text-danger-text");
  });
});
