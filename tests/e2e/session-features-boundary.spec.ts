import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { bardDraft, openSessions } from "./visual/helpers";

// Session features at the session boundaries (plan session-features F1). A party of two Halflings (Pip, Rosa), a Call
// of the Slayer Warrior holding 2 Slayer Dice (Bryn) and a Seaborne PC holding 2 Tide tokens (Kai): Start gives every
// active PC 2 Hope, capped at 6 (U1, K6), and the live card's report says so; End clears the Slayer Dice for +2 Hope
// and the Tide tokens (U8) and reports both. Pip is created through the API; the others are appended to the
// `characters` table of the local e2e backend (no public mutation sets held Slayer Dice or Tide tokens before F2).

/** Appends character rows to the local e2e backend (`convex import --append`, admin rights of the CLI). */
function appendCharacters(rows: object[]) {
  const dir = join("test-results", "sf-f1");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `characters-${crypto.randomUUID()}.jsonl`);
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "import", "--table", "characters", "--append", "-y", file], { stdio: "pipe" });
}

/** A level-1 Halfling Warrior (Call of the Brave): no session-start dice of its own, so the reports show only the features. */
function warriorDraft(name: string) {
  const warrior = getClass("warrior")!;
  return {
    ...bardDraft(name),
    classId: "warrior",
    subclassId: "call-of-the-brave",
    ancestry: { kind: "single" as const, id: "halfling" },
    domainCards: cardsForDomains(warrior.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
  };
}

/** Seeds the party in a fresh Witherwild campaign; returns the ids by name. */
async function seedParty(client: ConvexHttpClient, campaignId: Id<"campaigns">) {
  const { characterId: pip } = await client.mutation(api.characters.create, { campaignId, draft: warriorDraft("Pip"), idempotencyKey: crypto.randomUUID() });
  const view = (await client.query(api.characters.get, { characterId: pip }))!;
  const base = view.sheet as CharacterSheet;
  const row = (sheet: CharacterSheet) => ({ campaignId, ownerId: view.ownerId, createdBy: view.ownerId, status: "active", sheet: { schemaVersion: 2, ...sheet }, createdAt: 1, updatedAt: 1 });
  appendCharacters([
    row({ ...base, name: "Rosa", hope: 2 }),
    row({ ...base, name: "Bryn", ancestry: { kind: "single", id: "human" }, subclassId: "call-of-the-slayer", hope: 2, sessionFeatures: { slayerDice: 2 } }),
    row({ ...base, name: "Kai", ancestry: { kind: "single", id: "human" }, communityId: "seaborne", hope: 0, sessionFeatures: { tideTokens: 2 } }),
  ]);
  // Pip starts at Hope 5: Luckbringer's +2 stops at the maximum of 6 (K6).
  await client.mutation(api.characters.adjustResource, { characterId: pip, resource: "hope", delta: 5 - base.hope });
  const party = await client.query(api.characters.listByCampaign, { campaignId });
  const idOf = (name: string) => party.find((c) => c.sheet.name === name)!._id;
  return { pip, rosa: idOf("Rosa"), bryn: idOf("Bryn"), kai: idOf("Kai") };
}

const liveCard = (page: Page) => page.getByRole("region", { name: "Live session" });

test("Start gives the stacked Luckbringer Hope (capped); End clears Slayer Dice for Hope and Tide tokens; both reports list it", async ({ page }) => {
  const { client, campaignId } = await openSessions(page);
  const ids = await seedParty(client, campaignId);
  const sheet = async (id: Id<"characters">) => (await client.query(api.characters.get, { characterId: id }))!.sheet as CharacterSheet;

  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/stage=prep$/);
  await liveCard(page).getByRole("button", { name: "Start session" }).click();
  await page.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session" }).click();
  const report = liveCard(page).getByRole("status").locator("p");
  await expect(report.nth(0)).toHaveText("Session started.");
  await expect(report.nth(1)).toHaveText("Luckbringer (Pip, Rosa): everyone gains 2 Hope.");
  expect(await Promise.all([ids.pip, ids.rosa, ids.bryn, ids.kai].map(async (id) => (await sheet(id)).hope))).toEqual([6, 4, 4, 2]);

  await liveCard(page).getByRole("button", { name: "End session" }).click();
  await page.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
  await expect(report.nth(0)).toHaveText("Session ended.");
  await expect(report.nth(1)).toHaveText("Bryn cleared 2 Slayer Dice: +2 Hope.");
  await expect(report.nth(2)).toHaveText("Kai cleared 2 Tide tokens.");
  const bryn = await sheet(ids.bryn);
  expect(bryn.hope).toBe(6);
  expect(bryn.sessionFeatures).toBeUndefined();
  expect((await sheet(ids.kai)).sessionFeatures).toBeUndefined();
});
