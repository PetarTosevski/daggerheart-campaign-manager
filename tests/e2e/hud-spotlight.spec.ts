import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H9.1 (docs/tasks/TASK-HUD-H9.1.md; CmpTokens 'Spotlight', GMDesktop, GMTablet, Main, PlayerPhone;
// user answers 2026-11-04 Q7 a, Q8 a, Q11 b). The spotlight disc hangs left of the day disc on every screen. The GM's
// is a button that opens the Party / Adversaries popover: giving it to a PC, taking it for an adversary with 1 Fear
// (Fear −1, once) and handing it back to the whole party each move it at once, and the player's view-only disc and
// GM's-turn card follow live. Escape closes the popover and the focus goes back to the disc. The disc covers neither
// the dock nor the day disc; it sits right 300 (desktop) / right 208 (tablet) and on a phone under the party strip.
// axe on the GM's and the player's views, open and closed.

test.use({ actionTimeout: 30_000 });

const OUT = "test-results/visual/HUD-H9.1";
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
const fearOf = (page: Page) => page.getByTestId("hud-fear-value");

test("the GM moves the spotlight from the disc; the player's disc and HUD follow live", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId, enemies } = s;
  try {
    await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
    await gm.setViewportSize({ width: 1440, height: 900 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await player.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    // At the start nobody is chosen: the whole party has it.
    const disc = gm.getByRole("button", { name: "Spotlight: The party. Change who has it" });
    await expect(disc).toBeVisible({ timeout: 30_000 });
    await expect(disc).toHaveAttribute("aria-expanded", "false");
    await expect(player.getByRole("img", { name: "Spotlight: The party" })).toBeVisible();
    await expect(player.getByRole("button", { name: /^Spotlight:/ })).toHaveCount(0);
    await expect(player.getByTestId("hud-gm-turn")).toHaveCount(0);
    // No old GM spotlight panel, and no SPOTLIGHT pill on the Fear banner (Q11 b).
    await expect(gm.getByTestId("hud-spotlight-menu")).toHaveCount(0);
    await expect(gm.getByTestId("hud-fear")).not.toContainText(/spotlight/i);

    // Keyboard: Enter opens the popover on the Party tab, focus on the tab; Escape closes, focus back on the disc.
    await disc.focus();
    await gm.keyboard.press("Enter");
    const pop = gm.getByRole("dialog", { name: "Spotlight" });
    await expect(pop).toBeVisible();
    await expect(disc).toHaveAttribute("aria-expanded", "true");
    await expect(pop.getByRole("tab", { name: "Party" })).toHaveAttribute("aria-selected", "true");
    await expect(pop.getByRole("tab", { name: "Party" })).toBeFocused();
    await expect(pop.getByRole("button", { name: "The whole party has the spotlight" })).toHaveAttribute("aria-pressed", "true");
    await expect(pop.getByRole("button", { name: "Give the spotlight to Moss" })).toContainText(/Hope \d+ · HP \d+ of \d+ marked/);
    await gm.mouse.move(1, 400);
    await shot(gm, "gm-popover-party-1440");
    await expectNoSeriousA11yViolations(gm);
    await gm.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(disc).toBeFocused();

    // Give it to Moss: the disc, the player's disc and the banner tag (Q11 b) follow.
    await disc.click();
    await pop.getByRole("button", { name: "Give the spotlight to Moss" }).click();
    await expect(pop).toHaveCount(0);
    const mossDisc = gm.getByRole("button", { name: "Spotlight: Moss. Change who has it" });
    await expect(mossDisc).toBeVisible();
    await expect(player.getByRole("img", { name: "Spotlight: Moss" })).toBeVisible();
    await expect(player.getByTestId(`hud-banner-${s.characterId}`)).toContainText("· Spotlight");
    await player.mouse.move(1, 400);
    await shot(player, "player-disc-moss-1440");
    await expectNoSeriousA11yViolations(player);

    // Adversaries tab: 1 Fear interrupts the players for the Lieutenant (Fear 3 → 2, once).
    await mossDisc.click();
    await pop.getByRole("tab", { name: "Adversaries" }).click();
    const how = pop.getByRole("group", { name: "How you take it" });
    await expect(how.getByRole("button", { name: /^Free/ })).toHaveAttribute("aria-pressed", "true");
    await how.getByRole("button", { name: /1 Fear/ }).click();
    await expect(how.getByRole("button", { name: /1 Fear/ })).toHaveAttribute("aria-pressed", "true");
    await gm.mouse.move(1, 400);
    await shot(gm, "gm-popover-adversaries-1440");
    await expectNoSeriousA11yViolations(gm);
    await pop.getByRole("button", { name: `Take the spotlight for ${enemies.lieutenant.name}` }).click();
    await expect(pop).toHaveCount(0);
    await expect(gm.getByRole("button", { name: `Spotlight: ${enemies.lieutenant.name}. Change who has it` })).toBeVisible();
    await expect(fearOf(gm)).toHaveText("2");
    await expect.poll(async () => (await client.query(api.campaigns.fear, { campaignId })) as number).toBe(2);
    // The player saw the Lieutenant this scene: named on the disc; the GM's-turn card and the reactions note show.
    await expect(player.getByRole("img", { name: `Spotlight: ${enemies.lieutenant.name}` })).toBeVisible();
    await expect(player.getByTestId("hud-gm-turn")).toBeVisible();
    await expect(player.getByText("Reactions only until the spotlight comes back to you")).toBeVisible();
    await gm.mouse.move(1, 400);
    await shot(gm, "gm-disc-adversary-1440");
    await shot(player, "player-disc-adversary-1440");

    // It reopens on the Adversaries tab with the Lieutenant marked; moving to another adversary is free.
    await gm.getByRole("button", { name: /^Spotlight: .*Change who has it$/ }).click();
    await expect(pop.getByRole("tab", { name: "Adversaries" })).toHaveAttribute("aria-selected", "true");
    await expect(pop.getByRole("button", { name: `${enemies.lieutenant.name} has the spotlight` })).toHaveAttribute("aria-pressed", "true");
    await pop.getByRole("button", { name: "Close" }).click();
    await expect(pop).toHaveCount(0);

    // Back to the whole party: the player's controls unlock (no GM's-turn card).
    await gm.getByRole("button", { name: /^Spotlight: .*Change who has it$/ }).click();
    await pop.getByRole("tab", { name: "Party" }).click();
    await pop.getByRole("button", { name: "Give the spotlight to the whole party" }).click();
    await expect(gm.getByRole("button", { name: "Spotlight: The party. Change who has it" })).toBeVisible();
    await expect(player.getByRole("img", { name: "Spotlight: The party" })).toBeVisible();
    await expect(player.getByTestId("hud-gm-turn")).toHaveCount(0);
    await expect(fearOf(gm)).toHaveText("2");
  } finally {
    await s.close();
  }
});

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("the disc's place: left of the day disc, clear of the dock, at 1440, 1024 and on a phone", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    for (const [width, height, right] of [
      [1440, 900, 300],
      [1024, 768, 208],
    ] as const) {
      await gm.setViewportSize({ width, height });
      await gm.goto(s.url);
      const disc = gm.getByTestId("hud-spotlight-disc");
      await expect(disc).toBeVisible({ timeout: 30_000 });
      const box = (await disc.boundingBox())!;
      // The board: the disc's right edge `right` px from the HUD's right edge (the disc is the button's widest part or the label).
      const hud = (await gm.getByTestId("combat-hud").boundingBox())!;
      expect(Math.abs(hud.x + hud.width - (box.x + box.width) - right)).toBeLessThan(40);
      expect(box.height).toBeGreaterThanOrEqual(44);
      // Clear of the dock (the GM's only map toolbar, H9.0).
      const dock = (await gm.getByRole("toolbar", { name: "Map controls" }).boundingBox())!;
      expect(intersects(box, dock)).toBe(false);
      // The popover stays on screen and clear of the disc.
      await disc.click();
      const pop = (await gm.getByRole("dialog", { name: "Spotlight" }).boundingBox())!;
      expect(pop.x).toBeGreaterThanOrEqual(0);
      expect(pop.x + pop.width).toBeLessThanOrEqual(width);
      expect(intersects(pop, box)).toBe(false);
      // Tablet: 44 px tabs.
      if (width === 1024) expect((await gm.getByRole("tab", { name: "Party" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await gm.mouse.move(1, 400);
      await shot(gm, `gm-popover-party-${width}`);
      await expectNoSeriousA11yViolations(gm);
      await gm.keyboard.press("Escape");
    }

    // Phone (390 × 844): the player's 44 px disc under the party strip, with the holder's name.
    await s.client.mutation(api.combatSpotlight.handTo, { campaignId: s.campaignId, characterId: s.characterId, idempotencyKey: crypto.randomUUID() });
    await player.setViewportSize({ width: 390, height: 844 });
    await player.goto(s.url);
    const phoneDisc = player.getByRole("img", { name: "Spotlight: Moss" });
    await expect(phoneDisc).toBeVisible({ timeout: 30_000 });
    await expect(phoneDisc).toContainText("Spotlight · Moss");
    const strip = (await player.getByTestId("hud-phone-strip").boundingBox())!;
    const pbox = (await phoneDisc.boundingBox())!;
    expect(pbox.y).toBeGreaterThanOrEqual(strip.y + strip.height - 8);
    await expect(player.getByTestId(`hud-phone-banner-${s.characterId}`)).toHaveAttribute("data-lit", "true");
    await shot(player, "player-phone-390");
    await expectNoSeriousA11yViolations(player);
  } finally {
    await s.close();
  }
});
