// Builds and serves the e2e Next.js app on E2E_PORT (started by Playwright).
//
// Each port gets its own output directory (NEXT_DIST_DIR) so parallel runs
// never overwrite each other's build. `next build` adds the output directory's
// type globs to tsconfig.json; for a non-default directory that addition is
// undone after the build so the working tree stays clean.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { e2ePorts } from "./e2e-ports.mjs";

const TSCONFIG = "tsconfig.json";
const { next: port } = e2ePorts();
const distDir = process.env.NEXT_DIST_DIR;
if (!distDir) throw new Error("NEXT_DIST_DIR must be set (see playwright.config.ts).");

const before = readFileSync(TSCONFIG, "utf8");
const build = spawnSync("pnpm", ["build"], { stdio: "inherit" });

const after = readFileSync(TSCONFIG, "utf8");
if (after !== before) {
  const config = JSON.parse(after);
  config.include = (config.include ?? []).filter((entry) => !entry.startsWith(`${distDir}/`));
  if (isDeepStrictEqual(config, JSON.parse(before))) {
    writeFileSync(TSCONFIG, before);
  } else {
    console.warn(`${TSCONFIG} changed during the e2e build; left as is.`);
  }
}
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn("pnpm", ["start", "--port", String(port)], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
