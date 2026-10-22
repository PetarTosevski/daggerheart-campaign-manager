import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { DOMAIN_CARDS } from "../../../src/lib/srd/domain-cards";
import { openSheet, openTab, visual } from "./helpers";

const codex2 = DOMAIN_CARDS.find((c) => c.domain === "codex" && c.level === 2 && c.source === "core")!;

// SC1: the felt table with 'More' and the buttons under the text on every card, and the large card dialog, at 1440 and
// 390. Board counterpart: node scripts/board-shots.mjs loadout (the board has no large card; its faces are the look).

test("SC1 sheet cards and the card dialog at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, characterId, sheet } = await openSheet(page);
  const { shoot } = visual(page, "SC1");
  await client.mutation(api.levelUp.correctLevel, { characterId, level: 2, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.takeCard, { characterId, cardId: codex2.id });
  await client.mutation(api.characters.moveCard, { characterId, cardId: "deft-deceiver", to: "vault" });
  await openTab(page, "Domains");
  const felt = sheet.getByRole("region", { name: "Loadout and vault" });
  await expect(felt.getByRole("list", { name: "Vault cards" }).getByRole("article", { name: "Deft Deceiver" })).toBeVisible();
  await shoot(felt, "felt");

  await felt.getByRole("button", { name: "More about Book of Ava" }).click();
  await shoot(page.getByRole("dialog", { name: "Book of Ava" }), "dialog-book-of-ava");
  await page.keyboard.press("Escape");

  await felt.getByRole("button", { name: "More about Deft Deceiver" }).click();
  await shoot(page.getByRole("dialog", { name: "Deft Deceiver" }), "dialog-deft-deceiver");
});
