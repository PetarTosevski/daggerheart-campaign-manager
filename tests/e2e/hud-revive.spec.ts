import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Bead dcm-6c2o (user 2026-11-04): "Give the GM the option to revive a dead adversary: a Revive button on hover that
// brings back the popup to set the creature's HP / Stress". The GM hovers a defeated adversary's token (or focuses it)
// and a Revive pill shows; it opens the box at full health (0 HP, 0 Stress marked); Revive brings the token back (no
// longer greyed) and the spotlight row is takeable again. The same from the spotlight popover's greyed "Defeated" row.
// Players never see Revive. axe on the box.

test.use({ actionTimeout: 30_000 });

const OUT = "test-results/visual/revive";
const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
};

test("the GM revives a defeated adversary from its token and from the spotlight popover", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId, mapId, enemies } = s;
  const key = () => crypto.randomUUID();
  const tokens = () => client.query(api.combatTokensReads.list, { campaignId, mapId });
  const instanceOf = async (tokenId: string) => (await tokens()).find((t) => t._id === tokenId)!.instanceId!;
  try {
    // The Lieutenant and a Bandit fall: every HP marked.
    for (const e of [enemies.lieutenant, enemies.bandit]) {
      await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: await instanceOf(e.tokenId), delta: 30, idempotencyKey: key() });
    }
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });

    // ---- From the token: hidden until hovered, then the pill above the token opens the box.
    const ltToken = gm.locator(`button[data-token='${enemies.lieutenant.tokenId}']`);
    await expect(ltToken.getByTestId("hud-token-face")).toHaveClass(/tk-down/);
    const ltPill = gm.getByRole("button", { name: `Revive ${enemies.lieutenant.name}` });
    await expect(ltPill).toHaveCSS("opacity", "0");
    await ltToken.hover();
    await expect(ltPill).toHaveCSS("opacity", "1");
    await shot(gm, "hover-token-revive");
    // The pointer glides up from the token onto the pill (as a hand does): the hover holds and the click lands on it.
    const tokenBox = (await ltToken.boundingBox())!;
    const pillBox = (await ltPill.boundingBox())!;
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(tokenBox.y + 6);
    await gm.mouse.move(tokenBox.x + tokenBox.width / 2, tokenBox.y + tokenBox.height / 2);
    await gm.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2, { steps: 12 });
    await expect(ltPill).toHaveCSS("opacity", "1");
    await gm.mouse.down();
    await gm.mouse.up();

    const box = gm.getByRole("dialog", { name: `Revive ${enemies.lieutenant.name}?` });
    await expect(box).toBeVisible();
    await expect(box.getByLabel(/^0 of \d+ Hit Points marked$/)).toBeVisible();
    await expect(box.getByLabel(/^0 of \d+ Stress marked$/)).toBeVisible();
    await expect(box.getByTestId("hud-revive-line")).toHaveText("Full health: no HP or Stress marked.");
    await gm.mouse.move(1, 400);
    await shot(gm, "revive-box");
    await expectNoSeriousA11yViolations(gm);
    await box.getByRole("button", { name: "Revive", exact: true }).click();
    await expect(box).toHaveCount(0);

    // The token comes back (no grey, no pill) and its spotlight row is takeable.
    await expect(ltToken.getByTestId("hud-token-face")).not.toHaveClass(/tk-down/);
    await expect(ltPill).toHaveCount(0);
    const statsOf = async (tokenId: string) => (await tokens()).find((t) => t._id === tokenId)!.stats;
    await expect.poll(() => statsOf(enemies.lieutenant.tokenId)).toMatchObject({ hp: 0, stress: 0, down: false });
    const disc = gm.getByRole("button", { name: /^Spotlight: .*Change who has it$/ });
    await disc.click();
    const pop = gm.getByRole("dialog", { name: "Spotlight" });
    await pop.getByRole("tab", { name: "Adversaries" }).click();
    await expect(pop.getByRole("button", { name: `Take the spotlight for ${enemies.lieutenant.name}` })).not.toHaveAttribute("aria-disabled", "true");

    // ---- From the spotlight popover: the Bandit's greyed "Defeated" row shows Revive on hover.
    const deadRow = pop.getByRole("button", { name: `${enemies.bandit.name}, defeated: can't take the spotlight` });
    const rowPill = pop.getByRole("button", { name: `Revive ${enemies.bandit.name}`, exact: true });
    await expect(rowPill).toHaveCSS("opacity", "0");
    await deadRow.hover();
    await expect(rowPill).toHaveCSS("opacity", "1");
    await shot(gm, "hover-spotlight-row-revive");
    await rowPill.click();
    await expect(pop).toHaveCount(0);
    const box2 = gm.getByRole("dialog", { name: `Revive ${enemies.bandit.name}?`, exact: true });
    await expect(box2).toBeVisible();
    // The GM leaves one HP marked before reviving.
    await box2.getByRole("button", { name: "Mark 1 Hit Point" }).click();
    await expect(box2.getByTestId("hud-revive-line")).toHaveText(/^1 of \d+ HP marked/);
    await box2.getByRole("button", { name: "Revive", exact: true }).click();
    await expect(box2).toHaveCount(0);
    await expect(gm.locator(`button[data-token='${enemies.bandit.tokenId}']`).getByTestId("hud-token-face")).not.toHaveClass(/tk-down/);
    await disc.click();
    await gm.getByRole("dialog", { name: "Spotlight" }).getByRole("tab", { name: "Adversaries" }).click();
    const take = gm.getByRole("dialog", { name: "Spotlight" }).getByRole("button", { name: `Take the spotlight for ${enemies.bandit.name}`, exact: true });
    await take.click();
    await expect(gm.getByRole("button", { name: `Spotlight: ${enemies.bandit.name}. Change who has it` })).toBeVisible();
    await expect.poll(() => statsOf(enemies.bandit.tokenId)).toMatchObject({ hp: 1, down: false });

    // Players never see Revive.
    await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: await instanceOf(enemies.bandit.tokenId), delta: 30, idempotencyKey: key() });
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
    await expect(player.getByTestId("hud-revive")).toHaveCount(0);
  } finally {
    await s.close();
  }
});
