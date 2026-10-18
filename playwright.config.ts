import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// E2E always runs against the project's local, account-free Convex backend
// (set up once with `pnpm e2e:setup`), never a cloud deployment.
//
// Ports (see docs/testing.md): E2E_PORT for Next.js (default 3000) and
// E2E_CONVEX_PORT for the local backend (default 3212; its site proxy uses
// the next port). Runs refuse to start when a port is taken unless
// E2E_REUSE_SERVERS=1.
const E2E_ENV_FILE = ".env.e2e.local";

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a TCP port number; got "${raw}".`);
  }
  return port;
}

const PORT = portFromEnv("E2E_PORT", 3000);
const CONVEX_PORT = portFromEnv("E2E_CONVEX_PORT", 3212);
const reuseServers = process.env.E2E_REUSE_SERVERS === "1";

// Only the main runner process checks the ports; test workers load this file
// too, after the servers are up.
if (!reuseServers && process.env.TEST_WORKER_INDEX === undefined) {
  try {
    execFileSync(process.execPath, ["scripts/e2e-ports.mjs", "check", "next", "convex", "convexSite"], {
      stdio: ["ignore", "inherit", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    throw new Error(stderr?.trim() || String(error));
  }
}

const e2eEnv = readEnvFile(E2E_ENV_FILE);
const convexUrl = `http://127.0.0.1:${CONVEX_PORT}`;
process.env.E2E_CONVEX_URL = convexUrl;
process.env.E2E_AUTH_SECRET = e2eEnv.E2E_AUTH_SECRET ?? "";

const baseURL = `http://localhost:${PORT}`;
// The e2e build (with the test sign-in form) never replaces the normal .next
// output, and each port has its own directory so parallel runs don't collide.
const distDir = PORT === 3000 ? ".next-e2e" : `.next-e2e-${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Visual comparison shots (tests/e2e/visual/*, tagged @visual) run only with E2E_VISUAL=1.
  grepInvert: process.env.E2E_VISUAL === "1" ? undefined : /@visual/,
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
      env: { E2E_CONVEX_PORT: String(CONVEX_PORT) },
      url: `${convexUrl}/version`,
      reuseExistingServer: reuseServers,
      timeout: 120_000,
    },
    {
      command: "node scripts/e2e-next.mjs",
      env: {
        E2E_PORT: String(PORT),
        NEXT_DIST_DIR: distDir,
        NEXT_PUBLIC_E2E_AUTH: "true",
        NEXT_PUBLIC_CONVEX_URL: convexUrl,
      },
      url: baseURL,
      reuseExistingServer: reuseServers,
      timeout: 240_000,
    },
  ],
});
