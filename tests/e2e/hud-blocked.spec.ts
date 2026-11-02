import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H6.2 (docs/tasks/TASK-HUD-H6.2.md): H6.1's blocked states on the player surfaces (boards CmpBlocked,
// Main 'Can't afford', CmpCards). Can't afford at 1440x900: the card tag names the shortfall, Use stays focusable and a
// press shows the toast near the hand, the ring's Evolution is locked with its reason. While the GM holds the spotlight
// every non-reaction control waits with the SPOTLIGHT_WITH_GM reason and the hit window stays usable (answer 1c). At the
// click: a token move through a wall is refused in the table's words and the token snaps back. axe on each state.

test.use({ actionTimeout: 30_000 });

const OUT = "test-results/visual/HUD-H6.2";
/** Moss as a Druid with Wall Walk (Arcana, "Spend a Hope") in the loadout, as on the board. */
const MOSS = { classId: "druid", domainCards: ["vicious-entangle", "wall-walk"] };

async function setHope(s: HudScene, characterId: Id<"characters">, hope: number) {
  const sheet = await s.client.query(api.combatHud.sheet, { characterId });
  const delta = hope - sheet.trackers.hope.value;
  if (delta !== 0) await s.client.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta });
}

const fanCard = (page: Page, name: string) => page.getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name }) });
const notices = (page: Page) => page.getByRole("status", { name: "Notices" });
const ringOf = (page: Page) => page.getByRole("toolbar", { name: "Your actions (Moss)" });
const mossToken = (page: Page) => page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Open Moss’s sheet \(your character\)/ });

test("Main 'Can't afford' at 1440x900: card tag, toast on a press, ring lock", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser, { moss: MOSS });
  const { player } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await setHope(s, moss.characterId, 0);
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    // Card tag: the shortfall before the click; Use is aria-disabled with the reason as its description.
    const wall = fanCard(player, "Wall Walk");
    await expect(wall).toContainText("Needs 1 Hope");
    await expect(wall).toHaveAttribute("data-wash", "afford");
    const use = wall.getByRole("button", { name: "Use Wall Walk" });
    await expect(use).toHaveAttribute("aria-disabled", "true");
    await expect(use).toHaveAccessibleDescription("Needs 1 Hope · you have 0");

    // A press anyway: the refusal as the toast near the hand (layer 3), nothing sent.
    await wall.hover();
    // aria-disabled stays focusable and pressable (Playwright counts it as not enabled): press it from the keyboard.
    await use.focus();
    await use.press("Enter");
    const toast = notices(player).getByRole("listitem").filter({ hasText: "Not enough Hope" });
    await expect(toast).toContainText("Wall Walk costs 1 Hope. You have 0.");
    await expect(toast).toContainText("Roll with Hope, or rest, to gain Hope.");
    await expect(player.getByTestId("hud-pick")).toHaveCount(0);

    // Ring lock: Evolution (3 Hope) locked with the board's reason.
    await mossToken(player).click();
    const ring = ringOf(player);
    await expect.poll(() => ring.getByTestId("hud-ar-button").count(), { timeout: 30_000 }).toBeGreaterThan(3);
    let evolution = ring.getByTestId("hud-ar-button").and(player.getByRole("button", { name: "Use Evolution", exact: true }));
    if ((await evolution.count()) === 0) {
      await ring.getByRole("button", { name: /^More actions/ }).click();
      evolution = ring.getByRole("group", { name: "More actions" }).getByRole("button", { name: "Use Evolution", exact: true });
    }
    await expect(evolution).toHaveAttribute("aria-disabled", "true");
    await expect(evolution).toHaveAccessibleDescription("Evolution needs 3 Hope. You have 0.");
    await evolution.hover();
    await expectNoSeriousA11yViolations(player);
    await player.screenshot({ path: `${OUT}/cant-afford-1440.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
});

/** A Bandit that always hits (ATK +20) for 11-14 physical damage (as tests/e2e/hud-hit.spec.ts). */
const BRUTE = {
  name: "Brute",
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

async function bruteHitsMoss(s: HudScene, mossId: Id<"characters">) {
  const { client, campaignId } = s;
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId: s.encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  const instanceId = instanceIds[0]!;
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId: s.mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
  const token = (await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId })).find((t) => t.instanceId === instanceId)!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 6, y: 10 });
  let res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [mossId], idempotencyKey: crypto.randomUUID() });
  if (res.status === "confirmFear") res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [mossId], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
  if (res.status !== "resolved") throw new Error(`attack not resolved: ${res.status}`);
}

test("while the GM holds the spotlight: cards, the ring and token moves wait with the reason; the hit window stays usable", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser, { moss: MOSS });
  const { player, client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await setHope(s, moss.characterId, 3);
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    const use = fanCard(player, "Wall Walk").getByRole("button", { name: "Use Wall Walk" });
    await expect(use).not.toHaveAttribute("aria-disabled");

    await client.mutation(api.combatSpotlight.gmTake, { campaignId, idempotencyKey: crypto.randomUUID() });
    await expect(player.getByTestId("hud-gm-turn")).toBeVisible();

    // The hand: Use waits with the SPOTLIGHT_WITH_GM reason; a press says why.
    await expect(use).toHaveAttribute("aria-disabled", "true");
    await expect(use).toHaveAccessibleDescription("The GM has the spotlight · reactions only");
    await fanCard(player, "Wall Walk").hover();
    // aria-disabled stays focusable and pressable (Playwright counts it as not enabled): press it from the keyboard.
    await use.focus();
    await use.press("Enter");
    await expect(notices(player).getByRole("listitem").filter({ hasText: "The GM has the spotlight" })).toContainText("You can use reactions until it comes back.");
    await expect(player.getByTestId("hud-pick")).toHaveCount(0);

    // The ring: Attack, Cast and every feature wait; Sheet still opens.
    await mossToken(player).click();
    const ring = ringOf(player);
    const attack = ring.getByRole("button", { name: "Attack", exact: true });
    await expect(attack).toHaveAttribute("aria-disabled", "true");
    await expect(attack).toHaveAccessibleDescription("The GM has the spotlight · reactions only");
    await expect(ring.getByRole("button", { name: "Cast", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(ring.getByRole("button", { name: "Sheet", exact: true })).not.toHaveAttribute("aria-disabled");
    await attack.click({ force: true });
    await expect(ring.getByTestId("hud-ar-tip")).toHaveText("The GM has the spotlight · reactions only");
    await expect(player.getByTestId("hud-pick")).toHaveCount(0);
    await expectNoSeriousA11yViolations(player);
    await player.screenshot({ path: `${OUT}/spotlight-with-gm-1440.png`, animations: "disabled" });
    await player.keyboard.press("Escape");

    // A token move waits too (user answer 2026-11-01): the key move is refused before it is sent.
    const before = (await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId })).find((t) => t._id === moss.tokenId)!;
    await mossToken(player).focus();
    await player.keyboard.press("ArrowUp");
    await expect(notices(player).getByRole("listitem").filter({ hasText: "The GM has the spotlight" })).toBeVisible();
    const after = (await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId })).find((t) => t._id === moss.tokenId)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });

    // Reactions stay: the hit window opens and its answers are enabled.
    await bruteHitsMoss(s, moss.characterId);
    const win = player.getByRole("dialog", { name: "You were hit" });
    await expect(win).toBeVisible({ timeout: 30_000 });
    const take = win.getByRole("button", { name: /^Take \d HP$/ });
    await expect(take).toBeEnabled();
    await expect(take).not.toHaveAttribute("aria-disabled");
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-hit-window]" });
  } finally {
    await s.close();
  }
});

test("at the click: a token move through a wall is refused in the table's words and the token snaps back", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    // Moss right next to the wall (x = 18, y = 2..8).
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: moss.tokenId, x: 17, y: 5 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await mossToken(player).focus();
    await player.keyboard.press("ArrowRight");
    const notice = player.getByTestId("combat-move-notice");
    await expect(notice).toHaveText("Something blocks the way.");
    await expect(notice).toHaveAttribute("data-kind", "blocked");
    const now = (await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId })).find((t) => t._id === moss.tokenId)!;
    expect({ x: now.x, y: now.y }).toEqual({ x: 17, y: 5 });
    await expectNoSeriousA11yViolations(player);
  } finally {
    await s.close();
  }
});
