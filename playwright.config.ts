import { existsSync, readFileSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// E2E always runs against the project's local, account-free Convex backend
// (set up once with `pnpm e2e:setup`), never a cloud deployment.
const E2E_ENV_FILE = ".env.e2e.local";
const LOCAL_BACKEND_CONFIG = ".convex/local/default/config.json";

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

function localBackendPort(): number | null {
  if (!existsSync(LOCAL_BACKEND_CONFIG)) return null;
  const config = JSON.parse(readFileSync(LOCAL_BACKEND_CONFIG, "utf8"));
  return typeof config?.ports?.cloud === "number" ? config.ports.cloud : null;
}

const e2eEnv = readEnvFile(E2E_ENV_FILE);
const backendPort = localBackendPort();
const convexUrl = backendPort ? `http://127.0.0.1:${backendPort}` : "";
process.env.E2E_CONVEX_URL = convexUrl;
process.env.E2E_AUTH_SECRET = e2eEnv.E2E_AUTH_SECRET ?? "";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node scripts/convex-e2e.mjs dev --typecheck=disable --tail-logs disable",
      url: `${convexUrl}/version`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Built into .next-e2e so the e2e build (with the test sign-in form)
      // never replaces the normal .next output.
      command: `pnpm build && pnpm start --port ${PORT}`,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        NEXT_PUBLIC_E2E_AUTH: "true",
        NEXT_PUBLIC_CONVEX_URL: convexUrl,
      },
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
