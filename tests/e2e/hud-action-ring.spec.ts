import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H3.4 (docs/tasks/TASK-HUD-H3.4.md): with the HUD on, a click on your own token opens the action ring
// (board Main 'Picking a target' / 'Can't afford'; answer 3b): Attack (H3.2's picker), Cast (raises the hand), Sheet
// (your sheet) and every feature with a Use button (H3.3's picker), a locked one with its reason ("Evolution needs 3
// Hope. You have 1."); more than the arc holds go under "More". Buttons have names, Esc closes, the ring never covers
// your token's arcs, and it stays on your token while the map makes room for the sheet (H2.2).

test.use({ actionTimeout: 30_000 });

const ringOf = (page: Page) => page.getByRole("toolbar", { name: "Your actions (Moss)" });

async function centre(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width };
}

/** Every ring button sits outside the token's arcs (their svg box is the arcs' outer circle). */
async function expectClearOfArcs(token: Locator, ring: Locator) {
  const arcs = await centre(token.locator("svg.tk-arc"));
  const buttons = ring.getByTestId("hud-ar-button");
  const n = await buttons.count();
  expect(n).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < n; i += 1) {
    const b = await centre(buttons.nth(i));
    expect(Math.hypot(b.x - arcs.x, b.y - arcs.y) - b.w / 2, `button ${i} clear of the arcs`).toBeGreaterThanOrEqual(arcs.w / 2);
  }
}

/** A ring button by name, opening "More" first when it sits there. */
async function ringButton(page: Page, name: string): Promise<Locator> {
  const ring = ringOf(page);
  const direct = ring.getByTestId("hud-ar-button").and(page.getByRole("button", { name, exact: true }));
  if ((await direct.count()) > 0) return direct;
  const more = ring.getByRole("button", { name: /^More actions/ });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  return ring.getByRole("group", { name: "More actions" }).getByRole("button", { name, exact: true });
}

test("a player's action ring: Attack, Cast, Sheet, features (Evolution locked with its reason); Esc; clear of the arcs; while the map makes room", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    // Moss at 1 Hope: Evolution (3 Hope, CB p.30) is locked, as on the board.
    const sheet = await client.query(api.combatHud.sheet, { characterId: moss.characterId });
    const delta = 1 - sheet.trackers.hope.value;
    if (delta !== 0) await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "hope", delta });

    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    const hud = player.getByTestId("combat-hud");
    await expect(hud).toBeVisible();
    const board = player.getByRole("region", { name: "Battle map" });
    const token = board.getByRole("button", { name: /^Open Moss’s sheet \(your character\)/ });
    await expect(token).toHaveAttribute("aria-expanded", "false");

    // A click on your token opens the ring (not the sheet).
    await token.click();
    const ring = ringOf(player);
    await expect(ring.getByTestId("hud-ar-button").first()).toBeVisible();
    await expect(token).toHaveAttribute("aria-expanded", "true");
    await expect(hud).not.toHaveClass(/hud-sh-open/);
    const first = ring.getByTestId("hud-ar-button");
    await expect(first.nth(0)).toHaveAccessibleName("Attack");
    await expect(first.nth(1)).toHaveAccessibleName("Cast");
    await expect(first.nth(2)).toHaveAccessibleName("Sheet");
    await expect(ring.getByRole("button", { name: "Attack" })).toBeEnabled({ timeout: 30_000 });
    await expect(ring.getByRole("button", { name: "Attack" })).not.toHaveAttribute("aria-disabled");
    // The features follow once Moss's sheet loads.
    await expect.poll(() => ring.getByTestId("hud-ar-button").count(), { timeout: 30_000 }).toBeGreaterThan(3);
    await expectClearOfArcs(token, ring);

    // Every feature with a Use button: Evolution locked with the board's reason; Beastform usable.
    const evolution = await ringButton(player, "Use Evolution");
    await expect(evolution).toHaveAttribute("aria-disabled", "true");
    await expect(evolution).toHaveAccessibleDescription("Evolution needs 3 Hope. You have 1.");
    await expect(await ringButton(player, "Use Beastform")).not.toHaveAttribute("aria-disabled");
    await expectNoSeriousA11yViolations(player);
    // Close the More list if it opened (Esc closes it first, the ring stays).
    if ((await ring.getByRole("group", { name: "More actions" }).count()) > 0) {
      await player.keyboard.press("Escape");
      await expect(ring.getByRole("group", { name: "More actions" })).toHaveCount(0);
      await expect(ring.getByTestId("hud-ar-button").first()).toBeVisible();
    } else {
      // In the ring: hovering the locked button shows the reason beside it (board `.rad-tip`).
      await evolution.hover();
      await expect(ring.getByTestId("hud-ar-tip")).toHaveText("Evolution needs 3 Hope. You have 1.");
    }

    // Attack opens H3.2's picker; the ring stays with Attack lit; Esc ends the picker and focus comes back to Attack.
    const attack = ring.getByRole("button", { name: "Attack" });
    await attack.click();
    const panel = player.getByTestId("hud-pick");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("hud-attack-weapon").first()).toBeVisible();
    await expect(attack).toHaveAttribute("aria-pressed", "true");
    await expectNoSeriousA11yViolations(player);
    await panel.getByRole("heading", { level: 2 }).focus();
    await player.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(ring.getByTestId("hud-ar-button").first()).toBeVisible();
    await expect(attack).toHaveAttribute("aria-pressed", "false");

    // Cast raises the hand: focus lands on a card in the fan (the card lifts).
    await ring.getByRole("button", { name: "Cast" }).click();
    await expect(player.locator('[data-testid="hud-hand-card"]:focus-within, [data-testid="hud-hand-card"]:focus')).toHaveCount(1);

    // Beastform opens H3.3's flow (the picking panel, or the classic flow beside the ring).
    await (await ringButton(player, "Use Beastform")).click();
    await expect(panel.or(ring.getByTestId("hud-ar-classic"))).toBeVisible();
    if (await panel.isVisible()) {
      await panel.getByRole("heading", { level: 2 }).focus();
      await player.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    }

    // Sheet opens your sheet; the map makes room and the ring stays centred on your token.
    const sheetButton = ring.getByRole("button", { name: "Sheet" });
    await sheetButton.click();
    await expect(player.getByRole("complementary", { name: "Moss’s sheet" })).toBeVisible();
    await expect(hud).toHaveClass(new RegExp(`hud-sh-${moss.characterId}`));
    await expect(sheetButton).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const [r, t] = [await centre(ring), await centre(token)];
        return Math.round(Math.hypot(r.x - t.x, r.y - t.y));
      })
      .toBeLessThanOrEqual(2);
    await expectClearOfArcs(token, ring);
    // A ring button still works while the map is shifted.
    await attack.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("heading", { level: 2 }).focus();
    await player.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await sheetButton.click();
    await expect(hud).not.toHaveClass(/hud-sh-open/);

    // Arrow keys go round the ring; Esc closes it and focus goes back to your token.
    await attack.focus();
    await player.keyboard.press("ArrowRight");
    await expect(ring.getByRole("button", { name: "Cast" })).toBeFocused();
    await player.keyboard.press("Escape");
    await expect(ring).toHaveCount(0);
    await expect(token).toBeFocused();
    await expect(token).toHaveAttribute("aria-expanded", "false");

    // Enter on your token opens it with focus on Attack; a press on the bare map closes it.
    await player.keyboard.press("Enter");
    await expect(ring.getByTestId("hud-ar-button").first()).toBeVisible();
    await expect(ring.getByRole("button", { name: "Attack" })).toBeFocused();
    const tokenBox = (await token.boundingBox())!;
    // Two and a half squares right, two down of Moss's centre: bare ground, below the ring's lowest button.
    await player.mouse.click(tokenBox.x + tokenBox.width * 3, tokenBox.y + tokenBox.height * 2.5);
    await expect(ring).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("the GM's token clicks still open sheets (no ring)", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    const hud = gm.getByTestId("combat-hud");
    await expect(hud).toBeVisible();
    await gm.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Open Moss’s sheet,/ }).click();
    await expect(hud).toHaveClass(new RegExp(`hud-sh-${moss.characterId}`));
    await expect(gm.getByTestId("hud-action-ring")).toHaveCount(0);
  } finally {
    await s.close();
  }
});
