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

// User 2026-11-04: "If an adversary has a picture please use it on the spotlight icon as well", and the disc names the
// holder in full, as its token's name tag reads it (no "VOLCANIC DRAGO…"): wrapped within the disc on desktop and phone.
// The portrait follows the name: a player sees it only for an adversary the party saw; "The GM" shows none.
const SPOT_OUT = "test-results/visual/spot-portrait";
const spotShot = (page: Page, name: string) => page.screenshot({ path: `${SPOT_OUT}/${name}.png`, animations: "disabled" });

test("an adversary's portrait and full name on the disc, the popover rows and the phone disc", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId, mapId, encounterId, enemies } = s;
  const key = () => crypto.randomUUID();
  try {
    // The Volcanic Dragon: Ashen Tyrant (rulebook art) joins the encounter, in Moss's view.
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "volcanic-dragon-ashen-tyrant" },
      count: 1,
      summoned: false,
      idempotencyKey: key(),
    });
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: key() });
    const dragon = (await client.query(api.combatTokensReads.list, { campaignId, mapId })).find((t) => t.instanceId === instanceIds[0])!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: dragon._id, x: 11, y: 7 });
    expect(dragon.name).toBe("Volcanic Dragon: Ashen Tyrant");
    await client.mutation(api.combatSpotlight.gmTake, { campaignId, tokenId: dragon._id, idempotencyKey: key() });

    // GM, 1440: the disc shows the dragon's art and its full name, the same string as its token's name tag.
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    const disc = gm.getByRole("button", { name: `Spotlight: ${dragon.name}. Change who has it` });
    await expect(disc).toBeVisible({ timeout: 30_000 });
    await expect(disc.getByTestId("hud-spotlight-art")).toHaveAttribute("src", /volcanic-dragon-ashen-tyrant/);
    const tokenName = gm.locator(`[data-token='${dragon._id}'] .tk-name`);
    const name = disc.getByTestId("hud-spotlight-name");
    await expect(name).toHaveText((await tokenName.textContent())!);
    // No ellipsis: it wraps to two lines within the disc.
    expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== "ellipsis")).toBe(true);
    const nameBox = (await name.boundingBox())!;
    const discBox = (await disc.boundingBox())!;
    expect(nameBox.height).toBeGreaterThan(20);
    expect(nameBox.height).toBeLessThan(40);
    expect(nameBox.x).toBeGreaterThanOrEqual(discBox.x - 1);
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(discBox.x + discBox.width + 1);
    await gm.mouse.move(1, 400);
    await spotShot(gm, "after-gm-disc-dragon-1440");

    // The Adversaries rows show each token's art. A defeated adversary (every HP marked) sits last, disabled, "Defeated"
    // and no Take (user 2026-11-04), and the server refuses it (ADVERSARY_DEFEATED, tests/convex/spotlight-v2.test.ts).
    const lt = (await client.query(api.combatTokensReads.list, { campaignId, mapId })).find((t) => t._id === enemies.lieutenant.tokenId)!;
    await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: lt.instanceId!, delta: 30, idempotencyKey: key() });
    await disc.click();
    const pop = gm.getByRole("dialog", { name: "Spotlight" });
    const row = pop.getByRole("button", { name: `${dragon.name} has the spotlight` });
    await expect(row.getByTestId("hud-spotlight-art")).toHaveAttribute("src", /volcanic-dragon-ashen-tyrant/);
    await expect(row.locator(".hud-spr-t b")).toHaveText(dragon.name);
    const dead = pop.getByRole("button", { name: `${enemies.lieutenant.name}, defeated: can't take the spotlight` });
    await expect(dead).toHaveAttribute("aria-disabled", "true");
    await expect(dead).toContainText("Defeated");
    await expect(dead).not.toContainText("Take");
    await expect(dead.getByTestId("hud-spotlight-art")).toHaveAttribute("src", /jagged-knife-lieutenant/);
    const order = await pop.locator(".hud-spr").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(order.at(-1)).toBe(`${enemies.lieutenant.name}, defeated: can't take the spotlight`);
    await expect(dead).toBeDisabled();
    // Forced, the click does nothing: the popover stays and the dragon keeps it.
    await dead.click({ force: true });
    await expect(pop).toBeVisible();
    await expect(gm.getByRole("button", { name: `Spotlight: ${dragon.name}. Change who has it` })).toBeVisible();
    await gm.mouse.move(1, 400);
    await spotShot(gm, "after-gm-popover-adversaries-1440");
    await expectNoSeriousA11yViolations(gm);
    await gm.keyboard.press("Escape");

    // The player saw the dragon: its name and art on their disc.
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    const playerDisc = player.getByRole("img", { name: `Spotlight: ${dragon.name}` });
    await expect(playerDisc).toBeVisible({ timeout: 30_000 });
    await expect(playerDisc.getByTestId("hud-spotlight-art")).toHaveAttribute("src", /volcanic-dragon-ashen-tyrant/);
    await expect(playerDisc.getByTestId("hud-spotlight-name")).toHaveText((await player.locator(`[data-token='${dragon._id}'] .tk-name`).textContent())!);
    await player.mouse.move(1, 400);
    await spotShot(player, "after-player-disc-dragon-1440");

    // Never seen (the Bandit behind the wall): "The GM", and no portrait.
    await client.mutation(api.combatSpotlight.gmTake, { campaignId, tokenId: enemies.hiddenBandit.tokenId, idempotencyKey: key() });
    const gmDisc = player.getByRole("img", { name: "Spotlight: The GM" });
    await expect(gmDisc).toBeVisible();
    await expect(gmDisc.locator(".hud-spf-en img, [data-testid=hud-spotlight-art]")).toHaveCount(0);
    await spotShot(player, "after-player-disc-unseen-1440");

    // Phone: the dragon's art and its full name, wrapped (at most three lines) on screen.
    await client.mutation(api.combatSpotlight.gmTake, { campaignId, tokenId: dragon._id, idempotencyKey: key() });
    await player.setViewportSize({ width: 390, height: 844 });
    await player.goto(s.url);
    const phone = player.getByRole("img", { name: `Spotlight: ${dragon.name}` });
    await expect(phone).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByTestId("hud-spotlight-art")).toHaveAttribute("src", /volcanic-dragon-ashen-tyrant/);
    const pill = phone.locator(".hud-ms-l");
    await expect(pill).toHaveText(`Spotlight · ${dragon.name}`);
    const pillBox = (await pill.boundingBox())!;
    expect(pillBox.x).toBeGreaterThanOrEqual(0);
    expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(390);
    expect(pillBox.height).toBeLessThan(48);
    await spotShot(player, "after-player-phone-dragon-390");
    await expectNoSeriousA11yViolations(player);
    await client.mutation(api.combatSpotlight.gmTake, { campaignId, tokenId: enemies.hiddenBandit.tokenId, idempotencyKey: key() });
    await expect(player.getByRole("img", { name: "Spotlight: The GM" }).locator(".hud-spf-en img, [data-testid=hud-spotlight-art]")).toHaveCount(0);
  } finally {
    await s.close();
  }
});
