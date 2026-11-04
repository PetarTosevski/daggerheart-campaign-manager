import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// One limit for every test, and no per-test overrides (dcm-t30). The full run starts a worker per core for both
// projects; on a loaded machine a jsdom render with its queries, or a convex-test case with many calls, can pass
// vitest's 5 s default although it needs a fraction of that alone. Make a slow test cheaper first (narrower queries,
// render only what is tested; docs/tasks/TASK-D12-H3.md); this limit is the headroom, not the fix.
// Coverage instrumentation slows the CPU-heavy cases (password hashing in auth-signup) about 3x; `test:coverage` sets
// VITEST_COVERAGE=1 for that headroom only.
const testTimeout = process.env.VITEST_COVERAGE === "1" ? 60_000 : 15_000;

export default defineConfig({
  test: {
    // `pnpm test:coverage`: line / branch coverage of the app code over both projects (unit + convex). The HTML report
    // lands in coverage/ (git-ignored); coverage/coverage-summary.json has the totals per file.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "convex/**/*.ts"],
      exclude: ["convex/_generated/**", "**/*.d.ts", "src/**/*.css"],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
    },
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          testTimeout,
          include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "convex",
          environment: "edge-runtime",
          testTimeout,
          include: ["tests/convex/**/*.{test,spec}.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
