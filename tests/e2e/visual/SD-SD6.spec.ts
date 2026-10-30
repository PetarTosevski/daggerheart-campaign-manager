import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { bardDraft, convexAs, openCombatMap } from "./helpers";

// Shots for the SD6 task doc (E2E_VISUAL=1): the sheet drawer over the live map at 1280, 1024x768, 768x1024 and 390 px
// (full screen at 760 px and below), for the player (their own Bard: trackers, the Hope feature, class, subclass with the
// rank locks, ancestry, community, Other features with "applied at rest"), an exhausted feature greyed with its reset
// label, and the GM's greyed view of the same PC before "Play for this character". The drawer has no board
// (analysis 1.4): it follows the Party sheet's look in the Combat Map's tokens.

const PLAYER = "e2e-player@example.test";
const OUT = "test-results/visual/SD-SD6";

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;

async function openDrawer(page: Page, width: number) {
  await page.getByTestId(width <= 760 ? "sheet-button-bottom" : "sheet-button-top").click();
  const drawer = page.getByRole("dialog", { name: "Character sheet" });
  await expect(drawer.getByTestId("sheet-drawer-features")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  return drawer;
}

test("SD6 the sheet drawer: player, exhausted feature and the GM's greyed view", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await playerClient.mutation(api.characters.adjustResource, { characterId: characterId as Id<"characters">, resource: "stress", delta: 2 });
    await playerClient.mutation(api.characters.adjustResource, { characterId: characterId as Id<"characters">, resource: "hp", delta: 1 });

    await player.goto(url);
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      const drawer = await openDrawer(player, viewport.width);
      await player.screenshot({ path: `${OUT}/player-${viewport.width}.png`, animations: "disabled" });
      if (viewport.width === 1280 || viewport.width === 390) {
        await drawer.getByTestId("sheet-drawer-features").evaluate((el) => el.closest(".sd-scroll")?.scrollTo(0, 99_999));
        await player.screenshot({ path: `${OUT}/player-end-${viewport.width}.png`, animations: "disabled" });
      }
      await drawer.getByRole("button", { name: "Close character sheet" }).click();
      await expect(drawer).toBeHidden();
    }

    // Rally (once per session) used: greyed with its reset label.
    const rally = await playerClient.query(api.combatFeatures.drawer, { campaignId, characterId: characterId as Id<"characters"> });
    const rallyFeature = rally.features.find((f) => f.featureId === "class:bard:rally");
    if (rallyFeature && rallyFeature.uses[0]?.ready) {
      await playerClient
        .mutation(api.combatFeatures.useFeature, {
          campaignId,
          idempotencyKey: crypto.randomUUID(),
          characterId: characterId as Id<"characters">,
          mapId,
          featureId: rallyFeature.featureId,
          targetTokenIds: [],
          choices: [],
        })
        .catch(() => undefined);
    }
    await player.setViewportSize(VIEWPORTS[0]);
    const drawer = await openDrawer(player, VIEWPORTS[0].width);
    await drawer.locator('[data-section="class"]').screenshot({ path: `${OUT}/class-section-1280.png`, animations: "disabled" });
    await drawer.getByRole("button", { name: "Close character sheet" }).click();

    // ---- The GM's greyed view of Ash.
    await page.goto(url);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Ash, / }).click();
      const gmDrawer = await openDrawer(page, viewport.width);
      await expect(gmDrawer.getByRole("switch", { name: "Play for this character" })).not.toBeChecked();
      await page.screenshot({ path: `${OUT}/gm-greyed-${viewport.width}.png`, animations: "disabled" });
      await gmDrawer.getByRole("button", { name: "Close character sheet" }).click();
      await expect(gmDrawer).toBeHidden();
    }
  } finally {
    await context.close();
  }
});
