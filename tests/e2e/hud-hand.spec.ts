import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H2.3 (docs/tasks/TASK-HUD-H2.3.md): with the HUD on, the hand hangs at the bottom of the map as the
// domains tab's fan with the app's own card face and every CmpCards state around it; beside it the vault (recall),
// Roll options and Hide cards (answer 16a: folds the viewer's own fan, local only). More opens the full card over the
// map; Use opens the picking panel (H3.1, tests/e2e/hud-card-pick.spec.ts). The GM sees the hand of the PC whose sheet is open, locked until
// Play-for; a player sees another PC's hand view only while its sheet is open, or why it is hidden.

const hand = (page: Page) => page.getByTestId("hud-hand");
const fanCard = (page: Page, name: string) => hand(page).getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

test("the HUD hand: fan states, Hide cards, Roll options, full card, Use, vault recall, GM lock and view only", async ({ browser }) => {
  test.setTimeout(360_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId, characterId } = s;
  const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }

    // The player's own hand: both cards in the fan, each with the app's face and a Use button; bottom centre.
    await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    await expect(hand(player).getByTestId("hud-hand-card")).toHaveCount(2);
    await expect(hand(player).getByRole("button", { name: "Use Vicious Entangle" })).toBeAttached();
    await expect(hand(player).getByTestId("combat-hand-card")).toHaveCount(2);
    const region = await player.locator('[data-hud-region="hand"]').boundingBox();
    const fan = await hand(player).getByTestId("hud-hand-fan").boundingBox();
    expect(region && fan).toBeTruthy();
    expect(Math.abs(fan!.x + fan!.width / 2 - (region!.x + region!.width / 2))).toBeLessThan(140);
    await expect(hand(player).getByRole("button", { name: "Open vault, 0 cards" })).toBeVisible();
    await expectNoSeriousA11yViolations(player);

    // Hide cards folds the fan on this screen only; Show cards brings it back.
    await hand(player).getByRole("button", { name: "Hide cards" }).click();
    await expect(hand(player).getByTestId("hud-hand-fan")).toHaveCount(0);
    await expect(hand(player).getByTestId("hud-hand-folded")).toBeVisible();
    await expect(hand(player).getByRole("button", { name: "Show cards (2)" })).toHaveAttribute("aria-expanded", "false");
    await hand(player).getByRole("button", { name: "Show cards (2)" }).click();
    await expect(hand(player).getByTestId("hud-hand-card")).toHaveCount(2);

    // Roll options: Experiences with their Hope cost, advantage −3..+3, Help dice; Esc closes and gives focus back.
    const rollsButton = hand(player).getByRole("button", { name: "Roll options" });
    await rollsButton.click();
    const rolls = player.getByTestId("hud-hand-rolls");
    await expect(rolls.getByRole("heading", { name: "Roll options" })).toBeVisible();
    await rolls.getByRole("button", { name: "More advantage" }).click();
    await expect(rolls.getByRole("group", { name: "Advantage" }).locator("output")).toHaveText("+1");
    await expect(rolls.getByRole("group", { name: "Help dice" })).toBeVisible();
    await expectNoSeriousA11yViolations(player);
    await player.keyboard.press("Escape");
    await expect(rolls).toBeHidden();
    await expect(rollsButton).toBeFocused();
    await expect(rollsButton).toHaveAttribute("data-set", "true");

    // More opens the full card over the map with Use and Close at its foot; Escape closes it, focus back on More.
    const more = fanCard(player, "Vicious Entangle").getByRole("button", { name: "More about Vicious Entangle" });
    await more.focus();
    await more.press("Enter");
    const full = player.getByTestId("hud-full-card");
    await expect(full).toBeVisible();
    await expect(full.getByRole("heading", { name: "Vicious Entangle", level: 2 })).toBeVisible();
    await expect(full.getByRole("button", { name: "Use" })).toBeVisible();
    await expect(full.getByRole("button", { name: "Close" })).toBeVisible();
    await expectNoSeriousA11yViolations(player);
    await player.keyboard.press("Escape");
    await expect(full).toBeHidden();
    await expect(more).toBeFocused();

    // Use with no enemy picked: the picking panel (H3.1) asks for the target; the card is tagged as being cast meanwhile.
    // The card hangs below the edge: hovering raises it whole, then its Use is in reach.
    await fanCard(player, "Vicious Entangle").hover();
    await fanCard(player, "Vicious Entangle").getByRole("button", { name: "Use Vicious Entangle" }).click();
    const dialog = player.getByTestId("hud-pick");
    await expect(dialog).toBeVisible();
    await expect(fanCard(player, "Vicious Entangle")).toContainText("Casting · pick a target");
    await expect(fanCard(player, "Vicious Entangle")).toHaveAttribute("data-wash", "play");
    await player.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(fanCard(player, "Vicious Entangle")).not.toContainText("Casting");

    // The vault: a card sent there shows on the deck; Recall · 1 Stress in combat brings it back (characters.moveCard).
    await client.mutation(api.characters.moveCard, { characterId, cardId: "unleash-chaos", to: "vault" });
    await expect(hand(player).getByTestId("hud-hand-card")).toHaveCount(1);
    const deck = hand(player).getByRole("button", { name: "Open vault, 1 card" });
    await deck.click();
    const vault = player.getByTestId("hud-hand-vault");
    await expect(vault.getByRole("heading", { name: "Vault (1)" })).toBeVisible();
    await expect(vault.getByRole("button", { name: "Recall · 1 Stress, Unleash Chaos" })).toBeVisible();
    await expectNoSeriousA11yViolations(player);
    const before = await client.query(api.charactersReads.get, { characterId });
    await vault.getByRole("button", { name: "Recall · 1 Stress, Unleash Chaos" }).click();
    await expect(hand(player).getByTestId("hud-hand-card")).toHaveCount(2);
    await expect(vault.getByText("The vault is empty.")).toBeVisible();
    await expect.poll(async () => (await client.query(api.charactersReads.get, { characterId }))!.sheet.stress).toBe(before!.sheet.stress + 1);
    await vault.getByRole("button", { name: "Close vault (0)" }).click();
    await expect(vault).toBeHidden();

    // The GM: no hand until a PC's sheet is open; Moss's hand is locked until Play-for is on.
    await expect(hand(gm)).toHaveCount(0);
    await gm.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" }).click();
    await expect(hand(gm)).toHaveAttribute("data-mode", "gm");
    await expect(hand(gm).getByTestId("hud-hand-card").first()).toContainText("Turn on “Play for Moss”");
    await expect(hand(gm).getByRole("button", { name: /^Use / })).toHaveCount(0);
    await expect(hand(gm).getByRole("button", { name: "Roll options" })).toHaveCount(0);
    await client.mutation(api.playFor.set, { campaignId, characterId: moss.characterId, on: true });
    await expect(hand(gm).getByRole("button", { name: "Use Vicious Entangle" })).toBeAttached();
    await expect(hand(gm).getByText("Turn on “Play for Moss”")).toHaveCount(0);
    await client.mutation(api.playFor.set, { campaignId, characterId: moss.characterId, on: false });

    // The player opens Brannoc's sheet: Brannoc's hand, view only; once Brannoc's hand is hidden, why it is.
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Brannoc's sheet" }).click();
    await expect(hand(player)).toHaveAttribute("data-mode", "view");
    await expect(hand(player).getByTestId("hud-hand-card").first()).toContainText("Brannoc’s hand · view only");
    await expect(hand(player).getByRole("button", { name: /^Use / })).toHaveCount(0);
    await expect(hand(player).getByRole("button", { name: "Hide cards" })).toHaveCount(0);
    await client.mutation(api.combatCards.setHandHidden, { campaignId, characterId: brannoc.characterId, hidden: true });
    await expect(hand(player)).toHaveAttribute("data-mode", "hidden");
    await expect(hand(player)).toContainText("Brannoc keeps their hand hidden.");
    await player.keyboard.press("Escape");
    await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
  } finally {
    await s.close();
  }
});
