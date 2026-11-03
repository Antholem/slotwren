import { z } from "zod";

/** Matches the businesses_slug_format check constraint: 3–48 chars, a–z, 0–9, inner hyphens. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;

/** Slugs we keep for ourselves (demo, support pages, obvious impersonation). */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "book",
  "booking",
  "demo",
  "help",
  "slotwren",
  "support",
  "www",
]);

/** "Lumen Studio & Spa" → "lumen-studio-spa". May be too short; validate after. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(48, "Use 48 characters or fewer.")
  .regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens, not at the start or end.")
  .refine((slug) => !slug.includes("--"), "Use single hyphens.")
  .refine((slug) => !RESERVED_SLUGS.has(slug), "That link is reserved. Try another.");
