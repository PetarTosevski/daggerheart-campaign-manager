import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e build uses its own output directory (see playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    root: __dirname,
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
