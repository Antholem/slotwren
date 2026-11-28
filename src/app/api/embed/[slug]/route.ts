import { type EmbedConfig, originAllowed } from "@/lib/embed";
import { brandTheme } from "@/lib/brand-theme";
import { SLUG_PATTERN } from "@/lib/slug";
import { getEmbedSettings } from "@/server/db/queries/public/embed";
import { getPublicBusinessBySlug } from "@/server/db/queries/public/business";

/*
 * GET /api/embed/<slug>: what the website widget (public/embed.js) needs to
 * draw its button: name, label, position, chat and accessible colours. Public
 * fields only; any site may fetch it (CORS *), except that a business with an
 * "Allowed websites" list answers 403 to every other site, so the widget
 * doesn't show there (the booking page refuses to be framed there too).
 * Cached briefly, so option changes reach sites within minutes: in shared
 * caches only when there's no allowed list (the answer then varies by Origin).
 */

const SLOTWREN_TEAL = { background: "#0F766E", foreground: "#FFFFFF", hover: "#115E59" };

const headers = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": "*",
  Vary: "Origin",
  ...extra,
});

export async function GET(request: Request, { params }: RouteContext<"/api/embed/[slug]">) {
  const { slug } = await params;
  const business = SLUG_PATTERN.test(slug) ? await getPublicBusinessBySlug(slug) : null;
  const embed = business ? await getEmbedSettings({ businessId: business.id }) : null;
  if (!business || !embed) {
    return Response.json({ error: "not_found" }, { status: 404, headers: headers() });
  }
  if (!originAllowed(embed.embed.allowedOrigins, request.headers.get("origin"))) {
    return Response.json(
      { error: "not_allowed" },
      { status: 403, headers: headers({ "Cache-Control": "no-store" }) },
    );
  }
  const theme = brandTheme(embed.brandColor);
  const config: EmbedConfig = {
    name: business.name,
    buttonText: embed.embed.buttonText,
    position: embed.embed.position,
    chat: embed.embed.showChat && business.aiEnabled,
    open: embed.embed.open === "chat" && business.aiEnabled ? "chat" : "booking",
    colors: theme
      ? {
          background: theme.light.primary,
          foreground: theme.light.primaryForeground,
          hover: theme.light.primaryHover,
        }
      : SLOTWREN_TEAL,
  };
  // The same answer for every site: a shared cache may keep it. With an
  // allowed list the answer depends on the Origin, so only the browser does
  // (a CDN that ignored Vary could hand one site's answer to another).
  const cache = embed.embed.allowedOrigins.length
    ? "private, max-age=60"
    : "public, max-age=60, s-maxage=60";
  return Response.json(config, { headers: headers({ "Cache-Control": cache }) });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: headers({
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    }),
  });
}
