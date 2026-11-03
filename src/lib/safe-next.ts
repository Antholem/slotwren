/** Where a signed-in user lands when there's nowhere better to go. */
export const DEFAULT_SIGNED_IN_PATH = "/app";

/**
 * Accept a post-sign-in destination only if it's a path on this site, so a
 * crafted `?next=https://evil.example` link can't turn sign-in into an open
 * redirect. Anything else falls back to the dashboard.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return DEFAULT_SIGNED_IN_PATH;
  // "//host" and "/\host" are protocol-relative URLs in browsers.
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_SIGNED_IN_PATH;
  // Control characters (tabs, newlines) are stripped by URL parsers and can
  // turn "/\t/evil.example" into "//evil.example".
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_SIGNED_IN_PATH;
  return value;
}
