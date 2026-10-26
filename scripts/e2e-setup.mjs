// One-time setup of the local Convex backend used by the e2e tests.
// Idempotent: re-running keeps the existing keys and secret.
//
//   pnpm e2e:setup
//
// The e2e backend is the project's local, account-free Convex deployment
// (CONVEX_AGENT_MODE=anonymous). It never touches a cloud deployment.
// Respects E2E_PORT / E2E_CONVEX_PORT (see docs/testing.md).
//
// The Lorekeeper (D13 L9): turns on its fake model (LOREKEEPER_FAKE_MODEL, which
// convex/lib/claude.ts honours only on this local e2e deployment, so no test
// ever calls the real API) and ingests the invented mini-book
// (tests/fixtures/lorekeeper/mini-book.txt, no rulebook text) as the core book.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { e2ePorts } from "./e2e-ports.mjs";

const ENV_FILE = ".env.e2e.local";
const E2E_GM_EMAIL = "e2e-gm@example.test";
// One email per sign-in method: an email first used by the test sign-in cannot
// sign up with a password (docs/testing.md). Sign-up is open, so accounts need
// no listing; this documents who uses which method. Test sign-in: the GM
// (e2e-gm@) and two players (e2e-player@, and e2e-player2@, the second player /
// outsider). Email + password only: one account per spec that signs up
// (e2e-password-only@ in tests/e2e/players.spec.ts, e2e-session-ended@ in
// tests/e2e/auth-session-ended.spec.ts), so neither depends on the other's password.

function readEnvFile() {
  if (!existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(ENV_FILE, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

// Runs through scripts/convex-e2e.mjs, which targets the e2e backend and
// protects .env.local.
function convex(args, positional = []) {
  const argv = ["scripts/convex-e2e.mjs", ...args];
  if (positional.length > 0) argv.push("--", ...positional);
  return execFileSync("node", argv, { encoding: "utf8" });
}

const file = readEnvFile();
const secret = file.E2E_AUTH_SECRET || randomBytes(16).toString("hex");
writeFileSync(
  ENV_FILE,
  [
    "# Local e2e Convex backend (written by scripts/e2e-setup.mjs; git-ignored).",
    "CONVEX_DEPLOYMENT=anonymous:anonymous-agent",
    `E2E_AUTH_SECRET=${secret}`,
    "",
  ].join("\n"),
);

// Push functions once so the deployment exists and the URL is known.
convex(["dev", "--once", "--typecheck=disable", "--tail-logs", "disable"]);

const existing = convex(["env", "list"]);
const vars = {
  // Only OAuth redirects use it; the e2e tests sign in with the test form.
  SITE_URL: `http://localhost:${e2ePorts().next}`,
  E2E_AUTH_ENABLED: "true",
  E2E_AUTH_SECRET: secret,
  // Canned answers instead of the Messages API (honoured only on this deployment).
  LOREKEEPER_FAKE_MODEL: "true",
  // The test accounts ask far more than 40 questions a day across repeated runs;
  // the cap itself is tested with a lowered campaign budget (lorekeeper-flow).
  LOREKEEPER_DAILY_QUESTIONS: "1000",
};
if (!/^JWT_PRIVATE_KEY=/m.test(existing) || !/^JWKS=/m.test(existing)) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vars.JWT_PRIVATE_KEY = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .trimEnd()
    .replace(/\n/g, " ");
  vars.JWKS = JSON.stringify({
    keys: [{ use: "sig", alg: "RS256", ...publicKey.export({ format: "jwk" }) }],
  });
}
for (const [name, value] of Object.entries(vars)) {
  convex(["env", "set"], [name, value]);
}
// The mini-book as the core book (re-running replaces its chunks).
execFileSync(
  process.execPath,
  ["scripts/lorekeeper-ingest.mjs", "core", "tests/fixtures/lorekeeper/mini-book.txt", "--e2e"],
  { stdio: "inherit" },
);
console.log(`e2e backend ready; test GM is ${E2E_GM_EMAIL}; Lorekeeper fake model on, mini-book ingested`);
