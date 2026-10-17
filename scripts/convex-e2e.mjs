// Runs the Convex CLI against the local e2e backend (.env.e2e.local) while
// protecting .env.local, which points at the developer's cloud deployment.
// The CLI can rewrite .env.local when it selects a deployment; this wrapper
// restores the original contents whenever they change and on exit.
//
//   node scripts/convex-e2e.mjs dev --once
//   node scripts/convex-e2e.mjs env set -- NAME value
//
// `dev` runs the backend on E2E_CONVEX_PORT (default 3212) and its site proxy
// on the next port, and refuses to start when either port is taken.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, watchFile, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describeBusyPorts, e2ePorts } from "./e2e-ports.mjs";

const PROTECTED = ".env.local";
const E2E_ENV_FILE = ".env.e2e.local";

const original = existsSync(PROTECTED) ? readFileSync(PROTECTED, "utf8") : null;

function restore() {
  if (original === null) return;
  const current = existsSync(PROTECTED) ? readFileSync(PROTECTED, "utf8") : null;
  if (current !== original) writeFileSync(PROTECTED, original);
}

// Insert options before any `--` so positional values stay positional.
const args = process.argv.slice(2);
const options = ["--env-file", E2E_ENV_FILE];
if (args[0] === "dev") {
  const ports = e2ePorts();
  const busy = await describeBusyPorts(["convex", "convexSite"]);
  if (busy) {
    console.error(busy);
    process.exit(1);
  }
  options.push("--local-cloud-port", String(ports.convex), "--local-site-port", String(ports.convexSite));
}
const split = args.indexOf("--");
const argv =
  split === -1
    ? [...args, ...options]
    : [...args.slice(0, split), ...options, ...args.slice(split)];

watchFile(PROTECTED, { interval: 200 }, restore);

// Run the CLI directly (not through npx) so signals reach it and it stops the
// local backend it started instead of leaving it running.
const require = createRequire(import.meta.url);
const convexBin = join(dirname(require.resolve("convex/package.json")), "bin", "main.js");
const child = spawn(process.execPath, [convexBin, ...argv], {
  stdio: "inherit",
  env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
});
// The CLI only cleans up (stops the backend) on SIGINT, so forward that.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill("SIGINT");
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  });
}
child.on("exit", (code, signal) => {
  restore();
  process.exit(code ?? (signal ? 1 : 0));
});
