// Runs the Convex CLI against the local e2e backend (.env.e2e.local) while
// protecting .env.local, which points at the developer's cloud deployment.
// The CLI can rewrite .env.local when it selects a deployment; this wrapper
// restores the original contents whenever they change and on exit.
//
//   node scripts/convex-e2e.mjs dev --once
//   node scripts/convex-e2e.mjs env set -- NAME value
import { spawn } from "node:child_process";
import { existsSync, readFileSync, watchFile, writeFileSync } from "node:fs";

const PROTECTED = ".env.local";
const E2E_ENV_FILE = ".env.e2e.local";

const original = existsSync(PROTECTED) ? readFileSync(PROTECTED, "utf8") : null;

function restore() {
  if (original === null) return;
  const current = existsSync(PROTECTED) ? readFileSync(PROTECTED, "utf8") : null;
  if (current !== original) writeFileSync(PROTECTED, original);
}

// Insert --env-file before any `--` so positional values stay positional.
const args = process.argv.slice(2);
const split = args.indexOf("--");
const argv =
  split === -1
    ? [...args, "--env-file", E2E_ENV_FILE]
    : [...args.slice(0, split), "--env-file", E2E_ENV_FILE, ...args.slice(split)];

watchFile(PROTECTED, { interval: 200 }, restore);

const child = spawn("npx", ["convex", ...argv], {
  stdio: "inherit",
  env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  restore();
  process.exit(code ?? (signal ? 1 : 0));
});
