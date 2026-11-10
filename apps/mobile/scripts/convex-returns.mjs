// Prints, as JSON, the `returns` validator of every public Convex function on
// this checkout: `{ "campaigns:fear": {"type":"union",...}, "campaigns:create": null }`
// (null: the function declares no `returns`). The phone's jest harness runs it
// once per convex/ change and checks every query fixture against it, so a
// fixture that drifts from the server's shape fails the test that uses it.
//
//   node --experimental-transform-types --no-warnings \
//     --import ./apps/mobile/scripts/convex-hooks.mjs apps/mobile/scripts/convex-returns.mjs
//
// It loads the real modules (the same validators Convex deploys), so there is
// no second schema to keep in step.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const convexDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../convex");

function listSources(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_generated" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSources(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

const returns = {};
const failures = [];
for (const file of listSources(convexDir).sort()) {
  const source = fs.readFileSync(file, "utf8");
  // Only modules that export a function; skips schema, config and helpers that never register one.
  if (!/^export const /m.test(source)) continue;
  const moduleName = path.relative(convexDir, file).replace(/\.ts$/, "").split(path.sep).join("/");
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (error) {
    failures.push(`${moduleName}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  for (const [exportName, value] of Object.entries(mod)) {
    if (typeof value !== "function" && (typeof value !== "object" || value === null)) continue;
    if (value.isPublic !== true || typeof value.exportReturns !== "function") continue;
    const json = value.exportReturns();
    returns[`${moduleName}:${exportName}`] = json === null || json === undefined ? null : JSON.parse(json);
  }
}

process.stdout.write(JSON.stringify({ returns, failures }));
