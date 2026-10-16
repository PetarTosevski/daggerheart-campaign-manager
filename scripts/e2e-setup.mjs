// One-time setup of the local Convex backend used by the e2e tests.
// Idempotent: re-running keeps the existing keys and secret.
//
//   pnpm e2e:setup
//
// The e2e backend is the project's local, account-free Convex deployment
// (CONVEX_AGENT_MODE=anonymous). It never touches a cloud deployment.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_FILE = ".env.e2e.local";
const E2E_GM_EMAIL = "e2e-gm@example.test";

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
  SITE_URL: "http://localhost:3000",
  GM_EMAILS: E2E_GM_EMAIL,
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
