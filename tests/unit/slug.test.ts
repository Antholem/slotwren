import { describe, expect, it } from "vitest";

import { slugify, slugSchema } from "@/lib/slug";

describe("slugify", () => {
  it.each([
    ["Lumen Studio", "lumen-studio"],
    ["  Lumen   Studio  ", "lumen-studio"],
    ["Café Olé", "cafe-ole"],
    ["Hair & Beauty", "hair-and-beauty"],
    ["Dr. Ana's Clinic!", "dr-ana-s-clinic"],
    ["---", ""],
  ])("%j → %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("caps at 48 characters without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(47)} b`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("slugSchema", () => {
  it.each(["lumen-studio", "abc", "studio-24", "a".repeat(48)])("accepts %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it("normalises case and whitespace", () => {
    expect(slugSchema.parse("  Lumen-Studio ")).toBe("lumen-studio");
  });

  it.each([
    ["ab", "at least 3"],
    ["a".repeat(49), "48 characters"],
    ["-lumen", "not at the start or end"],
    ["lumen-", "not at the start or end"],
    ["lumen studio", "lowercase letters"],
    ["lumen--studio", "single hyphens"],
    ["admin", "reserved"],
  ])("rejects %j (%s)", (slug, reason) => {
    const result = slugSchema.safeParse(slug);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(reason);
  });
});
