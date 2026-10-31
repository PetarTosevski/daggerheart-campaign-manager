import fs from "node:fs";
import path from "node:path";

/**
 * Same pattern the scan test counts with `rg`. Anchored to the start of the
 * line so a sample inside a comment (convex/lib/functions.ts) is not an export.
 */
export const GM_EXPORT_PATTERN = String.raw`^export const (\w+) = (gmQuery|gmMutation|keyedGmMutation)\(`;

const GM_EXPORT = new RegExp(GM_EXPORT_PATTERN);

/** `convex/` at the repo root, from `apps/mobile/test/harness`. */
export function convexDir(): string {
  return path.resolve(__dirname, "../../../../convex");
}

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

/**
 * Every `gmQuery`, `gmMutation`, and `keyedGmMutation` export under `convexDir`,
 * as `module:export` (`trackers/horizon:get`). Sorted. One entry per export.
 */
export function scanGmFunctions(root: string = convexDir()): string[] {
  const names: string[] = [];
  for (const file of listSources(root)) {
    const moduleName = path.relative(root, file).replace(/\.ts$/, "").split(path.sep).join("/");
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = GM_EXPORT.exec(line);
      const exportName = match?.[1];
      if (exportName === undefined) continue;
      names.push(`${moduleName}:${exportName}`);
    }
  }
  names.sort();
  return names;
}
