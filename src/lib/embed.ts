import { z } from "zod";

/*
 * The embeddable widget (step 4.8), the parts the app, the settings page and
 * tests share: the owner's options, the snippet they paste, which websites may
 * frame the booking page, and the few messages the iframe sends the host page.
 * The widget itself is embed/embed.ts (plain TypeScript, built to
 * public/embed.js by scripts/build-embed.ts). Client-safe.
 */

export const EMBED_POSITIONS = ["bottom-right", "bottom-left", "inline"] as const;
export type EmbedPosition = (typeof EMBED_POSITIONS)[number];

export type EmbedSettings = {
  /** The floating button's label. */
  buttonText: string;
  /** Floating, bottom right or left; or inline, in a div on the page. */
  position: EmbedPosition;
  /** A chat bubble beside the button (when the business has the AI receptionist). */
  showChat: boolean;
  /** What the button opens. */
  open: "booking" | "chat";
  /** Websites that may show the widget, as origins. Empty: any website. */
  allowedOrigins: string[];
};

export const EMBED_DEFAULTS: EmbedSettings = {
  buttonText: "Book now",
  position: "bottom-right",
  showChat: true,
  open: "booking",
  allowedOrigins: [],
};

export const MAX_BUTTON_TEXT = 24;
export const MAX_ALLOWED_ORIGINS = 10;

/** The stored settings with defaults for anything missing or malformed. */
export function embedSettings(stored: Partial<EmbedSettings> | null | undefined): EmbedSettings {
  const s = stored ?? {};
  return {
    buttonText:
      typeof s.buttonText === "string" && s.buttonText.trim()
        ? s.buttonText.trim().slice(0, MAX_BUTTON_TEXT)
        : EMBED_DEFAULTS.buttonText,
    position: (EMBED_POSITIONS as readonly string[]).includes(s.position ?? "")
      ? (s.position as EmbedPosition)
      : EMBED_DEFAULTS.position,
    showChat: typeof s.showChat === "boolean" ? s.showChat : EMBED_DEFAULTS.showChat,
    open: s.open === "chat" ? "chat" : "booking",
    allowedOrigins: Array.isArray(s.allowedOrigins)
      ? s.allowedOrigins.flatMap((o) => normalizeOrigin(o) ?? []).slice(0, MAX_ALLOWED_ORIGINS)
      : [],
  };
}

/**
 * "https://www.example.com/booking?x" → "https://www.example.com". Owners
 * type sites loosely: a missing scheme means https. Null for anything that
 * isn't an http(s) site (no wildcards, no paths that change the answer).
 */
export function normalizeOrigin(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 200 || /[\s*]/.test(raw)) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The settings form, validated (owners save it on Settings → Embed). */
export const embedSettingsSchema = z.object({
  buttonText: z
    .string()
    .trim()
    .min(1, "Add the button text.")
    .max(MAX_BUTTON_TEXT, `Keep the button text under ${MAX_BUTTON_TEXT} characters.`),
  position: z.enum(EMBED_POSITIONS, "Pick where the widget goes."),
  showChat: z.boolean(),
  open: z.enum(["booking", "chat"], "Pick what the button opens."),
  allowedOrigins: z
    .array(z.string())
    .max(MAX_ALLOWED_ORIGINS, `Up to ${MAX_ALLOWED_ORIGINS} websites.`)
    .transform((list, ctx) => {
      const out: string[] = [];
      for (const entry of list) {
        if (!entry.trim()) continue;
        const origin = normalizeOrigin(entry);
        if (!origin) {
          ctx.addIssue({ code: "custom", message: `"${entry.trim()}" isn't a website address.` });
          return z.NEVER;
        }
        if (!out.includes(origin)) out.push(origin);
      }
      return out;
    }),
});

/**
 * The <script> tag owners paste. Only options that differ from the widget's
 * own defaults (and the business's saved ones) are written out.
 */
export function embedSnippet(appUrl: string, slug: string, s: EmbedSettings): string {
  const attrs: [string, string][] = [["data-business", slug]];
  if (s.position === "inline") {
    attrs.push(["data-mode", "inline"], ["data-target", "#slotwren-booking"]);
  } else {
    attrs.push(["data-position", s.position], ["data-label", s.buttonText]);
    attrs.push(["data-chat", s.showChat ? "on" : "off"]);
  }
  if (s.open === "chat") attrs.push(["data-open", "chat"]);
  const escape = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const lines = attrs.map(([k, v]) => `  ${k}="${escape(v)}"`);
  const src = new URL("/embed.js", appUrl).toString();
  const script = `<script src="${src}"\n${lines.join("\n")}\n  async></script>`;
  return s.position === "inline" ? `<div id="slotwren-booking"></div>\n${script}` : script;
}

/**
 * The CSP frame-ancestors value for a business's embedded booking page: its
 * allowed websites, or any http(s) site when the list is empty.
 */
export function frameAncestors(allowedOrigins: string[]): string {
  return allowedOrigins.length ? allowedOrigins.join(" ") : "https: http:";
}

/** Whether `origin` may show the widget (empty list: any). */
export function originAllowed(allowedOrigins: string[], origin: string | null): boolean {
  if (allowedOrigins.length === 0) return true;
  const normalized = normalizeOrigin(origin ?? "");
  return normalized !== null && allowedOrigins.includes(normalized);
}

/**
 * Messages from the embedded booking page to the host page. Nothing about the
 * customer or the booking: the host learns only that something happened.
 */
export type EmbedMessage =
  | { type: "slotwren:resize"; height: number }
  | { type: "slotwren:close" }
  | { type: "slotwren:booked" };

/** The public config the widget fetches (GET /api/embed/<slug>). */
export type EmbedConfig = {
  name: string;
  buttonText: string;
  position: EmbedPosition;
  /** The chat bubble: the owner wants it and the AI receptionist is available. */
  chat: boolean;
  open: "booking" | "chat";
  /** Accessible button colours from the brand colour (AA). */
  colors: { background: string; foreground: string; hover: string };
};
