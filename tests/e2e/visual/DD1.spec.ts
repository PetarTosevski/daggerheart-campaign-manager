import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { DOMAIN_CARDS } from "../../../src/lib/srd/domain-cards";
import { openSheet, openTab, visual } from "./helpers";

const firstCore = (domain: string, level: number) => DOMAIN_CARDS.find((c) => c.domain === domain && c.level === level && c.source === "core")!;

// DD1: the Domain Deck (Domains > Domain Cards), at 1440 and 390.
// Board counterpart: node scripts/board-shots.mjs domain-deck

test("DD1 domain deck at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, characterId, sheet } = await openSheet(page);
  const { shoot } = visual(page, "DD1");
  // Level 2 with one pick left: Take card buttons, owned badges, face-down level-3+ cards.
  await client.mutation(api.levelUp.correctLevel, { characterId, level: 2, idempotencyKey: crypto.randomUUID() });
  await openTab(page, "Domains");
  const deck = sheet.getByRole("region", { name: "Domain Deck" });
  const grid = deck.getByRole("list", { name: "Domain Deck cards" });
  await expect(grid.getByRole("button", { name: `Take ${firstCore("codex", 2).name}` })).toBeVisible();
  await shoot(deck, "domain-deck");

  // One card turned over (its face greyed with "Unlocks at level 3" and Turn over), one card's text expanded.
  const item = grid.getByRole("listitem").filter({ hasText: firstCore("grace", 3).name });
  await item.getByRole("button", { name: /^Face-down/ }).click();
  await expect(item.getByRole("button", { name: /^Turn over/ })).toBeFocused();
  await expect(item.getByText("Unlocks at level 3")).toBeVisible();
  await grid.getByRole("button", { name: "More about Book of Ava" }).click();
  await expect(grid.getByRole("button", { name: "Less about Book of Ava" })).toHaveAttribute("aria-expanded", "true");
  await shoot(deck, "domain-deck-flipped");
});
