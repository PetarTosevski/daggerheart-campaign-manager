import fs from "node:fs";
import path from "node:path";

/**
 * Same pattern the scan test counts with `rg`. Anchored to the start of the
 * line so a sample inside a comment (convex/lib/functions.ts) is not an export.
 */
export const GM_EXPORT_PATTERN = String.raw`^export const (\w+) = (gmQuery|gmMutation|keyedGmMutation|creatorQuery|creatorMutation|keyedCreatorMutation)\(`;

const GM_EXPORT = new RegExp(GM_EXPORT_PATTERN);

/** A campaign wrapper that can still demand GM access through its options: `campaignQuery({ need: "owner", ...`. */
const CAMPAIGN_EXPORT = /^export const (\w+) = (campaignQuery|campaignMutation|keyedCampaignMutation)\(/;
const NEEDS_GM = /\bneed:\s*"(owner|creator)"/;
/** How far into the options object to look for `need` (it comes first by convention, before `args`). */
const OPTION_LINES = 8;

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
 * Every export under `convexDir` only a GM may touch, as `module:export` (`trackers/horizon:get`):
 * the `gm*` and `creator*` builders, and a campaign wrapper whose options say `need: "owner"` or
 * `need: "creator"`. Sorted. One entry per export.
 */
export function scanGmFunctions(root: string = convexDir()): string[] {
  const names: string[] = [];
  for (const file of listSources(root)) {
    const moduleName = path.relative(root, file).replace(/\.ts$/, "").split(path.sep).join("/");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const gm = GM_EXPORT.exec(line)?.[1];
      if (gm !== undefined) {
        names.push(`${moduleName}:${gm}`);
        return;
      }
      const campaign = CAMPAIGN_EXPORT.exec(line)?.[1];
      if (campaign === undefined) return;
      const options = [line];
      for (const next of lines.slice(index + 1, index + 1 + OPTION_LINES)) {
        if (/^\s*(args|handler|returns)\b/.test(next) || next.startsWith("export ")) break;
        options.push(next);
      }
      if (NEEDS_GM.test(options.join("\n"))) names.push(`${moduleName}:${campaign}`);
    });
  }
  names.sort();
  return names;
}
