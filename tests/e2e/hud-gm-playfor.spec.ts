import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { enableHud, hudScene } from "./hud/helpers";
import { convexAs } from "./visual/helpers";

// Plan hud-pre-w9 (docs/tasks/TASK-HUD-PRE-W9.md; user 2026-11-02), before wave 9 deletes the classic combat screen:
// 1. dcm-bxp.99.32.36: the GM playing for a PC ("Play for this character" on the PC's HUD sheet) attacks through the
//    player's weapon attack picker (H3.2), from Attack on that sheet; `combatActions.attack` runs for that PC.
// 2. dcm-bxp.99.32.37: End on a PC's lasting effect in the HUD sheet, for the GM and for the player whose character cast
//    the effect (`classFeatures.endEffect`, widened to the caster's player); any other player sees no End.

test.use({ actionTimeout: 30_000 });

const PLAYER_B = "e2e-player2@example.test";

const partyBanner = (page: Page, name: string) => page.getByRole("list", { name: "The party" }).getByRole("button", { name: `Open ${name}'s sheet` });
const sheetOf = (page: Page, name: string) => page.getByRole("complementary", { name: `${name}’s sheet` });

/** Puts a lasting effect on a character, cast by `casterId` when given (internal e2e seed). */
function seedEffect(args: { characterId: Id<"characters">; effectId: string; source: string; text: string; casterId?: Id<"characters"> }) {
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "classFeatures:seedEffectForE2e", JSON.stringify(args)], { stdio: "pipe" });
}

test("the GM plays for Brannoc and attacks the Bandit through the attack picker", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId } = s;
  try {
    const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
    // The Bandit steps next to Brannoc (Melee): in his weapon's range, so no GM sanction is asked.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: s.enemies.bandit.tokenId, x: 9, y: 9 });
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();

    await partyBanner(gm, "Brannoc").click();
    const sheet = sheetOf(gm, "Brannoc");
    await expect(sheet).toBeVisible();
    // No Attack until Play for is on.
    await expect(sheet.getByTestId("hud-sheet-attack")).toHaveCount(0);
    const playFor = sheet.getByRole("switch", { name: "Play for this character" });
    await playFor.click();
    await expect(playFor).toHaveAttribute("aria-checked", "true");

    const attack = sheet.getByTestId("hud-sheet-attack-weapon").first();
    await expect(attack).toBeEnabled({ timeout: 30_000 });
    await expect(attack).toHaveAccessibleName(/^Attack with .+ for Brannoc$/);
    await attack.click();

    // The player's picker (weapon tiles, one primary), with Brannoc as the actor.
    const panel = gm.getByTestId("hud-pick");
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveClass(/hud-pk-gm/);
    const tile = panel.getByTestId("hud-attack-weapon").first();
    await expect(tile).toHaveAttribute("aria-pressed", "true");
    const weaponName = (await tile.locator("b").textContent())!;
    const row = panel.locator(`[data-testid="hud-pick-row"][data-token="${s.enemies.bandit.tokenId}"]`);
    await row.click();
    await expect(panel.getByTestId("hud-pick-go")).toHaveText(`Attack the ${s.enemies.bandit.name} with ${weaponName}`);
    await expectNoSeriousA11yViolations(gm);
    await panel.getByTestId("hud-pick-go").click();
    await expect(panel).toHaveCount(0);

    // The attack resolved for Brannoc (a held or sanctioned one shows no result): the result names the Bandit.
    await expect(gm.getByTestId("hud-result-row").filter({ hasText: s.enemies.bandit.name })).toContainText(/Hit|Miss|Defeated/);
    await expect(gm.getByTestId("hud-result")).toContainText(brannoc.name);
  } finally {
    await s.close();
  }
});

test("End on lasting effects: the GM ends any, the caster's player ends theirs, another player sees no End", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId } = s;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
    const moss = s.pcs.find((p) => p.name === "Moss")!;
    const vex = s.pcs.find((p) => p.name === "Vex")!;
    seedEffect({ characterId: brannoc.characterId, effectId: "e2e-ward", source: "Rune Ward", text: "Reduce incoming damage", casterId: moss.characterId });
    seedEffect({ characterId: brannoc.characterId, effectId: "e2e-old", source: "Old Charm", text: "+1 to a roll" });
    seedEffect({ characterId: brannoc.characterId, effectId: "e2e-gm", source: "Gm Blessing", text: "+1 Evasion" });

    // Player B (Vex's player) joins in a third browser.
    const b = await context.newPage();
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(b, PLAYER_B);
    await expect(b).toHaveURL("/");
    const bClient = await convexAs(b);
    await bClient.mutation(api.members.joinByCode, { code });
    const roster = await client.query(api.members.roster, { campaignId });
    const row = roster.players.find((p) => "email" in p && p.email === PLAYER_B);
    await client.mutation(api.characters.assignOwner, { characterId: vex.characterId, ownerId: row!.userId });

    // The GM: End on every effect; ends the Old Charm.
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    await partyBanner(gm, "Brannoc").click();
    const gmSheet = sheetOf(gm, "Brannoc");
    await expect(gmSheet.getByTestId("hud-sheet-end-effect")).toHaveCount(3);
    await expectNoSeriousA11yViolations(gm);
    await gmSheet.getByRole("button", { name: "End Old Charm on Brannoc" }).click();
    await expect(gmSheet.getByText("Old Charm")).toHaveCount(0);

    // Player B: sees Brannoc's effects, no End.
    await b.goto(s.url);
    await enableHud(b);
    await b.goto(s.url);
    await partyBanner(b, "Brannoc").click();
    const bSheet = sheetOf(b, "Brannoc");
    await expect(bSheet.getByText("Rune Ward")).toBeVisible();
    await expect(bSheet.getByText("Gm Blessing")).toBeVisible();
    await expect(bSheet.getByTestId("hud-sheet-end-effect")).toHaveCount(0);

    // Moss's player cast the Rune Ward: End on it only.
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await partyBanner(player, "Brannoc").click();
    const pSheet = sheetOf(player, "Brannoc");
    await expect(pSheet.getByText("Gm Blessing")).toBeVisible();
    await expect(pSheet.getByTestId("hud-sheet-end-effect")).toHaveCount(1);
    await expectNoSeriousA11yViolations(player);
    await pSheet.getByRole("button", { name: "End Rune Ward on Brannoc" }).click();
    await expect(pSheet.getByText("Rune Ward")).toHaveCount(0);
    await expect(bSheet.getByText("Rune Ward")).toHaveCount(0);

    await expect
      .poll(async () => (await client.query(api.characters.get, { characterId: brannoc.characterId }))!.sheet.effects?.map((e) => e.id))
      .toEqual(["e2e-gm"]);
  } finally {
    await context.close();
    await s.close();
  }
});
