import { describe, expect, it } from "vitest";

import { customerSchema, detailsFormSchema } from "@/lib/validation/booking";

describe("detailsFormSchema", () => {
  it("trims, and turns blank optional fields into null", () => {
    expect(
      detailsFormSchema.parse({
        name: " Ana ",
        email: " ana@example.com ",
        phone: "",
        notes: "  ",
      }),
    ).toEqual({ name: "Ana", email: "ana@example.com", phone: null, notes: null });
  });

  it("produces values the server's check accepts again", () => {
    // The booking page sends the form's parsed values; createBooking parses them again.
    const once = customerSchema.parse({ name: "Ana", email: "ana@example.com", phone: "" });
    expect(customerSchema.parse(once)).toEqual(once);
    expect(
      detailsFormSchema.parse(detailsFormSchema.parse({ name: "Ana", email: "a@b.co" })),
    ).toEqual({
      name: "Ana",
      email: "a@b.co",
      phone: null,
      notes: null,
    });
  });

  it("explains what's wrong in words a customer understands", () => {
    const result = detailsFormSchema.safeParse({ name: "", email: "nope", notes: "x".repeat(501) });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message);
    expect(messages).toEqual([
      "Enter your name.",
      "Enter a valid email address.",
      "Keep notes under 500 characters.",
    ]);
  });
});
