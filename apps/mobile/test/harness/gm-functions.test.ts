import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

import { convexDir, GM_EXPORT_PATTERN, scanGmFunctions } from "./gm-functions";

const REQUIRED = [
  "encounters:list",
  "spritePacks:packs",
  "combatMaps:list",
  "customAdversaries:list",
  "sessionPrep:get",
  "combatVision:previewAs",
  "members:access",
];

/** Line count of the same export pattern, without the `rg` binary (GitHub runners do not have it). */
function exportCount(root: string): number {
  const pattern = new RegExp(GM_EXPORT_PATTERN);
  let count = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "_generated" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      for (const line of fs.readFileSync(full, "utf8").split("\n")) {
        if (pattern.test(line)) count += 1;
      }
    }
  };
  walk(root);
  return count;
}

test("the source scan lists the GM exports and matches the rg count", () => {
  const names = scanGmFunctions();
  for (const name of REQUIRED) {
    expect(names).toContain(name);
  }
  expect(names).toHaveLength(exportCount(convexDir()));
});
