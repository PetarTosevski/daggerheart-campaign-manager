import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "../a11y";
import { gmAndPlayer } from "../live";
import { combatMapUrl } from "../hud/helpers";

// Shots for docs/tasks/TASK-GLASS-G11.md (E2E_VISUAL=1): the Combat Map's play-side parts outside the HUD's own files
// use glass buttons (plan .omc/plans/glass-buttons.yaml, G11):
// - the reaction prompt on the character sheet (Mark = confirm, Don't = cancel), for the player and the GM;
// - the HUD sheet's classic Charge flow: the player's waiting Charge (✕ = round cancel, Roll Agility = confirm) and
//   the GM's Difficulty request (Roll = allow, Decline = deny, the same colours for every viewer);
// - the Encounter tab's End scene confirmation (Cancel = cancel, End scene = danger).
// At 1440 x 900, 1024 x 768 and 390 x 844; a hovered button and a keyboard-focused one pass axe; every glass button
// is at least 44 px on touch widths.

const OUT = "test-results/visual/GLASS-G11";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** A Bandit that always hits (ATK +20) for 11-14 physical damage (as incoming-hit.spec). */
const BRUTE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 20, name: "Club", range: "Melee", damage: "1d4+10 phy" },
  experiences: [],
  features: [],
};

async function shoot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage });
}

async function expectRole(button: Locator, role: string) {
  await expect(button).toHaveClass(new RegExp(`\\bgb-${role}\\b`));
}

/** On tablet and phone widths, every visible glass button inside `scope` is at least 44 px tall (and wide). */
async function expectTouchTargets(scope: Locator) {
  const small = await scope.locator(".gb").evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", ...el.getBoundingClientRect().toJSON() }))
      .filter((r: { width: number; height: number }) => r.height < 43.5 || r.width < 43.5),
  );
  expect(small).toEqual([]);
}

/** Keyboard focus on `locator` (Tab into it, so :focus-visible applies). */
async function keyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(locator).toBeFocused();
  await page.waitForTimeout(400);
}

/** A running encounter with `adversary` (custom); returns its id and the instance id. */
async function encounterWith(gm: ConvexHttpClient, campaignId: Id<"campaigns">, adversary: typeof BRUTE_BANDIT) {
  const { customId } = await gm.mutation(api.customAdversaries.create, { campaignId, adversary, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  return { encounterId, instanceId: instanceIds[0]! };
}

test("GLASS-G11 the reaction prompt on the sheet and the End scene confirmation", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, client, characterId, characterName } = table;
  try {
    const { encounterId, instanceId } = await encounterWith(client, campaignId, BRUTE_BANDIT);
    let res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [characterId], idempotencyKey: crypto.randomUUID() });
    if (res.status === "confirmFear") res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [characterId], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
    expect(res.status).toBe("resolved");

    const sheetUrl = `/campaigns/${campaignId}/party/${characterId}`;
    for (const [who, page] of [
      ["player", player],
      ["gm", gm],
    ] as const) {
      await page.goto(sheetUrl);
      const prompt = page.getByRole("region", { name: `Incoming hit: Bandit hit ${characterName}` });
      await expect(prompt).toBeVisible({ timeout: 30_000 });
      const mark = prompt.getByRole("button", { name: "Mark", exact: true });
      const dont = prompt.getByRole("button", { name: "Don't", exact: true });
      await expectRole(mark, "confirm");
      await expectRole(dont, "cancel");
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await prompt.scrollIntoViewIfNeeded();
        await shoot(page, `hit-${who}-${viewport.width}`);
        if (viewport.width < 1440) await expectTouchTargets(prompt);
      }
      await page.setViewportSize(VIEWPORTS[0]);
      await prompt.scrollIntoViewIfNeeded();
      await mark.hover();
      await shoot(page, `hit-${who}-hover-mark`);
      await expectNoSeriousA11yViolations(page, { include: "[data-testid=incoming-hit]" });
      await keyboardFocus(page, dont);
      await shoot(page, `hit-${who}-focus-dont`);
      await expectNoSeriousA11yViolations(page, { include: "[data-testid=incoming-hit]" });
    }

    // The Encounter tab's End scene: the top bar's button (G9's class) opens the confirmation (G11's buttons).
    await gm.goto(`/campaigns/${campaignId}/adversaries?encounter=${encounterId}`);
    await gm.getByRole("tab", { name: "Encounters" }).click();
    const opener = gm.getByRole("button", { name: "End scene", exact: true }).first();
    await expect(opener).toBeVisible({ timeout: 30_000 });
    await opener.click();
    const confirm = gm.getByRole("dialog", { name: "End the scene?" });
    await expect(confirm).toBeVisible();
    await expectRole(confirm.getByRole("button", { name: "Cancel" }), "cancel");
    await expectRole(confirm.getByRole("button", { name: "End scene" }), "danger");
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await shoot(gm, `end-scene-gm-${viewport.width}`);
      if (viewport.width < 1440) await expectTouchTargets(confirm);
    }
    await gm.setViewportSize(VIEWPORTS[0]);
    await confirm.getByRole("button", { name: "End scene" }).hover();
    await shoot(gm, "end-scene-gm-hover-end");
    await expectNoSeriousA11yViolations(gm, { include: "dialog[open]" });
    await keyboardFocus(gm, confirm.getByRole("button", { name: "Cancel" }));
    await shoot(gm, "end-scene-gm-focus-cancel");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
  } finally {
    await table.close();
  }
});

test("GLASS-G11 the HUD sheet's Charge: the player's waiting roll and the GM's Difficulty request", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  // A Firbolg (Charge, CB p.59) owned by the player.
  const table = await gmAndPlayer(browser, { draft: { ancestry: { kind: "single", id: "firbolg" } } });
  const { gm, player, campaignId, client, playerClient, characterId, characterName } = table;
  try {
    const { instanceId } = await encounterWith(client, campaignId, { ...BRUTE_BANDIT, attack: { ...BRUTE_BANDIT.attack, modifier: 1 } });
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
    const tokens = await client.query(api.combatTokensReads.list, { campaignId, mapId });
    const pc = tokens.find((t) => t.characterId === characterId)!;
    const bandit = tokens.find((t) => t.instanceId === instanceId)!;
    // Ten squares apart: Far range (CB p.103), facing each other.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: pc._id, x: 4, y: 10 });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId: pc._id, angle: 0 });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: bandit._id, x: 14, y: 10 });

    // The player's Charge goes to the GM, who sets the Difficulty (plan lanes B2).
    const options = await playerClient.query(api.featurePrompts.chargeOptions, { campaignId, characterId, mapId });
    const target = options.find((o) => o.tokenId === bandit._id);
    expect(target, "the Bandit is a Charge target").toBeTruthy();
    const out = await playerClient.mutation(api.featurePrompts.charge, {
      campaignId,
      idempotencyKey: crypto.randomUUID(),
      characterId,
      mapId,
      targetTokenId: bandit._id,
      square: { x: target!.squares[0]!.x, y: target!.squares[0]!.y },
      stress: true,
      roll: {},
    });
    expect(out.status).toBe("requested");

    const url = combatMapUrl(campaignId);
    const banner = (page: Page) => page.getByRole("list", { name: "The party" }).getByRole("button", { name: `Open ${characterName}'s sheet` });
    const sheet = (page: Page) => page.getByRole("complementary", { name: `${characterName}’s sheet` });

    // The player: own sheet → Use Charge → the classic flow, waiting for the GM.
    await player.setViewportSize(VIEWPORTS[0]);
    await player.goto(url);
    await expect(player.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
    await banner(player).click();
    await sheet(player).getByRole("button", { name: "Use Charge" }).click();
    const flow = sheet(player).getByTestId("sheet-drawer-use");
    await expect(flow.getByTestId("charge-waiting")).toBeVisible({ timeout: 30_000 });
    const close = flow.getByRole("button", { name: "Close Charge" });
    await expectRole(close, "cancel");
    await expectRole(flow.getByRole("button", { name: "Roll Agility and charge" }), "confirm");
    await flow.scrollIntoViewIfNeeded();
    await shoot(player, "charge-player-1440");
    await keyboardFocus(player, close);
    await shoot(player, "charge-player-focus-close");
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=sheet-drawer-use]" });

    // The GM: the sheet, Play for this character, Use Charge → the Difficulty request with Roll (allow) / Decline (deny).
    await gm.setViewportSize(VIEWPORTS[0]);
    await gm.goto(url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
    await banner(gm).click();
    await sheet(gm).getByRole("switch", { name: "Play for this character" }).click();
    await sheet(gm).getByRole("button", { name: new RegExp(`^Use Charge for ${characterName}$`) }).click();
    const request = sheet(gm).getByTestId("difficulty-request");
    await expect(request).toBeVisible({ timeout: 30_000 });
    const roll = request.getByRole("button", { name: /^Roll: / });
    const decline = request.getByRole("button", { name: /^Decline: / });
    await expectRole(roll, "allow");
    await expectRole(decline, "deny");
    await request.getByRole("spinbutton").fill("12");
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await request.scrollIntoViewIfNeeded();
      await shoot(gm, `difficulty-gm-${viewport.width}`);
      if (viewport.width < 1440) await expectTouchTargets(sheet(gm).getByTestId("sheet-drawer-use"));
    }
    await gm.setViewportSize(VIEWPORTS[0]);
    await request.scrollIntoViewIfNeeded();
    await roll.hover();
    await shoot(gm, "difficulty-gm-hover-roll");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=sheet-drawer-use]" });
    await decline.hover();
    await shoot(gm, "difficulty-gm-hover-decline");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=sheet-drawer-use]" });
    await keyboardFocus(gm, decline);
    await shoot(gm, "difficulty-gm-focus-decline");

    // Decline: the row goes, the result line says so.
    await decline.click();
    await expect(sheet(gm).getByTestId("difficulty-requests")).toContainText("Declined.");
  } finally {
    await table.close();
  }
});
