import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { INITIAL_COMPANION } from "../../../src/lib/frames/extras/companion";
import { cardsForDomains, getClass } from "../../../src/lib/srd";
import { openSheet, visual } from "./helpers";

// S2: the Defence and Hope boxes at 1440 and 390 (no horizontal scroll at 390).
// Board counterparts: node scripts/board-shots.mjs defence hope

test("S2 Defence and Hope boxes, with a scar", { tag: "@visual" }, async ({ page }) => {
  const { sheet, client, characterId } = await openSheet(page);
  await client.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta: 1 });
  await client.mutation(api.characters.adjustResource, { characterId, resource: "scars", delta: 1 });
  await client.mutation(api.characters.adjustResource, { characterId, resource: "armor", delta: 1 });
  await expect(sheet.getByRole("group", { name: "Hope: 3 of 5 marked, 1 lost to scars" })).toBeVisible();
  await expect(sheet.getByRole("img", { name: "Hope slot lost to a scar" })).toBeVisible();

  const { shoot } = visual(page, "S2");
  await shoot(sheet.getByRole("region", { name: "Defence", exact: true }), "defence");
  await shoot(sheet.getByRole("region", { name: "Hope", exact: true }), "hope");
});

test("S2 Light in the Dark: a 7th coin with a gold ring in the same row", { tag: "@visual" }, async ({ page }) => {
  const ranger = getClass("ranger")!;
  const domainCards = cardsForDomains(ranger.domains, 1)
    .filter((c) => c.level === 1)
    .slice(0, 2)
    .map((c) => c.id);
  const { sheet, client, characterId } = await openSheet(page, {
    draft: { name: "Vex", classId: "ranger", subclassId: "beastbound", domainCards },
  });
  await client.mutation(api.levelUp.correctLevel, { characterId, level: 2, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characterExtras.saveCompanion, {
    characterId,
    state: { ...INITIAL_COMPANION, training: { lightInTheDark: 1 } },
    idempotencyKey: crypto.randomUUID(),
  });
  await client.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta: 12 });

  const hope = sheet.getByRole("region", { name: "Hope", exact: true });
  await expect(hope.getByRole("group", { name: "Hope: 7 of 7 marked" })).toBeVisible();
  await expect(hope.getByRole("button", { name: "Hope 7 of 7" })).toHaveAttribute("title", "Light in the Dark");

  const { shoot } = visual(page, "S2");
  await shoot(hope, "hope-litd");
  // A scar takes the last slot: Light in the Dark's coin cracks.
  await client.mutation(api.characters.adjustResource, { characterId, resource: "scars", delta: 1 });
  await expect(hope.getByRole("img", { name: "Hope slot lost to a scar" })).toHaveAttribute("title", "Light in the Dark");
  await shoot(hope, "hope-litd-scar");
});
