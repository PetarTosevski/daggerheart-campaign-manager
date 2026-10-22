// One-time setup of the local Convex backend used by the e2e tests.
// Idempotent: re-running keeps the existing keys and secret.
//
//   pnpm e2e:setup
//
// The e2e backend is the project's local, account-free Convex deployment
// (CONVEX_AGENT_MODE=anonymous). It never touches a cloud deployment.
// Respects E2E_PORT / E2E_CONVEX_PORT (see docs/testing.md).
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { e2ePorts } from "./e2e-ports.mjs";

const ENV_FILE = ".env.e2e.local";
const E2E_GM_EMAIL = "e2e-gm@example.test";
// Extra allowlisted accounts: two players that sign in through the test form
// (e2e-password@ is the second player / outsider despite its name), and a
// password-only account that only players.spec uses. One email per sign-in
// method: an email first used by the test sign-in cannot sign up with a password.
const E2E_PASSWORD_ONLY_EMAIL = "e2e-password-only@example.test";
const E2E_ALLOWED = [
  E2E_GM_EMAIL,
  "e2e-player@example.test",
  "e2e-password@example.test",
  E2E_PASSWORD_ONLY_EMAIL,
];

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
  ALLOWED_EMAILS: E2E_ALLOWED.join(","),
  E2E_AUTH_ENABLED: "true",
  E2E_AUTH_SECRET: secret,
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
console.log(`e2e backend ready; test GM is ${E2E_GM_EMAIL}`);
