import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { DOMAIN_CARDS } from "../../src/lib/srd/domain-cards";
import { openSheet, openTab } from "./visual/helpers";

// DD1: the Domain Deck on Domains > Domain Cards. The GM's level-1 Bard (Grace & Codex) starts with Deft Deceiver
// and Book of Ava, so every pick is used; a GM level correction to 2 opens one pick.

const core = (domain: string, level: number) => DOMAIN_CARDS.filter((c) => c.domain === domain && c.level === level && c.source === "core");

test("Domain Deck: no picks at level 1, take a card at level 2, hide above level and filter", async ({ page }) => {
  const { client, characterId, sheet } = await openSheet(page);
  await openTab(page, "Domains");
  const domains = sheet.getByRole("region", { name: "Domains", exact: true });
  const deck = sheet.getByRole("region", { name: "Domain Deck" });
  const grid = deck.getByRole("list", { name: "Domain Deck cards" });
  const grace1 = core("grace", 1).find((c) => c.id !== "deft-deceiver")!;
  const codex2 = core("codex", 2)[0]!;

  await expect(domains.getByText("2 of 2 cards chosen")).toBeVisible();
  await expect(grid.getByRole("button", { name: `No picks left for ${grace1.name}` })).toBeDisabled();
  await expect(grid.getByRole("article", { name: "Book of Ava" }).getByText("In loadout")).toBeVisible();

  await client.mutation(api.levelUp.correctLevel, { characterId, level: 2, idempotencyKey: crypto.randomUUID() });
  await expect(domains.getByText("2 of 3 cards chosen")).toBeVisible();
  const take = grid.getByRole("button", { name: `Take ${codex2.name}` });
  await expect(take).toBeEnabled();
  expect((await take.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await take.click();
  await expect(domains.getByText("3 of 3 cards chosen")).toBeVisible();
  await expect(sheet.getByRole("list", { name: "Loadout cards" }).getByRole("article", { name: codex2.name })).toBeVisible();
  await expect(grid.getByRole("article", { name: codex2.name }).getByText("In loadout")).toBeVisible();
  await expect(grid.getByRole("button", { name: `No picks left for ${grace1.name}` })).toBeDisabled();

  // Level-3 cards are face down until hidden.
  await expect(grid.getByRole("button", { name: "Face-down level 3 Codex card. Turn it over to read it." })).toHaveCount(core("codex", 3).length);
  await deck.getByLabel("Hide cards above my level").check();
  await expect(grid.getByRole("button", { name: /^Face-down/ })).toHaveCount(0);

  const filters = deck.getByRole("group", { name: "Filter by domain" });
  await filters.getByRole("button", { name: "Grace", exact: true }).click();
  await expect(filters.getByRole("button", { name: "Grace", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(grid.getByRole("article", { name: "Book of Ava" })).toHaveCount(0);
  await expect(grid.getByRole("article", { name: "Deft Deceiver" })).toBeVisible();
});
