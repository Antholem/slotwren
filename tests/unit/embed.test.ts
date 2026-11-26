import { describe, expect, it } from "vitest";

import {
  EMBED_DEFAULTS,
  embedSettings,
  embedSettingsSchema,
  embedSnippet,
  frameAncestors,
  normalizeOrigin,
  originAllowed,
} from "@/lib/embed";

const APP = "https://slotwren.vercel.app";

describe("normalizeOrigin", () => {
  it.each([
    ["https://www.example.com", "https://www.example.com"],
    ["https://www.example.com/booking?x=1#top", "https://www.example.com"],
    ["www.example.com", "https://www.example.com"],
    ["  Example.COM/  ", "https://example.com"],
    ["http://shop.example.co.uk:8080/path", "http://shop.example.co.uk:8080"],
    ["http://localhost:3200", "http://localhost:3200"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "not a website",
    "*.example.com",
    "https://*.example.com",
    "ftp://example.com",
    "javascript:alert(1)",
    "example",
    `https://${"a".repeat(200)}.com`,
  ])("refuses %j", (input) => {
    expect(normalizeOrigin(input)).toBeNull();
  });

  it("refuses non-strings", () => {
    expect(normalizeOrigin(null)).toBeNull();
    expect(normalizeOrigin(42)).toBeNull();
  });
});

describe("embedSettings", () => {
  it("fills in defaults for nothing stored", () => {
    expect(embedSettings(undefined)).toEqual(EMBED_DEFAULTS);
    expect(embedSettings(null)).toEqual(EMBED_DEFAULTS);
    expect(embedSettings({})).toEqual(EMBED_DEFAULTS);
  });

  it("keeps valid values and replaces malformed ones", () => {
    expect(
      embedSettings({
        buttonText: "  Book a visit  ",
        position: "sideways" as never,
        showChat: "yes" as never,
        open: "chat",
        allowedOrigins: ["www.example.com", "not a website", "https://shop.example.com/x"],
      }),
    ).toEqual({
      buttonText: "Book a visit",
      position: "bottom-right",
      showChat: true,
      open: "chat",
      allowedOrigins: ["https://www.example.com", "https://shop.example.com"],
    });
  });

  it("caps the label length and falls back for a blank one", () => {
    expect(embedSettings({ buttonText: "x".repeat(40) }).buttonText).toHaveLength(24);
    expect(embedSettings({ buttonText: "   " }).buttonText).toBe("Book now");
  });
});

describe("embedSettingsSchema", () => {
  const valid = { ...EMBED_DEFAULTS, allowedOrigins: [] as string[] };

  it("normalises and de-duplicates allowed websites, skipping blank lines", () => {
    const parsed = embedSettingsSchema.parse({
      ...valid,
      allowedOrigins: ["www.example.com", "", "https://www.example.com/book", "  "],
    });
    expect(parsed.allowedOrigins).toEqual(["https://www.example.com"]);
  });

  it("names the entry that isn't a website", () => {
    const result = embedSettingsSchema.safeParse({
      ...valid,
      allowedOrigins: ["www.example.com", " not a website "],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(`"not a website" isn't a website address.`);
  });

  it.each([
    [{ buttonText: "" }, "Add the button text."],
    [{ buttonText: "x".repeat(25) }, "Keep the button text under 24 characters."],
    [{ position: "top" }, "Pick where the widget goes."],
    [{ open: "both" }, "Pick what the button opens."],
    [
      { allowedOrigins: Array.from({ length: 11 }, (_, i) => `site${i}.com`) },
      "Up to 10 websites.",
    ],
  ])("refuses %j", (patch, message) => {
    const result = embedSettingsSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});

describe("embedSnippet", () => {
  it("writes the floating button's options", () => {
    expect(embedSnippet(APP, "lumen-studio", EMBED_DEFAULTS)).toBe(
      `<script src="https://slotwren.vercel.app/embed.js"
  data-business="lumen-studio"
  data-position="bottom-right"
  data-label="Book now"
  data-chat="on"
  async></script>`,
    );
  });

  it("opens straight into the chat when chosen", () => {
    const snippet = embedSnippet(APP, "lumen-studio", {
      ...EMBED_DEFAULTS,
      position: "bottom-left",
      showChat: false,
      open: "chat",
    });
    expect(snippet).toContain('data-position="bottom-left"');
    expect(snippet).toContain('data-chat="off"');
    expect(snippet).toContain('data-open="chat"');
  });

  it("inline mode comes with the div it renders into", () => {
    const snippet = embedSnippet(APP, "lumen-studio", { ...EMBED_DEFAULTS, position: "inline" });
    expect(snippet.startsWith('<div id="slotwren-booking"></div>\n<script')).toBe(true);
    expect(snippet).toContain('data-mode="inline"');
    expect(snippet).toContain('data-target="#slotwren-booking"');
    expect(snippet).not.toContain("data-label");
  });

  it("escapes the label", () => {
    const snippet = embedSnippet(APP, "lumen-studio", {
      ...EMBED_DEFAULTS,
      buttonText: `Book "now" <b>&</b>`,
    });
    expect(snippet).toContain('data-label="Book &quot;now&quot; &lt;b>&amp;&lt;/b>"');
  });
});

describe("framing", () => {
  it("any http(s) site may frame the embedded page when no list is set", () => {
    expect(frameAncestors([])).toBe("https: http:");
    expect(originAllowed([], "https://anything.example")).toBe(true);
    expect(originAllowed([], null)).toBe(true);
  });

  it("only listed websites when it is", () => {
    const list = ["https://www.example.com", "https://shop.example.com"];
    expect(frameAncestors(list)).toBe("https://www.example.com https://shop.example.com");
    expect(originAllowed(list, "https://www.example.com")).toBe(true);
    expect(originAllowed(list, "https://evil.example")).toBe(false);
    expect(originAllowed(list, "http://www.example.com")).toBe(false);
    expect(originAllowed(list, null)).toBe(false);
    expect(originAllowed(list, "null")).toBe(false);
  });
});
