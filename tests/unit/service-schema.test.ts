import { describe, expect, it } from "vitest";

import { firstServiceSchemaFor, serviceFormSchemaFor } from "@/lib/validation/services";

/* One service schema: onboarding's first service and the side sheet agree. */

const first = {
  name: "Haircut",
  description: "",
  durationMin: "45",
  price: "35",
  bufferAfterMin: "15",
};
const sheet = {
  ...first,
  bufferBeforeMin: "0",
  active: true,
  staffIds: ["7b0d1c3e-5d1a-4c2b-9a51-3b6f5f8f2a10"],
};

describe("service schema", () => {
  it("reads the same values the same way in both forms", () => {
    const a = firstServiceSchemaFor("USD").parse(first);
    const b = serviceFormSchemaFor("USD").parse(sheet);
    expect(a).toEqual({
      name: "Haircut",
      description: null,
      durationMin: 45,
      price: 3500,
      bufferAfterMin: 15,
    });
    expect(b).toMatchObject(a);
  });

  it.each([
    ["a 105-minute service", { durationMin: "105" }, true],
    ["a 45-minute clean-up", { bufferAfterMin: "45" }, true],
    ["a duration off the 5-minute steps", { durationMin: "47" }, false],
    ["more than 8 hours", { durationMin: "485" }, false],
    ["a one-letter name", { name: "H" }, false],
    ["a thousands comma in dollars", { price: "1,234" }, true],
  ])("%s: the same answer in both", (_case, change, valid) => {
    expect(firstServiceSchemaFor("USD").safeParse({ ...first, ...change }).success).toBe(valid);
    expect(serviceFormSchemaFor("USD").safeParse({ ...sheet, ...change }).success).toBe(valid);
  });

  it("only the sheet asks who offers it", () => {
    expect(serviceFormSchemaFor("USD").safeParse({ ...sheet, staffIds: [] }).success).toBe(false);
    expect(firstServiceSchemaFor("USD").safeParse(first).success).toBe(true);
  });
});
