import fs from "node:fs";
import path from "node:path";

import { getFunctionName } from "convex/server";

import { convexDir } from "./gm-functions";

/**
 * A public Convex export: `export const name = <wrapper>(` where the wrapper is a
 * query, mutation or action builder (`userQuery`, `gmMutation`, `keyedCampaignMutation`, ...).
 * `internal*` builders, `httpAction` and the `custom*` builders that define the
 * wrappers in `convex/lib/functions.ts` are not client-callable.
 */
const PUBLIC_EXPORT = /^export const (\w+) = (\w+)\(/;
const BUILDER = /(Query|Mutation|Action)$|^(query|mutation|action)$/;
/** `convex/auth.ts`: `export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth(`. */
const AUTH_EXPORTS = /^export const \{([^}]+)\} = convexAuth\(/;
const NOT_PUBLIC = /^(internal|custom|http)/;

function listSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_generated" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSources(full));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

/** Every public query, mutation and action under `root`, as `module:export` (`trackers/horizon:get`). Sorted. */
export function scanPublicFunctions(root: string = convexDir()): string[] {
  const names: string[] = [];
  for (const file of listSources(root)) {
    const moduleName = path.relative(root, file).replace(/\.ts$/, "").split(path.sep).join("/");
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const auth = AUTH_EXPORTS.exec(line)?.[1];
      if (auth !== undefined) {
        for (const exportName of auth.split(",")) names.push(`${moduleName}:${exportName.trim()}`);
        continue;
      }
      const match = PUBLIC_EXPORT.exec(line);
      const exportName = match?.[1];
      const builder = match?.[2];
      if (exportName === undefined || builder === undefined) continue;
      if (!BUILDER.test(builder) || NOT_PUBLIC.test(builder)) continue;
      names.push(`${moduleName}:${exportName}`);
    }
  }
  names.sort();
  return names;
}

let publicNames: ReadonlySet<string> | null = null;

/** The scanned public functions, cached for the test file. */
export function publicFunctionNames(): ReadonlySet<string> {
  publicNames ??= new Set(scanPublicFunctions());
  return publicNames;
}

/**
 * Throw unless `name` is a public Convex function on this checkout. The generated
 * `api` is an untyped proxy at runtime, so `api.moved.away` still yields a name;
 * this is what makes a renamed or moved function fail a phone test.
 */
export function assertKnownFunction(name: string, context: string): void {
  if (publicFunctionNames().has(name)) return;
  throw new Error(
    `Unknown Convex function ${name} (${context}). It is not a public export under convex/: renamed, moved or internal?`,
  );
}

/** A generated api reference (`api.campaigns.fear`). */
export type FunctionRef = Parameters<typeof getFunctionName>[0];

/**
 * The mock key for a generated api reference: `{ [fn(api.campaigns.fear)]: 4 }`.
 * Fails at once when the reference names no public function.
 */
export function fn(ref: FunctionRef): string {
  const name = getFunctionName(ref);
  assertKnownFunction(name, "mock key");
  return name;
}
