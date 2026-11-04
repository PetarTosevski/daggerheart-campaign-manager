import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H2.3.md (E2E_VISUAL=1): the HUD hand on the seed's real cards, set to the boards'
// states (CmpCards: ready, playing, can't afford, used, locked (GM), another player's card, hidden hand; vault and
// recall; roll options; full card view. Main: the hand bottom centre with the vault, Roll options and Hide cards beside
// the fan) at 1440 × 900, 1024 × 768 and 390 × 844. Board renders to compare:
// reference/designs/combat-hud/preview/{CmpCards,Main}.dc.html.

const OUT = "test-results/visual/HUD-H2.3";

const hand = (page: Page) => page.getByTestId("hud-hand");

/** The bottom band of the screen where the hand hangs. */
async function shootHand(page: Page, path: string, height = 420) {
  const size = page.viewportSize()!;
  // The HUD is viewport-tall under the campaign header: scroll so it fills the window, its bottom edge at the window's.
  await page.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
  await page.screenshot({ path, animations: "disabled", clip: { x: 0, y: size.height - height, width: size.width, height } });
}

test("HUD-H2.3 the hand's states at 1440, 1024 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(360_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId, characterId } = s;
  try {
    for (const page of [player, gm]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }
    await expect(hand(player).getByTestId("hud-hand-card")).toHaveCount(2);
    for (const page of [player, gm]) await page.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
    await player.screenshot({ path: `${OUT}/player-main-1440.png`, animations: "disabled" });
    await shootHand(player, `${OUT}/player-hand-1440.png`);

    // Ready, raised by hover: Use and More on the app's face.
    await hand(player).getByTestId("hud-hand-card").first().hover();
    await player.waitForTimeout(400);
    await shootHand(player, `${OUT}/player-raised-1440.png`, 560);
    await player.mouse.move(10, 10);

    // Playing: the Use dialog open, the card lifted and glowing with 'Casting · pick a target'.
    await hand(player).getByTestId("hud-hand-card").first().hover();
    await hand(player).getByRole("button", { name: "Use Vicious Entangle" }).click();
    await expect(player.getByRole("dialog", { name: "Vicious Entangle" })).toBeVisible();
    await shootHand(player, `${OUT}/player-playing-1440.png`);
    await player.keyboard.press("Escape");

    // Roll options.
    await hand(player).getByRole("button", { name: "Roll options" }).click();
    await shootHand(player, `${OUT}/player-roll-options-1440.png`, 520);
    await player.keyboard.press("Escape");

    // The vault with a card to recall.
    await client.mutation(api.characters.moveCard, { characterId, cardId: "unleash-chaos", to: "vault" });
    await hand(player).getByRole("button", { name: "Open vault, 1 card" }).click();
    await expect(player.getByTestId("hud-hand-vault")).toBeVisible();
    await shootHand(player, `${OUT}/player-vault-1440.png`, 620);
    await player.keyboard.press("Escape");
    await client.mutation(api.characters.moveCard, { characterId, cardId: "unleash-chaos", to: "loadout" });

    // The full card (More).
    await hand(player).getByTestId("hud-hand-card").first().hover();
    await hand(player).getByRole("button", { name: "More about Vicious Entangle" }).click();
    await expect(player.getByTestId("hud-full-card")).toBeVisible();
    await player.screenshot({ path: `${OUT}/player-full-card-1440.png`, animations: "disabled" });
    await player.keyboard.press("Escape");

    // Hide cards: the fan folded on this screen.
    await hand(player).getByRole("button", { name: "Hide cards" }).click();
    await shootHand(player, `${OUT}/player-folded-1440.png`);
    await hand(player).getByRole("button", { name: "Show cards (2)" }).click();

    // Another player's hand, view only, then hidden.
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Brannoc's sheet" }).click();
    await expect(hand(player).getByTestId("hud-hand-card").first()).toContainText("Brannoc’s hand · view only");
    await shootHand(player, `${OUT}/player-view-only-1440.png`);
    const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
    await client.mutation(api.combatCards.setHandHidden, { campaignId, characterId: brannoc.characterId, hidden: true });
    await expect(hand(player)).toHaveAttribute("data-mode", "hidden");
    await shootHand(player, `${OUT}/player-hidden-1440.png`);
    await player.keyboard.press("Escape");

    // The GM: Moss's hand locked until Play-for.
    await gm.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" }).click();
    await expect(hand(gm).getByTestId("hud-hand-card").first()).toContainText("Turn on “Play for Moss”");
    await shootHand(gm, `${OUT}/gm-locked-1440.png`);
    await gm.keyboard.press("Escape");

    // Can't afford needs a card with an up-front Hope cost, which the seed's two cards are not: the unit tests cover it.
    for (const [w, h] of [
      [1024, 768],
      [390, 844],
    ] as const) {
      await player.setViewportSize({ width: w, height: h });
      await player.waitForTimeout(300);
      await player.screenshot({ path: `${OUT}/player-main-${w}.png`, animations: "disabled" });
    }
  } finally {
    await s.close();
  }
});
