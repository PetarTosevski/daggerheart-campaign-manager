import fs from "node:fs";
import os from "node:os";
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
  // creatorMutation: only the campaign's creator (dcm-gdzi.39).
  "campaigns:remove",
  "members:setCoGm",
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
  // Every pattern line, plus any campaign wrapper that asks for need: "owner" / "creator".
  expect(names.length).toBeGreaterThanOrEqual(exportCount(convexDir()));
});

test("a campaign wrapper that needs owner or creator counts as GM-only; view and edit do not", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gm-scan-"));
  fs.writeFileSync(
    path.join(root, "sample.ts"),
    [
      "export const ownerOnly = campaignQuery({",
      '  need: "owner",',
      "  args: {},",
      "  handler: async () => null,",
      "});",
      "export const creatorOnly = keyedCampaignMutation({",
      '  rateLimit: "write",',
      '  need: "creator",',
      "  handler: async () => null,",
      "});",
      "export const anyone = campaignQuery({",
      '  need: "view",',
      "  handler: async () => null,",
      "});",
      "export const late = campaignMutation({",
      '  need: "edit",',
      "  args: {},",
      '  handler: async () => ({ need: "owner" }),',
      "});",
      "export const remove = creatorMutation({",
      "  handler: async () => null,",
      "});",
    ].join("\n"),
  );
  try {
    expect(scanGmFunctions(root)).toEqual(["sample:creatorOnly", "sample:ownerOnly", "sample:remove"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
