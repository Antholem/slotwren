import "server-only";

/*
 * The AI chat's POST routes (/api/chat/[slug], …/confirm, …/handoff) only take
 * requests from the app's own pages: the booking page, and the website
 * widget's iframe, which is the booking page too (same origin).
 *
 * - `Content-Type: application/json` is required. Another site can send a
 *   "simple" cross-site request (text/plain, no preflight) from its visitors'
 *   browsers; JSON needs a preflight, which these routes never answer, so the
 *   browser never sends it.
 * - `Sec-Fetch-Site`, when the browser sends it, must be `same-origin`.
 *   Server-to-server callers (and tests) don't send it.
 */

export type CrossSiteRefusal = { status: 403 | 415; message: string };

export function refuseCrossSite(request: Request): CrossSiteRefusal | null {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return { status: 403, message: "Not allowed from another site." };
  }
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return { status: 415, message: "Send the message as JSON." };
  }
  return null;
}
