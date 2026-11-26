import type { NextConfig } from "next";

// Validate env at build and dev start so a bad config fails fast.
import "./src/env";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  typedRoutes: true,
  async headers() {
    const refuseFraming = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      // Nothing may be framed except the embedded booking page (/b/<slug>?embed=1),
      // whose header the proxy sets per business (src/proxy.ts).
      { source: "/((?!b/|embed\.js|embed/v/).*)", headers: refuseFraming },
      // The widget: a small loader sites always re-fetch within minutes, and
      // versioned bundles that never change.
      {
        source: "/embed.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=60" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        source: "/embed/v/:file",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
