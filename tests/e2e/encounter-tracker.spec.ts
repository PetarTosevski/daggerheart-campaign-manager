import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D8 A4: the live encounter tracker on the Adversaries page's Encounters tab. Damage through thresholds (CB p.91),
// Stress, conditions, Spend Fear (the dashboard's GM Fear goes down, CB p.154), spotlights per GM turn (CB p.153) and
// the targeted Attack (AA3b, user answer 2026-10-22: the head's old "Roll attack" / "Roll damage" are gone; the server
// rolls and the player never sees the roll). TR1: thresholds on the cards, the player sheet's heart / diamond pips, the
// dashboard's Fear tokens in the top bar and the 3D dice on the attack roll.

// Headless Chromium only offers software WebGL behind this switch (as in dice-3d.spec.ts).
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

const PLAYER = "e2e-player@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Tracker ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, playerClient: await convexAs(player), close: () => context.close() };
}

/** A running encounter with one Bear (Thresholds 9/17, HP 7, Stress 2), opened on the Encounters tab. */
async function runningBear(page: Page, campaignId: Id<"campaigns">) {
  const client = await convexAs(page);
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Den of the bear", pcs: 4, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.addAdversary, {
    campaignId,
    encounterId,
    source: { kind: "srd", adversaryId: "bear" },
    count: 1,
    summoned: false,
    idempotencyKey: crypto.randomUUID(),
  });
  await page.goto(`/campaigns/${campaignId}/adversaries`);
  await page.getByRole("tab", { name: "Encounters" }).click();
  const panel = page.getByRole("tabpanel", { name: "Encounters" });
  await panel.getByRole("button", { name: "▶ Start encounter" }).click();
  const tracker = panel.getByRole("region", { name: "Encounter tracker" });
  await expect(tracker.getByRole("heading", { name: "Den of the bear" })).toBeVisible();
  return { client, encounterId, tracker };
}

/** The Bear stat block's targeted Attack on one PC (AA3b: the only attack); returns the result region. */
async function attackWithBear(tracker: Locator, target: string) {
  const block = tracker.getByRole("article", { name: "Bear stat block" });
  const actions = block.getByRole("region", { name: "Adversary actions" });
  await actions.getByRole("group", { name: "Targets" }).getByRole("button", { name: target }).click();
  await actions.getByRole("button", { name: new RegExp(`^⚔ Attack ${target} with `) }).click();
  const result = actions.getByRole("region", { name: "Action result" });
  await expect(result.getByTestId("tracker-action-roll")).toHaveText(/^Roll \d+ \(d20 \d+, \+1\)/);
  return { block, result };
}

test("the GM tracks damage, Stress, conditions, Fear, the spotlight and attacks a PC with the targeted Attack", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, playerClient, close } = await playerJoins(page, browser, name);
  const { characterId: miraId } = await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
  const { client, tracker } = await runningBear(page, campaignId);
  await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
  await expect(tracker.getByTestId("tracker-fear")).toHaveAttribute("aria-label", "GM Fear 3 of 12");
  await expect(tracker.getByTestId("tracker-bp")).toHaveText(/Spent 4 of 14 BP/);
  // TR1: 12 Fear tokens of the dashboard's art, 3 lit.
  await expect(tracker.locator(".trk-token")).toHaveCount(12);
  await expect(tracker.locator(".trk-token-on")).toHaveCount(3);

  const card = tracker.getByRole("article", { name: "Bear", exact: true });
  // TR1: the thresholds beside Difficulty; HP hearts and Stress diamonds as on the player sheet.
  await expect(card.getByTestId("thresholds")).toHaveText("Thresholds 9 / 17");
  await expect(card.getByRole("button", { name: "Mark Hit Point 1 of 7" })).toHaveClass(/\bsh-pip\b.*\bheart\b/);
  await expect(card.getByRole("button", { name: "Mark Stress 1 of 2" })).toHaveClass(/\bsh-pip\b.*\bdiamond\b/);
  // 9 damage on Thresholds 9/17 is Major: 2 HP.
  await card.getByLabel("Damage to Bear").fill("9");
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card.getByText("Major: 2 HP marked")).toBeVisible();
  await expect(card.getByRole("button", { name: "Mark Hit Point 2 of 7" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "Mark Hit Point 3 of 7" })).toHaveAttribute("aria-pressed", "false");

  await card.getByRole("button", { name: "Mark Stress 1 of 2" }).click();
  await expect(card.getByRole("button", { name: "Mark Stress 1 of 2" })).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Vulnerable" }).click();
  await expect(card.getByRole("button", { name: /Vulnerable/ })).toHaveAttribute("aria-pressed", "true");

  // Spend 1 Fear for an additional GM move: the tracker and the dashboard show 2.
  await tracker.getByRole("button", { name: "Spend Fear", exact: true }).click();
  const spend = page.getByRole("dialog", { name: "Spend Fear" });
  await spend.getByRole("button", { name: "Additional GM move" }).click();
  await expect(spend).toBeHidden();
  await expect(tracker.getByTestId("tracker-fear")).toHaveAttribute("aria-label", "GM Fear 2 of 12");

  // Spotlight twice (past the limit of 1: a warning, not a block); the second spotlight of the GM turn spends 1 Fear
  // (CB p.153), then End GM turn resets the counter.
  await card.getByRole("button", { name: "Spotlight Bear", exact: true }).click();
  await expect(card.getByTestId("spotlight-count")).toHaveText("Spotlight 1/1");
  // At the limit the Spotlight button turns to the warning colour.
  await expect(card.getByRole("button", { name: /^Spotlight Bear/ })).toHaveAttribute("data-maxed", "true");
  await card.getByRole("button", { name: "Spotlight Bear (spends 1 Fear)" }).click();
  await expect(card.getByTestId("spotlight-count")).toHaveText("Spotlight 2/1");
  await expect(tracker.getByTestId("tracker-fear")).toHaveAttribute("aria-label", "GM Fear 1 of 12");
  // The GM gains a Fear by hand.
  await tracker.getByRole("button", { name: "Gain 1 Fear" }).click();
  await expect(tracker.getByTestId("tracker-fear")).toHaveAttribute("aria-label", "GM Fear 2 of 12");
  await expect(card.getByText("Past the limit for this GM turn")).toBeVisible();
  await tracker.getByRole("button", { name: "End GM turn" }).click();
  await expect(tracker.getByTestId("gm-turn")).toHaveText("GM turn 2");
  await expect(card.getByTestId("spotlight-count")).toHaveText("Spotlight 0/1");

  // AA3b: no untargeted head rolls; the targeted Attack on Mira rolls on the server and shows the GM the roll.
  const head = tracker.getByRole("article", { name: "Bear stat block" });
  await expect(head.getByRole("button", { name: "Roll attack" })).toHaveCount(0);
  await expect(head.getByRole("button", { name: /^Roll damage/ })).toHaveCount(0);
  const { block, result } = await attackWithBear(tracker, "Mira");
  await expect(result.getByRole("list", { name: "Targets" })).toContainText(/Mira\s*(Hit|Miss)/);
  // TR1: the dice land in 3D on the server's d20 (3D is on by default without reduced motion).
  const dice = block.getByTestId("tracker-dice-stage").getByTestId("dice-3d");
  await expect(dice).toBeVisible();
  await expect(dice).toHaveAttribute("data-values", /^\d+$/, { timeout: 10_000 });

  // The player never gets the roll (Q14): not in their roll feed, not in their pending hit.
  await player.goto(`/campaigns/${campaignId}`);
  await expect(player.getByRole("heading", { name: "Roll Feed" })).toBeVisible();
  await expect(player.getByText(/d20 \d+/)).toHaveCount(0);
  for (const hit of await playerClient.query(api.adversaryActions.pending, { campaignId, characterId: miraId })) expect(hit).not.toHaveProperty("roll");
  await close();
});

test("at 390 px the tracker stacks without horizontal scroll and its buttons are 44 px high", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const { tracker } = await runningBear(page, campaignId);
  await expect(tracker.getByRole("article", { name: "Bear stat block" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  for (const control of await tracker.getByRole("button").all()) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("with reduced motion the tracker's attack roll shows no 3D dice", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { campaignId } = await gmCreatesCampaign(page);
  const gm = await convexAs(page);
  await gm.mutation(api.characters.create, { campaignId, draft: bardDraft("Rook"), idempotencyKey: crypto.randomUUID() });
  const { tracker } = await runningBear(page, campaignId);
  const { block } = await attackWithBear(tracker, "Rook");
  await expect(block.getByTestId("dice-3d")).toHaveCount(0);
});
