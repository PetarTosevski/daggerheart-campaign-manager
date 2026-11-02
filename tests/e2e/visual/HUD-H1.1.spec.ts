import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { hudScene } from "../hud/helpers";

/** The banner row (the region itself has no size: its banners hang absolutely), 700 × 320 from the HUD's corner. */
async function shootRow(page: Page, path: string) {
  const hud = await page.getByTestId("combat-hud").boundingBox();
  if (!hud) throw new Error("no HUD");
  await page.screenshot({ path, animations: "disabled", clip: { x: hud.x, y: hud.y, width: 700, height: 320 } });
}

// Shots for docs/tasks/TASK-HUD-H1.1.md (E2E_VISUAL=1): the party banners on the seed's real party, set to the boards'
// states (CmpTokens 'Banners': You / Ally / With a condition / Last Hit Point; Main's row at 1440 × 900; GMDesktop's
// row; a tablet look at 1024 × 768). Board renders to compare: reference/designs/combat-hud/preview/{Main,
// CmpTokens, GMDesktop}.dc.html.

const OUT = "test-results/visual/HUD-H1.1";

test("HUD-H1.1 party banners at 1440 and 1024", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId } = s;
  const id = (name: string) => s.pcs.find((p) => p.name === name)!.characterId;
  try {
    // The boards' numbers where the seed allows: Moss 2 HP / 3 Stress marked, 1 Hope; Brannoc 1 Stress, 3 Hope;
    // Vex Hidden; Oriel at her last Hit Point (every HP marked).
    const party = await client.query(api.combatHud.party, { campaignId, mapId: s.mapId });
    const set = async (characterId: Id<"characters">, resource: "hp" | "stress" | "hope" | "armor", to: number) => {
      const row = party.find((m) => m.characterId === characterId)!;
      const now = resource === "hope" ? row.hope.value : row[resource].marked;
      if (to !== now) await client.mutation(api.characters.adjustResource, { characterId, resource, delta: to - now });
    };
    await set(id("Moss"), "hp", 2);
    await set(id("Moss"), "stress", 3);
    await set(id("Moss"), "hope", 1);
    await set(id("Moss"), "armor", 1);
    await set(id("Brannoc"), "stress", 1);
    await set(id("Brannoc"), "hope", 3);
    await client.mutation(api.characters.toggleCondition, { characterId: id("Vex"), condition: "hidden" });
    const oriel = party.find((m) => m.name === "Oriel")!;
    await set(id("Oriel"), "hp", oriel.hp.max);

    for (const page of [player, gm]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByRole("list", { name: "The party" }).getByRole("button")).toHaveCount(4);
    }
    await expect(player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Vex's sheet" })).toContainText("Hidden");
    await player.screenshot({ path: `${OUT}/player-main-1440.png`, animations: "disabled" });
    await shootRow(player, `${OUT}/player-banners-1440.png`);

    // Moss's banner open: it drops 8 px (the classic drawer covers the right until H2.1).
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" }).click();
    await expect(player.getByTestId("sheet-drawer-trackers")).toBeVisible();
    await player.waitForTimeout(600); // the drawer's slide-in
    await player.screenshot({ path: `${OUT}/player-open-moss-1440.png`, animations: "disabled" });
    await player.keyboard.press("Escape");

    await gm.screenshot({ path: `${OUT}/gm-main-1440.png`, animations: "disabled" });
    await shootRow(gm, `${OUT}/gm-banners-1440.png`);

    await player.setViewportSize({ width: 1024, height: 768 });
    await player.screenshot({ path: `${OUT}/player-main-1024.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
});
