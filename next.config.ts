import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e build uses its own output directory (see playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
