import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      // Character-sheet template PDFs may be up to 25 MB (Task 011A). The default
      // Server Action body limit is 1 MB, which would reject real uploads; raise
      // it just above the enforced PDF size limit.
      bodySizeLimit: "26mb",
    },
  },
};

export default nextConfig;
