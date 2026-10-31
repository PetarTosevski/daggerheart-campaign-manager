import { execFileSync } from "node:child_process";
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

/** `rg --count-matches` totals. Exit 1 means zero matches. */
function rgExportCount(root: string): number {
  try {
    const output = execFileSync(
      "rg",
      [
        "--count-matches",
        GM_EXPORT_PATTERN,
        "--glob",
        "*.ts",
        "--glob",
        "!**/*.d.ts",
        "--glob",
        "!**/_generated/**",
        root,
      ],
      { encoding: "utf8" },
    );
    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(":") + 1)), 0);
  } catch (error) {
    const failed = error as { status?: number };
    if (failed.status === 1) return 0;
    throw error;
  }
}

test("the source scan lists the GM exports and matches the rg count", () => {
  const names = scanGmFunctions();
  for (const name of REQUIRED) {
    expect(names).toContain(name);
  }
  expect(names).toHaveLength(rgExportCount(convexDir()));
});
