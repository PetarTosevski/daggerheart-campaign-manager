import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { cardsForDomains, getClass } from "../../../src/lib/srd/index";
import type { CharacterSheet } from "../../../src/lib/validation/characters";
import { bardDraft, D10_VIEWPORTS, openSessions, visual } from "./helpers";

// Session features F1 visual spec (E2E_VISUAL=1): the live card's Start report (Luckbringer, a Moon Witch's moon die)
// and End report (Slayer Dice cleared for Hope, Tide tokens cleared, the moon die ends) at 1440, 1024 and 390, in a
// Hope & Fear campaign. The party beyond the first PC is appended to the local e2e backend, as in
// tests/e2e/session-features-boundary.spec.ts. Shots: test-results/visual/SF-F1/{start,end}-<width>.png.

function appendCharacters(rows: object[]) {
  const dir = join("test-results", "sf-f1");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `characters-${crypto.randomUUID()}.jsonl`);
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "import", "--table", "characters", "--append", "-y", file], { stdio: "pipe" });
}

test("SF-F1 Start and End reports at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openSessions(page);
  await client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const warrior = getClass("warrior")!;
  const draft = {
    ...bardDraft("Pip"),
    classId: "warrior",
    subclassId: "call-of-the-brave",
    ancestry: { kind: "single" as const, id: "halfling" },
    domainCards: cardsForDomains(warrior.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
  };
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft, idempotencyKey: crypto.randomUUID() });
  const view = (await client.query(api.characters.get, { characterId }))!;
  const base = view.sheet as CharacterSheet;
  const row = (sheet: CharacterSheet) => ({ campaignId, ownerId: view.ownerId, createdBy: view.ownerId, status: "active", sheet: { schemaVersion: 2, ...sheet }, createdAt: 1, updatedAt: 1 });
  const human = { kind: "single" as const, id: "human" };
  appendCharacters([
    row({ ...base, name: "Rosa" }),
    row({ ...base, name: "Bryn", ancestry: human, subclassId: "call-of-the-slayer", sessionFeatures: { slayerDice: 2 } }),
    row({ ...base, name: "Kai", ancestry: human, communityId: "seaborne", sessionFeatures: { tideTokens: 2 } }),
    row({ ...base, name: "Mira", ancestry: human, classId: "witch", subclassId: "moon", subclassRank: "mastery" }),
  ]);

  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/stage=prep$/);
  const card = page.getByRole("region", { name: "Live session" });
  const report = card.getByRole("status").locator("p");
  const { shoot } = visual(page, "SF-F1", D10_VIEWPORTS);

  await card.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session" }).click();
  await expect(report.nth(1)).toHaveText("Luckbringer (Pip, Rosa): everyone gains 2 Hope.");
  await expect(report.nth(2)).toHaveText(/^Mira's moon die: [1-6] \((New|Waxing|Full|Waning): .+\)\.$/);
  await shoot(card, "start");

  await card.getByRole("button", { name: "End session" }).click();
  await page.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
  await expect(report.nth(0)).toHaveText("Session ended.");
  await expect(report.nth(1)).toHaveText("Bryn cleared 2 Slayer Dice: +2 Hope.");
  await expect(report.nth(2)).toHaveText("Kai cleared 2 Tide tokens.");
  await expect(report.nth(3)).toHaveText("Mira's moon die ends.");
  await shoot(card, "end");
});
