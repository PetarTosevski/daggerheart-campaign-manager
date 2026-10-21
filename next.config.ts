import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e build uses its own output directory (see playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Router cache (PF1): a page segment fetched on navigation is reused for 30 s, so going back to a tab does not wait
    // on the server again. Data stays live: every page reads it from Convex subscriptions, not from the RSC payload.
    // Fully prefetched links (the campaign nav, prefetch={true}) use the `static` time, 5 minutes by default.
    staleTimes: { dynamic: 30 },
  },
  async headers() {
    return [
      {
        // Built-in sprite packs (sprite packs D8): every file name carries a content hash, so it never changes.
        source: "/sprite-packs/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
