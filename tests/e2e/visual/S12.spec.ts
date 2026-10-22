import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openSheet, openTab, visual } from "./helpers";

// S12: Domains > Domain Cards (domains box, loadout felt with the fanned hand, vault deck and spread) and
// Heritage & Subclass (hero cards with rank locks), at 1440 and 390.
// Board counterparts: node scripts/board-shots.mjs domains loadout hero-cards

test("S12 domain cards and hero cards at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, characterId, sheet } = await openSheet(page);
  const { shoot } = visual(page, "S12");
  await openTab(page, "Domains");

  await shoot(sheet.getByRole("region", { name: "Domains", exact: true }), "domains");

  const felt = sheet.getByRole("region", { name: "Loadout and vault" });
  const deck = felt.getByRole("button", { name: /vault, \d+ cards?$/ });
  await expect(felt.getByRole("list", { name: "Loadout cards" }).getByRole("article")).toHaveCount(2);
  // Gathered vault: the hand and the deck only.
  await deck.click();
  await expect(deck).toHaveAttribute("aria-expanded", "false");
  await expect(felt.getByRole("list", { name: "Vault cards" })).toHaveCount(0);
  await shoot(felt, "loadout");

  // Vault one card and spread the vault.
  await client.mutation(api.characters.moveCard, { characterId, cardId: "book-of-ava", to: "vault", duringRest: false });
  await deck.click();
  await expect(deck).toHaveAttribute("aria-expanded", "true");
  await expect(felt.getByRole("list", { name: "Vault cards" }).getByRole("button", { name: "Move to loadout (2 Stress)" })).toBeVisible();
  await shoot(felt, "vault-spread");

  // A hand card is keyboard focusable and shows its footer: 'More' first (SC1), then its action.
  const hand = felt.getByRole("list", { name: "Loadout cards" }).getByRole("article", { name: "Deft Deceiver" });
  await hand.focus();
  await expect(hand).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(hand.getByRole("button", { name: "More about Deft Deceiver" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(hand.getByRole("button", { name: "Move to vault" })).toBeFocused();

  await openTab(page, "Heritage & Subclass");
  const cards = sheet.getByRole("list", { name: "Heritage and subclass cards" });
  await expect(cards.getByRole("article", { name: "Subclass: Troubadour Specialization (locked)" })).toContainText("Unlocks with your first upgraded subclass card");
  await expect(cards.getByRole("article", { name: "Subclass: Troubadour Mastery (locked)" })).toBeVisible();
  await shoot(cards, "hero-cards");
});
