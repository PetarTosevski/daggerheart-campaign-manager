import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { HUD_MAP_W, hudScene, type HudScene } from "./hud/helpers";

// Bead dcm-bxp.99.32.35 (docs/tasks/TASK-HUD-SPOTLIGHT-LIGHT.md; user 2026-11-02: "When the spotlight is on a token have
// that token illuminated as if a spotlight was shining on it (both players & adversaries)"). The PC who holds the
// spotlight stands in a stage light for the GM and the player; the GM's Spotlight on the Lieutenant's stat block lights
// the Lieutenant instead; handing it back moves the light; the Bandit behind the wall is lit for the GM only (the player
// gets no light, no token, no id); the light follows the token at tablet and phone sizes and with a sheet open (H2.2's
// make-room move); reduced motion stops the breathing. axe on each lit state.

test.use({ actionTimeout: 30_000 });

const OUT = "test-results/visual/HUD-SPOTLIGHT-LIGHT";
const key = () => crypto.randomUUID();
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });

const map = (page: Page) => page.getByRole("region", { name: "Battle map" });
const tokenOf = (page: Page, tokenId: Id<"combatTokens">) => map(page).locator(`[data-testid='combat-token'][data-token='${tokenId}']`);
const poolOf = (page: Page, tokenId: Id<"combatTokens">) => map(page).locator(`[data-testid='hud-spotlight-light'][data-token='${tokenId}']`);
const pools = (page: Page) => map(page).getByTestId("hud-spotlight-light");
const litFaces = (page: Page) => map(page).locator("[data-testid='hud-token-face'][data-lit='true']");

/** Exactly `tokenId` is lit on `page`: its pool under it and the glow on its face, no other light anywhere. */
async function expectLit(page: Page, tokenId: Id<"combatTokens">) {
  await expect(poolOf(page, tokenId)).toHaveCount(1);
  await expect(pools(page)).toHaveCount(1);
  await expect(tokenOf(page, tokenId).locator("[data-testid='hud-token-face'][data-lit='true']")).toHaveCount(1);
  await expect(litFaces(page)).toHaveCount(1);
}

async function expectNothingLit(page: Page) {
  await expect(pools(page)).toHaveCount(0);
  await expect(litFaces(page)).toHaveCount(0);
}

/** The pool is centred on its token (within 2 px), sits under it and never takes the pointer. */
async function expectPoolOnToken(page: Page, tokenId: Id<"combatTokens">) {
  const pool = poolOf(page, tokenId).locator(".hud-spot-pool");
  const token = tokenOf(page, tokenId);
  await expect(pool).toBeVisible();
  const [p, t] = [(await pool.boundingBox())!, (await token.boundingBox())!];
  expect(Math.abs(p.x + p.width / 2 - (t.x + t.width / 2))).toBeLessThan(2);
  expect(Math.abs(p.y + p.height / 2 - (t.y + t.height / 2))).toBeLessThan(2);
  expect(p.width).toBeGreaterThan(t.width * 2);
  const style = await poolOf(page, tokenId).evaluate((el) => ({ pe: getComputedStyle(el).pointerEvents, z: getComputedStyle(el).zIndex }));
  expect(style).toEqual({ pe: "none", z: "1" });
  // A click on the token's centre still reaches the token, not the light.
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid='combat-token']")?.getAttribute("data-token") ?? null, {
    x: t.x + t.width / 2,
    y: t.y + t.height / 2,
  });
  expect(hit).toBe(tokenId);
}

async function open(page: Page, url: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible();
  await expect(map(page).getByTestId("combat-token").first()).toBeVisible({ timeout: 30_000 });
}

async function settle(page: Page) {
  await page.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView());
  await page.mouse.move(1, 400);
  await page.waitForTimeout(600);
}

const handTo = (s: HudScene, characterId: Id<"characters">) => s.client.mutation(api.combatSpotlight.handTo, { campaignId: s.campaignId, characterId, idempotencyKey: key() });

test("the PC holder and the spotlighted adversary are lit for the GM and the player; a hidden one never shows to the player", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
  const { lieutenant, hiddenBandit } = s.enemies;
  try {
    await open(gm, s.url, { width: 1440, height: 900 });
    await open(player, s.url, { width: 1440, height: 900 });

    // Nobody in particular: nothing lit.
    await expectNothingLit(gm);
    await expectNothingLit(player);

    // A PC holds it: Moss is lit for both.
    await handTo(s, moss.characterId);
    await expectLit(gm, moss.tokenId);
    await expectLit(player, moss.tokenId);
    await expectPoolOnToken(gm, moss.tokenId);
    await expectPoolOnToken(player, moss.tokenId);
    await settle(gm);
    await settle(player);
    await expectNoSeriousA11yViolations(gm);
    await expectNoSeriousA11yViolations(player);
    await shot(gm, "gm-pc-lit-1440");
    await shot(player, "player-pc-lit-1440");

    // The GM spotlights the Lieutenant from its stat block: the Lieutenant is lit, Moss is not.
    await tokenOf(gm, lieutenant.tokenId).click();
    const block = gm.getByRole("complementary", { name: `${lieutenant.name}’s stat block` });
    await block.getByTestId("hud-statblock-spotlight").click();
    const confirm = gm.getByTestId("hud-fear-confirm");
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /^Spend/ }).click();
    await expect.poll(async () => (await s.client.query(api.combatSpotlight.state, { campaignId: s.campaignId })).adversaryTokenId).toBe(lieutenant.tokenId);
    await expectLit(gm, lieutenant.tokenId);
    await expectLit(player, lieutenant.tokenId);
    await expect(poolOf(gm, moss.tokenId)).toHaveCount(0);
    await expect(poolOf(player, moss.tokenId)).toHaveCount(0);
    await expectPoolOnToken(gm, lieutenant.tokenId);
    await expectPoolOnToken(player, lieutenant.tokenId);
    await settle(gm);
    await settle(player);
    await expectNoSeriousA11yViolations(gm);
    await expectNoSeriousA11yViolations(player);
    await shot(gm, "gm-adversary-lit-sheet-open-1440");
    await shot(player, "player-adversary-lit-1440");
    await gm.keyboard.press("Escape");

    // The Bandit behind the wall: lit for the GM; the player gets no light, no token and not even its id.
    await s.client.mutation(api.combatSpotlight.gmTake, { campaignId: s.campaignId, tokenId: hiddenBandit.tokenId, idempotencyKey: key() });
    await expectLit(gm, hiddenBandit.tokenId);
    await expect(poolOf(player, lieutenant.tokenId)).toHaveCount(0);
    await expectNothingLit(player);
    await expect(player.locator(`[data-token='${hiddenBandit.tokenId}']`)).toHaveCount(0);
    // User 2026-11-03: never seen this scene, so the player is not even told which adversary it is.
    expect((await s.playerClient.query(api.combatSpotlight.state, { campaignId: s.campaignId })).adversaryTokenId).toBeNull();
    await expect(player.getByTestId("hud-gm-turn-title")).toHaveText("The GM has the spotlight");
    await settle(player);
    await shot(player, "player-hidden-adversary-not-revealed-1440");

    // Handing it back moves the light to the PC; the GM taking it generally lights nothing.
    await handTo(s, brannoc.characterId);
    await expectLit(gm, brannoc.tokenId);
    await expectLit(player, brannoc.tokenId);
    await expect(poolOf(gm, hiddenBandit.tokenId)).toHaveCount(0);
    await s.client.mutation(api.combatSpotlight.gmTake, { campaignId: s.campaignId, idempotencyKey: key() });
    await expectNothingLit(gm);
    await expectNothingLit(player);
  } finally {
    await s.close();
  }
});

test("the light follows its token at tablet and phone sizes and with a sheet open; reduced motion is a static light", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  const { lieutenant } = s.enemies;
  try {
    await handTo(s, moss.characterId);
    await open(gm, s.url, { width: 1440, height: 900 });

    // GM at 1440 with Moss's sheet open (H2.2's make-room move): the pool stays on the token.
    await tokenOf(gm, moss.tokenId).click();
    await expect(gm.getByTestId("combat-hud")).toHaveClass(/hud-sh-open/);
    await gm.waitForTimeout(600);
    await expectPoolOnToken(gm, moss.tokenId);
    await settle(gm);
    await shot(gm, "gm-pc-lit-sheet-open-1440");

    for (const [name, size] of [
      ["1024", { width: 1024, height: 768 }],
      ["390", { width: 390, height: 844 }],
    ] as const) {
      await open(gm, s.url, size);
      await open(player, s.url, size);
      await expectLit(gm, moss.tokenId);
      await expectLit(player, moss.tokenId);
      await tokenOf(player, moss.tokenId).scrollIntoViewIfNeeded();
      await expectPoolOnToken(player, moss.tokenId);
      await settle(player);
      await shot(player, `player-pc-lit-${name}`);
      await settle(gm);
      await shot(gm, `gm-pc-lit-${name}`);
    }

    // The adversary on a phone, for the player.
    await s.client.mutation(api.combatSpotlight.gmTake, { campaignId: s.campaignId, tokenId: lieutenant.tokenId, idempotencyKey: key() });
    await expectLit(player, lieutenant.tokenId);
    await expectNoSeriousA11yViolations(player);
    await settle(player);
    await shot(player, "player-adversary-lit-390");

    // Breathing light by default; a static one under prefers-reduced-motion.
    const pool = poolOf(player, lieutenant.tokenId).locator(".hud-spot-pool");
    expect(await pool.evaluate((el) => getComputedStyle(el).animationName)).toBe("hud-spot-breathe");
    await player.emulateMedia({ reducedMotion: "reduce" });
    expect(await pool.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await poolOf(player, lieutenant.tokenId).evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  } finally {
    await s.close();
  }
});

test("spotlight-seen: a never-seen adversary stays anonymous; one seen this scene, then hidden, is named without a token", async ({ browser }) => {
  // User 2026-11-03 (docs/tasks/TASK-SPOTLIGHT-SEEN.md): players learn which adversary holds the spotlight only when the
  // party saw it this scene; seen then out of sight, the GM's-turn card names it and nothing is drawn or lit.
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  const { lieutenant, hiddenBandit } = s.enemies;
  const playerState = () => s.playerClient.query(api.combatSpotlight.state, { campaignId: s.campaignId });
  const title = player.getByTestId("hud-gm-turn-title");
  const lieutenantSquare = 10 * HUD_MAP_W + 14;
  try {
    await open(gm, s.url, { width: 1440, height: 900 });
    await open(player, s.url, { width: 1440, height: 900 });
    await expect(tokenOf(player, lieutenant.tokenId)).toBeVisible();
    // The player's map records the Lieutenant as seen (its client's markSeen); the Bandit behind the wall never is.
    await expect
      .poll(async () => {
        const view = await s.playerClient.query(api.combatVision.playerView, { campaignId: s.campaignId });
        return view.state === "ok" && view.others.some((o) => o._id === lieutenant.tokenId) && !view.unseenAdversaries.includes(lieutenant.tokenId);
      })
      .toBe(true);

    // Never seen: nothing for the player, not even the id; the card keeps the GM's title.
    await s.client.mutation(api.combatSpotlight.gmTake, { campaignId: s.campaignId, tokenId: hiddenBandit.tokenId, idempotencyKey: key() });
    await expectLit(gm, hiddenBandit.tokenId);
    await expect(title).toHaveText("The GM has the spotlight");
    expect(await playerState()).toMatchObject({ adversaryTokenId: null, adversaryName: null });
    await expectNothingLit(player);

    // Seen, then hidden (the GM's fog over its square): the player learns whose spotlight it is, with no token drawn.
    await s.client.mutation(api.combatVision.paintFog, { campaignId: s.campaignId, mapId: s.mapId, squares: [lieutenantSquare], mark: "hide" });
    await expect(tokenOf(player, lieutenant.tokenId)).toHaveCount(0);
    await s.client.mutation(api.combatSpotlight.gmTake, { campaignId: s.campaignId, tokenId: lieutenant.tokenId, idempotencyKey: key() });
    await expectLit(gm, lieutenant.tokenId);
    await expect(title).toHaveText(`${lieutenant.name} has the spotlight`);
    expect(await playerState()).toMatchObject({ adversaryTokenId: lieutenant.tokenId, adversaryName: lieutenant.name });
    await expectNothingLit(player);
    await expect(player.locator(`[data-token='${lieutenant.tokenId}']`)).toHaveCount(0);
    await settle(player);
    await expectNoSeriousA11yViolations(player);
    await shot(player, "player-seen-hidden-adversary-named-1440");

    // Back in sight: the light shows it, and the card goes back to the GM's title.
    await s.client.mutation(api.combatVision.paintFog, { campaignId: s.campaignId, mapId: s.mapId, squares: [lieutenantSquare], mark: "erase" });
    await expectLit(player, lieutenant.tokenId);
    await expect(title).toHaveText("The GM has the spotlight");
  } finally {
    await s.close();
  }
});
