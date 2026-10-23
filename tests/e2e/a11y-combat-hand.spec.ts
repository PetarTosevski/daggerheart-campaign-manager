// Plan hand-fan HF1 (dcm-bxp.99.30): accessibility and tablet pass for the Combat Map Hand docked along the bottom of
// the map. Bar (D12, docs/tasks/TASK-D12-H1.md): zero serious or critical axe findings in every state of the hand (the
// fan, a raised card, the roll options open, the vault open, a dragged card waiting for its target, hidden with the
// peek tab) as the player (the GM's locked view is scanned in combat-cards.spec.ts); at 768x1024, 1024x768 and 390 px
// no sideways scroll, the map still in view above the hand, and the hand's controls at least 44 px.

import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectFitsViewport, expectNoSeriousA11yViolations, expectTouchTargets, TABLET_VIEWPORTS } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

test.describe.configure({ timeout: 240_000 });
// A stuck action names itself instead of running into the test timeout.
test.use({ actionTimeout: 30_000 });

const PLAYER = "e2e-player@example.test";

/** A level-1 Wizard holding Bolt Beacon (one enemy, rolls) and Book of Illiat (a grimoire). */
const wizardDraft = (name: string) => ({ ...bardDraft(name), classId: "wizard", subclassId: "school-of-war", domainCards: ["bolt-beacon", "book-of-illiat"] });

/** The GM's live map with the player's Ash on it; returns the player's page (signed in, joined) and the map URL. */
async function handScene(page: Page, browser: Browser) {
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const player = await context.newPage();
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const playerClient = await convexAs(player);
  await playerClient.mutation(api.members.joinByCode, { code });
  const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft: wizardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === characterId)!._id, x: 5, y: 10 });
  return { player, url, campaignId: campaignId as Id<"campaigns">, closePlayer: () => context.close() };
}

/** The hand leaves part of the map in view: its top edge is below the viewport's top edge. */
async function expectMapAboveHand(page: Page) {
  const viewport = (await page.getByTestId("combat-viewport").boundingBox())!;
  const tray = (await page.locator(".cmh-tray").boundingBox())!;
  expect(tray.y - viewport.y, "map height left above the hand").toBeGreaterThan(viewport.height * 0.35);
}

test("the docked hand passes axe in every state, fits tablets and phones, and keeps 44 px controls", async ({ page, browser }) => {
  const s = await handScene(page, browser);
  const { player } = s;
  try {
    await player.goto(s.url);
    const hand = player.getByRole("region", { name: "Your hand" });
    const bolt = hand.getByRole("article", { name: "Bolt Beacon" });
    await expect(bolt).toBeVisible({ timeout: 30_000 });

    // The fan, then a raised card (focus on its Use), the roll options and the vault open.
    await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });
    const useBolt = bolt.getByRole("button", { name: "Use Bolt Beacon" });
    await useBolt.focus();
    await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });
    await useBolt.blur();
    const options = hand.getByTestId("combat-hand-roll-options");
    await options.getByText("Roll options").click();
    await expect(options.getByRole("group", { name: "Advantage" })).toBeVisible();
    await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });
    await options.getByText("Roll options").click();
    await hand.getByRole("button", { name: "Open vault, 0 cards" }).click();
    await expect(hand.getByRole("region", { name: "Vault (0)" })).toContainText("The vault is empty.");
    await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });
    await hand.getByRole("button", { name: "Close vault, 0 cards" }).click();

    // A dragged card waiting for its target on the map.
    await bolt.dragTo(player.getByTestId("combat-viewport"), { sourcePosition: { x: 50, y: 16 }, targetPosition: { x: 40, y: 40 }, force: true });
    await expect(hand.getByTestId("combat-hand-aim")).toContainText("tap an enemy on the map");
    await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });
    await hand.getByRole("button", { name: "Cancel" }).click();
    await expect(hand.getByTestId("combat-hand-aim")).toHaveCount(0);

    // Hidden: the peek tab.
    await hand.getByRole("button", { name: "Hide cards" }).click();
    const show = hand.getByRole("button", { name: "Show cards (2)" });
    await expect(show).toBeVisible();
    await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });

    // Tablets and a phone: no sideways scroll, the map stays in view above the hand, 44 px controls; hidden and shown.
    for (const viewport of [...TABLET_VIEWPORTS, { width: 390, height: 844 }]) {
      await player.setViewportSize(viewport);
      await expectFitsViewport(player);
      await expectTouchTargets(show);
      await show.click();
      await expect(hand.getByRole("button", { name: "Hide cards" })).toBeVisible();
      await expectFitsViewport(player);
      await expectMapAboveHand(player);
      await expectTouchTargets(hand.locator(".cmh-bar button, .cmh-bar summary"));
      await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });
      await hand.getByRole("button", { name: "Hide cards" }).click();
    }
  } finally {
    await s.closePlayer();
  }
});
