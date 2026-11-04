import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H2.1.md (E2E_VISUAL=1): the sheet panel on the seed's real party, set to the boards'
// numbers where the seed allows. Main 1440 × 900: Moss's own sheet, Brannoc's view-only sheet; GMDesktop 1440 × 900:
// Vex's sheet (GM edit, Hidden); a tablet look at 1024 × 768. Board renders to compare:
// reference/designs/combat-hud/preview/{Main,GMDesktop}.dc.html (open a banner on the board).

const OUT = "test-results/visual/HUD-H2.1";

async function openSheet(page: Page, name: string) {
  await page.getByRole("list", { name: "The party" }).getByRole("button", { name: `Open ${name}'s sheet` }).click();
  await expect(page.getByRole("complementary", { name: `${name}’s sheet` }).getByTestId("hud-sheet-trackers")).toBeVisible();
  await page.waitForTimeout(700); // the panel's slide-in and the map's make-room move
}

test("HUD-H2.1 the sheet panel: own, view only, GM edit", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId } = s;
  const id = (name: string) => s.pcs.find((p) => p.name === name)!.characterId;
  try {
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
    await set(id("Vex"), "stress", 2);
    await set(id("Vex"), "hope", 2);
    await client.mutation(api.characters.toggleCondition, { characterId: id("Vex"), condition: "hidden" });

    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await openSheet(player, "Moss");
    await player.screenshot({ path: `${OUT}/main-own-moss-1440.png`, animations: "disabled" });
    await player.getByRole("complementary", { name: "Moss’s sheet" }).screenshot({ path: `${OUT}/main-own-moss-panel.png`, animations: "disabled" });

    await openSheet(player, "Brannoc");
    await player.screenshot({ path: `${OUT}/main-view-brannoc-1440.png`, animations: "disabled" });
    await player.getByRole("complementary", { name: "Brannoc’s sheet" }).screenshot({ path: `${OUT}/main-view-brannoc-panel.png`, animations: "disabled" });

    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await openSheet(gm, "Vex");
    await gm.screenshot({ path: `${OUT}/gm-edit-vex-1440.png`, animations: "disabled" });
    await gm.getByRole("complementary", { name: "Vex’s sheet" }).screenshot({ path: `${OUT}/gm-edit-vex-panel.png`, animations: "disabled" });

    await player.setViewportSize({ width: 1024, height: 768 });
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Brannoc's sheet" }).click();
    await openSheet(player, "Moss");
    await player.screenshot({ path: `${OUT}/main-own-moss-1024.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
});
