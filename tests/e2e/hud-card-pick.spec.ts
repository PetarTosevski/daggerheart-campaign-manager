import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H3.1 (docs/tasks/TASK-HUD-H3.1.md): with the HUD on, Use on a card raises it ("Casting · pick a
// target") and opens the picking panel (CmpPicking 'One target · a card', Main 'Picking a target'): the card's art and
// rule in the header, a row per creature, the card's add-on as a rider switch that says it applies only on a hit, with
// its Hope pill and its own pick, the footer's cost line and one primary naming the action ("Cast on <target>"). In range
// the card resolves and its result shows above the fan; out of range the player waits for the GM (H3.0) and the GM's
// classic list shows the card, live. Wiring after H3.3: a card that needs a square (Book of Tyfar's Mysterious Mist)
// places it through the HUD's square picking (crosshair, banner and bar), with the keyboard.

const hand = (page: Page) => page.getByTestId("hud-hand");
const fanCard = (page: Page, name: string) => hand(page).getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
const pickPanel = (page: Page) => page.getByTestId("hud-pick");
const pickRow = (page: Page, tokenId: string) => pickPanel(page).locator(`[data-testid="hud-pick-row"][data-token="${tokenId}"]`);

async function useCard(page: Page, name: string) {
  await fanCard(page, name).hover();
  await fanCard(page, name).getByRole("button", { name: `Use ${name}` }).click();
  await expect(pickPanel(page)).toBeVisible();
}

test("a player casts a card through the picking panel: rule, rows, rider with its pick and Hope pill, Cast on <target>", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, enemies } = s;
  try {
    // The Bandit stands Very Close to the Lieutenant, so the rider's Restrain reaches it (CB p.338).
    await s.client.mutation(api.combatTokens.move, { campaignId: s.campaignId, tokenId: enemies.bandit.tokenId, x: 15, y: 10 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });

    await useCard(player, "Vicious Entangle");
    const panel = pickPanel(player);
    await expect(fanCard(player, "Vicious Entangle")).toContainText("Casting · pick a target");
    await expect(fanCard(player, "Vicious Entangle")).toHaveAttribute("data-wash", "play");
    await expect(panel.getByRole("heading", { name: "Vicious Entangle", level: 2 })).toBeFocused();
    await expect(panel.getByTestId("hud-pick-rule")).toHaveText("Pick 1 target within Far");
    await expect(panel.locator(".hud-pk-art img")).toBeVisible();

    // Rows: the Lieutenant in reach (Far), the Sniper out ('GM approves'), the walled Bandit not listed.
    await expect(pickRow(player, enemies.lieutenant.tokenId)).toHaveAttribute("data-state", "in");
    await expect(pickRow(player, enemies.sniper.tokenId)).toContainText("GM approves");
    await expect(pickRow(player, enemies.hiddenBandit.tokenId)).toHaveCount(0);
    await expect(panel.getByTestId("hud-pick-go")).toBeDisabled();
    await pickRow(player, enemies.lieutenant.tokenId).click();
    await expect(panel.getByTestId("hud-pick-go")).toHaveText(`Cast on ${enemies.lieutenant.name}`);

    // The rider: only on a hit, a Hope pill; on, it asks whom it restrains, and the footer names the Hope.
    const rider = panel.getByRole("switch", { name: /^If it hits, also Restrain/ });
    await expect(rider.getByRole("img", { name: "1 Hope" })).toBeVisible();
    await rider.click();
    const who = panel.getByTestId("hud-card-who-picked");
    await expect(who).toContainText("Restrain: pick who");
    await who.getByRole("radio", { name: enemies.bandit.name }).click();
    await expect(panel.getByTestId("hud-pick-pay")).toContainText("Hope if it hits");
    await expect(player.locator(`[data-testid="hud-pick-ring"][data-token="${enemies.bandit.tokenId}"]`)).toContainText("Restrain");
    await expectNoSeriousA11yViolations(player);

    // Cast: in range, the card resolves; the panel goes, the card lowers, its result shows above the fan.
    await panel.getByTestId("hud-pick-go").click();
    await expect(panel).toHaveCount(0);
    await expect(player.getByTestId("hud-result")).toBeVisible({ timeout: 30_000 }); // H4.1's result panel
    await expect(fanCard(player, "Vicious Entangle")).not.toContainText("Casting");

    // Esc cancels another Use: the panel goes and the card lowers.
    await useCard(player, "Unleash Chaos");
    await player.keyboard.press("Escape");
    await expect(pickPanel(player)).toHaveCount(0);
    await expect(fanCard(player, "Unleash Chaos")).not.toContainText("Casting");
  } finally {
    await s.close();
  }
});

test("live: a card cast out of range waits for the GM; the GM's queue shows it; Withdraw removes it", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, enemies, client, campaignId } = s;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
    }
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    // The GM's HUD queue ("Waiting on you", plan combat-hud H5.1) lists the out-of-range cast.
    // The queue opens from "Waiting on you" (closed by default, plan combat-hud H9.2).
    await gm.getByRole("button", { name: /^Waiting on you/ }).click();
    const sanctions = gm.getByTestId("hud-queue").getByTestId("hud-queue-range");
    await expect(sanctions).toHaveCount(0);

    await useCard(player, "Vicious Entangle");
    const panel = pickPanel(player);
    await pickRow(player, enemies.sniper.tokenId).click();
    await expect(panel.getByTestId("hud-pick-pay")).toContainText("the GM approves first");
    await panel.getByTestId("hud-pick-go").click();

    // Never an error: the session ends, the card lowers, 'Waiting for the GM' names the card.
    await expect(panel).toHaveCount(0);
    const wait = player.getByTestId("hud-pick-wait");
    await expect(wait).toHaveCount(1);
    await expect(wait).toContainText("Vicious Entangle · out of range");
    await expect(fanCard(player, "Vicious Entangle")).not.toContainText("Casting");
    await expectNoSeriousA11yViolations(player);

    await expect(sanctions).toHaveCount(1);
    await wait.getByRole("button", { name: "Withdraw Vicious Entangle" }).click();
    await expect(wait).toHaveCount(0);
    await expect(sanctions).toHaveCount(0);
    await expect.poll(async () => (await client.query(api.combatCardsReads.pending, { campaignId })).length).toBe(0);
  } finally {
    await s.close();
  }
});

test("a card that needs a square places it through the HUD picker: the panel ends, crosshair and bar, arrows + Enter", async ({ browser }) => {
  test.setTimeout(300_000);
  // Moss as a wizard with Book of Tyfar (codex.ts: Mysterious Mist, an area on a point within Very Close).
  const s = await hudScene(browser, { moss: { classId: "wizard", domainCards: ["book-of-tyfar", "book-of-illiat"] } });
  const { player, client, campaignId, mapId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    const mossToken = (await client.query(api.combatTokensReads.list, { campaignId, mapId })).find((t) => t._id === moss.tokenId)!;

    await useCard(player, "Book of Tyfar");
    const panel = pickPanel(player);
    await panel.getByTestId("hud-card-spell").getByRole("radio", { name: "Mysterious Mist" }).click();
    await panel.getByTestId("hud-pick-go").click();

    // The pick session ends first; the map's square picking takes over (H3.3), the card stays raised.
    await expect(panel).toHaveCount(0);
    const bar = player.getByTestId("hud-area-bar");
    await expect(bar.getByTestId("hud-area-banner")).toContainText("Pick the centre of Mysterious Mist within Very Close");
    await expect(bar.getByText("Blocks sight")).toBeVisible();
    await expect(bar.getByTestId("hud-area-banner")).toBeFocused();
    await expect(fanCard(player, "Book of Tyfar")).toContainText("Casting");

    // Keyboard: the crosshair starts on Moss; one square right, Enter places, Enter confirms.
    for (const key of ["ArrowRight", "ArrowRight"]) await player.keyboard.press(key);
    await expect(player.getByTestId("hud-area-aim")).toHaveAttribute("data-x", String(mossToken.x + 1));
    await player.keyboard.press("Enter");
    await expect(player.getByTestId("hud-area-point")).toHaveAttribute("data-x", String(mossToken.x + 1));
    await player.keyboard.press("Enter");
    await expect(player.getByTestId("hud-area-line")).toHaveText(/Mysterious Mist (is on the map|failed)/, { timeout: 30_000 });
    await expect(bar).toHaveCount(0);
    await expect(fanCard(player, "Book of Tyfar")).not.toContainText("Casting");
    if (/is on the map/.test((await player.getByTestId("hud-area-line").textContent()) ?? "")) {
      await expect
        .poll(async () => (await client.query(api.combatAreas.list, { campaignId, mapId })).map((a) => a.centre))
        .toContainEqual({ kind: "square", x: mossToken.x + 1, y: mossToken.y });
    }
  } finally {
    await s.close();
  }
});
