import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-actions CA6 / hand-fan HF1, ported to the Combat HUD by plan combat-hud H8.1 (the classic Hand card, its
// docked fan, drag-to-table and the card dialog are gone): what no HUD spec covers yet.
// 1. The GM plays a card for a PC: "Play for this character" on Moss's HUD sheet unlocks Moss's hand; Use opens the
//    picking panel, the picked creature gets its ring on the map, "Cast on …" resolves and the public feed names Moss's
//    card; the switch off locks the hand again.
// 2. A once-per-rest card (Deft Maneuvers, CB p.101) shows used ("Used · back after a rest") and comes back after the
//    GM's rest; a vault card's recall is free while the rest is open (CB p.105).
// Dropped in the port:
// - Drag onto the table, the classic card dialog and "a used card can't be dragged": gone by design (H8.1).
// - "Hide cards" remembered across a reload: dropped by design (HUD answer 16a, local only); Hide / Show cards is in
//   tests/e2e/hud-hand.spec.ts.
// - Roll options, another PC's hand view only / hidden, vault recall in combat, the GM's lock: tests/e2e/hud-hand.spec.ts
//   "the HUD hand: fan states, Hide cards, Roll options, full card, Use, vault recall, GM lock and view only".
// - The player's own cast through the panel, rider and result: tests/e2e/hud-card-pick.spec.ts and hud-result.spec.ts;
//   "Hide my hand": tests/e2e/hud-sheet.spec.ts; the card states: tests/unit/hud/hand-states.test.tsx, card-pick.test.tsx.
// - The GM's 390 px view of the classic hand: the phone HUD is tests/e2e/hud-phone.spec.ts / hud-phone-sheets.spec.ts.

test.use({ actionTimeout: 30_000 });

const hand = (page: Page) => page.getByTestId("hud-hand");
const fanCard = (page: Page, name: string) => hand(page).getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
const pickPanel = (page: Page) => page.getByTestId("hud-pick");
const pickRow = (page: Page, tokenId: string) => pickPanel(page).locator(`[data-testid="hud-pick-row"][data-token="${tokenId}"]`);

/** How many public feed rows start with `text` ("Moss uses Vicious Entangle"). */
async function usesInFeed(s: HudScene, text: string) {
  const feed = await s.client.query(api.feed.list, { campaignId: s.campaignId, paginationOpts: { numItems: 20, cursor: null } });
  return feed.page.filter((r) => r.summary.startsWith(text)).length;
}

async function sheetOf(s: HudScene) {
  return (await s.client.query(api.characters.get, { characterId: s.characterId }))!.sheet;
}

test("the GM plays Vicious Entangle for Moss through the HUD: Play for, Use, pick, Cast on, the feed; off locks it again", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, enemies } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();

    await gm.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" }).click();
    const sheet = gm.getByRole("complementary", { name: "Moss’s sheet" });
    await expect(sheet).toBeVisible();
    await expect(hand(gm)).toHaveAttribute("data-mode", "gm");
    await expect(hand(gm).getByRole("button", { name: /^Use / })).toHaveCount(0);

    const playFor = sheet.getByRole("switch", { name: "Play for this character" });
    await playFor.click();
    await expect(playFor).toHaveAttribute("aria-checked", "true");
    const card = fanCard(gm, "Vicious Entangle");
    const use = card.getByRole("button", { name: "Use Vicious Entangle" });
    await expect(use).toBeEnabled({ timeout: 30_000 });
    await card.hover();
    await use.click();

    const panel = pickPanel(gm);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Vicious Entangle", level: 2 })).toBeVisible();
    const ring = gm.locator(`[data-testid="hud-pick-ring"][data-token="${enemies.lieutenant.tokenId}"]`);
    await pickRow(gm, enemies.lieutenant.tokenId).click();
    await expect(ring).toHaveAttribute("data-state", "picked");
    await expect(ring).toHaveClass(/hud-tg-picked/);
    await expect(panel.getByTestId("hud-pick-go")).toHaveText(`Cast on ${enemies.lieutenant.name}`);
    await expectNoSeriousA11yViolations(gm);
    await panel.getByTestId("hud-pick-go").click();
    await expect(panel).toHaveCount(0);

    const result = gm.getByTestId("hud-result");
    await expect(result.getByTestId("hud-result-row").filter({ hasText: enemies.lieutenant.name })).toContainText(/Hit|Miss|Defeated/, { timeout: 30_000 });
    // Logged with the GM acting for Moss: the public row names Moss's card.
    await expect.poll(() => usesInFeed(s, "Moss uses Vicious Entangle")).toBe(1);

    // Play for off: the hand is locked again, no Use.
    await playFor.click();
    await expect(playFor).toHaveAttribute("aria-checked", "false");
    await expect(hand(gm).getByRole("button", { name: /^Use / })).toHaveCount(0);
    await expect(hand(gm).getByTestId("hud-hand-card").first()).toContainText("Turn on “Play for Moss”");
  } finally {
    await s.close();
  }
});

test("a once-per-rest card goes used and comes back after the GM's rest; Recall is free while the rest is open", async ({ browser }) => {
  test.setTimeout(300_000);
  // Moss as a warrior: Deft Maneuvers (Bone, once per rest) and Untouchable (Bone, recall cost 1).
  const s = await hudScene(browser, { moss: { classId: "warrior", domainCards: ["deft-maneuvers", "untouchable"] } });
  const { player, client, playerClient, campaignId, characterId } = s;
  try {
    await playerClient.mutation(api.characters.moveCard, { characterId, cardId: "untouchable", to: "vault" });
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });

    // In combat the recall costs its Stress.
    await hand(player).getByRole("button", { name: "Open vault, 1 card" }).click();
    const vault = player.getByTestId("hud-hand-vault");
    await expect(vault.getByRole("button", { name: "Recall · 1 Stress, Untouchable" })).toBeVisible();
    await vault.getByRole("button", { name: "Close vault (1)" }).click();
    await expect(vault).toBeHidden();

    // Deft Maneuvers asks nothing: Use fires it at once; it goes used until a rest.
    const stressBefore = (await sheetOf(s)).stress;
    const deft = fanCard(player, "Deft Maneuvers");
    await deft.hover();
    await deft.getByRole("button", { name: "Use Deft Maneuvers" }).click();
    await expect(deft).toContainText("Used · back after a rest");
    await expect(deft.getByRole("button", { name: /^Use/ })).toHaveCount(0);
    await expect.poll(async () => (await sheetOf(s)).stress).toBe(stressBefore + 1);
    await expect.poll(() => usesInFeed(s, "Moss uses Deft Maneuvers")).toBe(1);

    // The GM rests the party: while the rest is open, Untouchable's recall is free.
    const { restId } = await client.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: crypto.randomUUID() });
    await hand(player).getByRole("button", { name: "Open vault, 1 card" }).click();
    await expect(vault).toContainText("Resting: recall is free");
    const recall = vault.getByRole("button", { name: "Recall · free, Untouchable" });
    await expect(recall).toBeVisible();
    await expectNoSeriousA11yViolations(player);
    await recall.click();
    await expect(fanCard(player, "Untouchable")).toBeVisible();
    await expect.poll(async () => (await sheetOf(s)).domainCards.loadout).toContain("untouchable");
    expect((await sheetOf(s)).stress).toBe(stressBefore + 1);

    // The rest ends: Deft Maneuvers is back.
    await client.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: crypto.randomUUID() });
    await expect(deft.getByRole("button", { name: "Use Deft Maneuvers" })).toBeEnabled({ timeout: 30_000 });
    await expect(deft).not.toContainText("Used ·");
  } finally {
    await s.close();
  }
});
