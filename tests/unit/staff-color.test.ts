import { describe, expect, it } from "vitest";

import { staffColorFor } from "@/server/db/schema";

describe("staffColorFor", () => {
  it("cycles teal, violet, pink in order", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(staffColorFor)).toEqual([
      "teal",
      "violet",
      "pink",
      "teal",
      "violet",
      "pink",
      "teal",
    ]);
  });
});
