import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan combat-actions CA8 (bead dcm-bxp.99.4): combat actions end to end, in three browsers (the GM and two players).
// Ash (a Wizard) attacks the Bandit with the Rapier, casts Wild Flame (Book of Tyfar: up to three adversaries in Melee,
// 2d6 magic and "must mark a Stress": the multi-target card and the Stress card, CB p.332) on the Bandit and the
// Raider, casts Recant (Book of Korvax: the Raider makes a Reaction Roll (15), the reaction-roll card, CB p.332) and
// recalls Book of Illiat from the vault for its Recall Cost (R7, CB p.101). Bryn (a Warrior) hits a Minion and picks the
// second Minion his damage defeats (Q6, CB p.201), then uses Deft Maneuvers (once per rest), which greys out until the
// GM's rest brings it back (Q3, CB p.101, p.105). The GM sees each resolution with its numbers and undoes Wild Flame
// (U4, Q10). Throughout, every message the players' browsers receive is checked: nothing about an enemy carries its HP,
// Stress, thresholds or Difficulty (U1).
// Since the cut-over (plan combat-hud H8.1) play is always the Combat HUD: attacks go through the action ring and the
// picking panel (`hud-pick`), cards through the HUD hand's fan, results show in the result panel (`hud-result`), and the
// GM's Resolutions with Undo are the HUD's left column (`hud-resolution`), not the Map tools drawer.

test.use({ actionTimeout: 30_000 });

const PLAYER_A = "e2e-player@example.test";
const PLAYER_B = "e2e-player2@example.test";

/** An enemy any roll hits (Difficulty 1) and any damage marks 2 HP on (Major: thresholds 1 / 100). */
const sure = (name: string) => ({
  name,
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 1,
  thresholds: { major: 1, severe: 100 },
  hp: 5,
  stress: 3,
  attack: { modifier: 0, name: "Club", range: "Melee", damage: "1d6 phy" },
  experiences: [],
  features: [],
});

/** A Minion (1) any roll hits: every point of damage defeats one more Minion in range (CB p.201). */
const RAT = {
  ...sure("Rat"),
  type: "Minion" as const,
  hp: 1,
  stress: 1,
  features: [{ name: "Minion (1)", kind: "passive" as const, text: "This adversary is defeated when they take any damage. For every 1 damage a PC deals to this adversary, defeat an additional Minion within range the attack would succeed against." }],
};

/** A level-1 Wizard with Book of Tyfar and Book of Illiat (Codex); the GM raises Ash to level 3 for Book of Korvax. */
const wizardDraft = (name: string) => ({ ...bardDraft(name), classId: "wizard", subclassId: "school-of-war", domainCards: ["book-of-tyfar", "book-of-illiat"] });
/** A level-1 Warrior with Deft Maneuvers (Bone, once per rest) and Whirlwind (Blade). */
const warriorDraft = (name: string) => ({ ...bardDraft(name), classId: "warrior", subclassId: "call-of-the-brave", ancestry: { kind: "single" as const, id: "halfling" }, pronouns: "he/him", domainCards: ["deft-maneuvers", "whirlwind"] });

type Player = { page: Page; client: ConvexHttpClient; frames: string[]; close: () => Promise<void> };

/**
 * A player's browser, signed in and joined to the campaign. Every websocket message and JSON response it receives
 * after that is kept, for the U1 check.
 */
async function joinAs(browser: Browser, gm: ConvexHttpClient, campaignId: Id<"campaigns">, email: string): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const frames: string[] = [];
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  // On a loaded machine the test sign-in sometimes answers "Test sign-in failed."; press it again (FOLLOW-UPS in the
  // task doc). The first try is the shared fixture.
  await signInAsTestGm(page, email);
  const form = page.getByRole("form", { name: "Test sign-in" });
  for (let attempt = 2; attempt <= 4 && new URL(page.url()).pathname !== "/"; attempt += 1) {
    if (!(await form.getByRole("alert").isVisible())) {
      await page.waitForURL("/", { timeout: 30_000 }).catch(() => undefined);
      continue;
    }
    await form.getByRole("button", { name: "Test sign-in" }).click();
    await page.waitForURL("/", { timeout: 30_000 }).catch(() => undefined);
  }
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  await client.mutation(api.members.joinByCode, { code });
  // From here on (before the map loads), everything the browser receives is kept.
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      frames.push(typeof payload === "string" ? payload : payload.toString("utf8"));
    });
  });
  page.on("response", (response) => {
    if (!(response.headers()["content-type"] ?? "").includes("json")) return;
    response.text().then(
      (text) => frames.push(text),
      () => undefined,
    );
  });
  return { page, client, frames, close: () => context.close() };
}

/** Field names that would give away an enemy's numbers (U1). */
const SECRET_FIELDS = new Set(["hp", "hpMax", "stress", "stressMax", "major", "severe", "difficulty", "thresholds", "stats", "adversaryBefore"]);

/**
 * U1 over everything a player's browser received: every object that names an enemy (its encounter instance or map
 * token id as one of its own values) has no secret field anywhere inside it. Returns how many such objects were seen,
 * so the caller can check the scan had something to look at.
 */
function enemyLeaks(frames: readonly string[], enemyIds: ReadonlySet<string>): { seen: number; leaks: string[] } {
  let seen = 0;
  const leaks: string[] = [];
  const secretsIn = (value: unknown, path: string, out: string[]) => {
    if (Array.isArray(value)) value.forEach((v, i) => secretsIn(v, `${path}[${i}]`, out));
    else if (value !== null && typeof value === "object") {
      // A PC token row (`kind: "pc"`, combatVision.playerView's `pcs`) carries the party's own HP and Stress, which every
      // player sees on the banners anyway; it is no enemy's numbers. It sits in a view that names enemies since
      // `unseenAdversaries` (spotlight-seen, user 2026-11-03) lists enemy token ids at the view's top level.
      if ((value as Record<string, unknown>).kind === "pc") return;
      for (const [k, v] of Object.entries(value)) {
        if (SECRET_FIELDS.has(k)) out.push(`${path}.${k}`);
        secretsIn(v, `${path}.${k}`, out);
      }
    }
  };
  const namesEnemy = (obj: Record<string, unknown>) =>
    Object.values(obj).some((v) => (typeof v === "string" && enemyIds.has(v)) || (Array.isArray(v) && v.some((x) => typeof x === "string" && enemyIds.has(x))));
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (namesEnemy(obj)) {
        seen += 1;
        const found: string[] = [];
        secretsIn(obj, "", found);
        if (found.length > 0) leaks.push(`${found.join(", ")} in ${JSON.stringify(obj).slice(0, 300)}`);
      }
      Object.values(obj).forEach(walk);
    }
  };
  for (const frame of frames) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch {
      continue;
    }
    walk(parsed);
  }
  return { seen, leaks };
}

const handOf = (page: Page) => page.getByTestId("hud-hand");
const fanCard = (page: Page, name: string) => handOf(page).getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
const pickPanel = (page: Page) => page.getByTestId("hud-pick");
const pickRow = (page: Page, tokenId: string) => pickPanel(page).locator(`[data-testid="hud-pick-row"][data-token="${tokenId}"]`);

/** Use on a card of the HUD fan: hovering raises it whole, then its Use is in reach (tests/e2e/hud-card-pick.spec.ts). */
async function useCard(page: Page, name: string) {
  await fanCard(page, name).hover();
  await fanCard(page, name).getByRole("button", { name: `Use ${name}` }).click();
}

/** The action ring's Attack (H3.4): a click on the player's own token opens the ring; Attack opens the picking panel. */
async function openAttack(page: Page, name: string) {
  await page
    .getByRole("region", { name: "Battle map" })
    .getByRole("button", { name: new RegExp(`^Open ${name}’s sheet \\(your character\\)`) })
    .click();
  const attack = page.getByRole("toolbar", { name: `Your actions (${name})` }).getByRole("button", { name: "Attack" });
  await expect(attack).toBeEnabled({ timeout: 30_000 });
  await attack.click();
  await expect(pickPanel(page)).toBeVisible();
}

/** Words that would give an enemy's numbers away on a player's result (U1). */
const NUMBERS = /\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b/;

test("two players and the GM: attacks, cards, a Minion pick, a recall, a rest and GM undo; players never see enemy numbers", async ({ page, browser }) => {
  test.setTimeout(600_000);
  const { client: gm, campaignId, url } = await openCombatMap(page);
  const a = await joinAs(browser, gm, campaignId, PLAYER_A);
  const b = await joinAs(browser, gm, campaignId, PLAYER_B);
  try {
    // ---- Seed: Ash (level 3, Book of Korvax taken from the Domain Deck, Book of Illiat in the vault) and Bryn.
    const { characterId: ash } = await a.client.mutation(api.characters.create, { campaignId, draft: wizardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    const { characterId: bryn } = await b.client.mutation(api.characters.create, { campaignId, draft: warriorDraft("Bryn"), idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.levelUp.correctLevel, { characterId: ash, level: 3, idempotencyKey: crypto.randomUUID() });
    await a.client.mutation(api.characters.takeCard, { characterId: ash, cardId: "book-of-korvax" });
    await a.client.mutation(api.characters.moveCard, { characterId: ash, cardId: "book-of-illiat", to: "vault" });

    const custom = async (adversary: ReturnType<typeof sure> | typeof RAT) => (await gm.mutation(api.customAdversaries.create, { campaignId, adversary, idempotencyKey: crypto.randomUUID() })).customId;
    const [banditBlock, raiderBlock, ratBlock] = [await custom(sure("Bandit")), await custom(sure("Raider")), await custom(RAT)];
    const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
    const add = async (customId: Id<"customAdversaries">) =>
      (await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() })).instanceIds[0]!;
    const bandit = await add(banditBlock);
    const raider = await add(raiderBlock);
    const rat1 = await add(ratBlock);
    const rat2 = await add(ratBlock);
    await gm.mutation(api.encounters.start, { campaignId, encounterId });

    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatMaps.setLive, { campaignId, mapId });
    await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [bandit, raider, rat1, rat2], idempotencyKey: crypto.randomUUID() });
    const tokens = await gm.query(api.combatTokensReads.list, { campaignId, mapId });
    const tokenOf = (pick: (t: (typeof tokens)[number]) => boolean) => tokens.find(pick)!;
    const place = async (tokenId: Id<"combatTokens">, x: number, y: number) => gm.mutation(api.combatTokens.move, { campaignId, tokenId, x, y });
    // Ash at (5, 10) with the Bandit and the Raider in Melee; Bryn at (12, 10) with both Rats in Melee. Both face east.
    const ashToken = tokenOf((t) => t.characterId === ash);
    const brynToken = tokenOf((t) => t.characterId === bryn);
    await place(ashToken._id, 5, 10);
    await place(brynToken._id, 12, 10);
    await gm.mutation(api.combatTokens.turn, { campaignId, tokenId: ashToken._id, angle: 0 });
    await gm.mutation(api.combatTokens.turn, { campaignId, tokenId: brynToken._id, angle: 0 });
    await place(tokenOf((t) => t.instanceId === bandit)._id, 6, 10);
    await place(tokenOf((t) => t.instanceId === raider)._id, 6, 11);
    await place(tokenOf((t) => t.instanceId === rat1)._id, 13, 10);
    await place(tokenOf((t) => t.instanceId === rat2)._id, 13, 11);
    const enemyIds = new Set<string>([bandit, raider, rat1, rat2, ...tokens.filter((t) => t.instanceId !== undefined && t.instanceId !== null).map((t) => t._id as string)]);
    const nameOf = (instanceId: Id<"encounterAdversaries">) => tokenOf((t) => t.instanceId === instanceId).name;

    const instance = async (id: Id<"encounterAdversaries">) => {
      const got = await gm.query(api.encounters.get, { campaignId, encounterId });
      return got!.instances.find((i) => i._id === id)!;
    };
    const sheetOf = async (characterId: Id<"characters">) => (await gm.query(api.charactersReads.get, { characterId }))!.sheet;

    for (const p of [a.page, b.page, page]) {
      await p.setViewportSize({ width: 1440, height: 900 });
      await p.goto(url);
      await expect(p.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
    }
    await expect(handOf(a.page)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    await expect(handOf(b.page)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    await expect(handOf(a.page).getByRole("article", { name: "Book of Tyfar" })).toBeVisible({ timeout: 30_000 });
    await expect(handOf(b.page).getByRole("article", { name: "Deft Maneuvers" })).toBeVisible({ timeout: 30_000 });
    // The GM's Resolutions with Undo, in the HUD's left column (H5.1).
    await expect(page.getByTestId("hud-resolutions")).toBeVisible({ timeout: 30_000 });
    const resolution = (text: string) => page.getByTestId("hud-resolution").filter({ hasText: text });
    const banditToken = tokenOf((t) => t.instanceId === bandit)._id;
    const raiderToken = tokenOf((t) => t.instanceId === raider)._id;

    // ---- 1. Ash attacks the Bandit through the action ring: Hit, 2 HP on the GM's side only (R1, R3, U1).
    await openAttack(a.page, "Ash");
    await pickRow(a.page, banditToken).click();
    await pickPanel(a.page).getByTestId("hud-pick-go").click();
    await expect(pickPanel(a.page)).toHaveCount(0);
    const result = a.page.getByTestId("hud-result");
    await expect(result.getByTestId("hud-result-row").filter({ hasText: "Bandit" })).toContainText("Hit", { timeout: 30_000 });
    await expect(result).not.toContainText(NUMBERS);
    await expect.poll(async () => (await instance(bandit)).hp).toBe(2);
    await expect(resolution("Bandit").first()).toContainText("Ash", { timeout: 30_000 });

    // ---- 2. Wild Flame (Book of Tyfar) on the Bandit and the Raider: one roll, both hit, 2d6 magic and a Stress each.
    await useCard(a.page, "Book of Tyfar");
    const tyfar = pickPanel(a.page);
    await expect(tyfar).toBeVisible();
    const flame = tyfar.getByTestId("hud-card-spell").getByRole("radio", { name: "Wild Flame" });
    await flame.click();
    await expect(flame).toBeChecked();
    for (const token of [banditToken, raiderToken]) {
      const row = pickRow(a.page, token);
      if ((await row.getAttribute("aria-pressed")) !== "true") await row.click();
      await expect(row).toHaveAttribute("aria-pressed", "true");
    }
    await tyfar.getByTestId("hud-pick-go").click();
    await expect(tyfar).toHaveCount(0);
    await expect(result.getByRole("heading", { name: "Book of Tyfar", level: 2 })).toBeVisible({ timeout: 30_000 });
    await expect(result.getByTestId("hud-result-row")).toHaveText([/Bandit[\s\S]*Hit/, /Raider[\s\S]*Hit/]);
    await expect(result).not.toContainText(NUMBERS);
    await expect.poll(async () => [(await instance(bandit)).stress, (await instance(raider)).stress]).toEqual([1, 1]);
    expect((await instance(bandit)).hp).toBe(4);
    expect((await instance(raider)).hp).toBe(2);
    const flameRow = resolution("Book of Tyfar").first();
    await expect(flameRow).toBeVisible({ timeout: 30_000 });

    // ---- 3. The GM undoes Wild Flame: both enemies go back to their state before it (U4); the players' feed says so.
    await flameRow.getByRole("button", { name: /^Undo: / }).click();
    await expect(flameRow).toHaveClass(/hud-res-undone/, { timeout: 30_000 });
    await expect(flameRow).toContainText("undone");
    await expect.poll(async () => [(await instance(bandit)).hp, (await instance(bandit)).stress, (await instance(raider)).hp, (await instance(raider)).stress]).toEqual([2, 0, 0, 0]);
    await expect(a.page.getByTestId("hud-feed").locator("li.hud-feed-undone").filter({ hasText: "Book of Tyfar" }).first()).toContainText("undone");

    // ---- 4. Recant (Book of Korvax): the Raider makes a Reaction Roll (15), rolled by the server (Q7); a Hope is spent.
    const hopeBefore = (await sheetOf(ash)).hope;
    await useCard(a.page, "Book of Korvax");
    const korvax = pickPanel(a.page);
    await expect(korvax).toBeVisible();
    const recant = korvax.getByTestId("hud-card-spell").getByRole("radio", { name: "Recant" });
    await recant.click();
    await expect(recant).toBeChecked();
    // A new session starts with no picks of the last one (DA6): the Raider, picked for Wild Flame, is not.
    await expect(pickRow(a.page, raiderToken)).toHaveAttribute("aria-pressed", "false");
    // Creatures beyond Recant's Melee range stay listed for the GM's approval (DA6): Bryn.
    await expect(pickRow(a.page, brynToken._id)).toContainText("GM approves");
    await pickRow(a.page, raiderToken).click();
    await expect(pickRow(a.page, raiderToken)).toHaveAttribute("aria-pressed", "true");
    await expect(pickRow(a.page, banditToken)).not.toHaveAttribute("aria-pressed", "true");
    await korvax.getByTestId("hud-pick-go").click();
    await expect(korvax).toHaveCount(0);
    await expect(result.getByRole("heading", { name: "Book of Korvax", level: 2 })).toBeVisible({ timeout: 30_000 });
    await expect(result).not.toContainText(NUMBERS);
    await expect.poll(async () => (await sheetOf(ash)).hope).toBe(hopeBefore - 1);
    await expect(resolution("Book of Korvax").first()).toContainText("Raider", { timeout: 30_000 });

    // ---- 5. Recall: Book of Illiat comes back from the vault for its Recall Cost in Stress (R7, CB p.101).
    const stressBefore = (await sheetOf(ash)).stress;
    await handOf(a.page).getByRole("button", { name: "Open vault, 1 card" }).click();
    const vault = a.page.getByTestId("hud-hand-vault");
    await vault.getByRole("button", { name: "Recall · 2 Stress, Book of Illiat" }).click();
    await expect(fanCard(a.page, "Book of Illiat")).toBeVisible();
    await expect.poll(async () => (await sheetOf(ash)).stress).toBe(stressBefore + 2);

    // ---- 6. Bryn hits a Rat and picks the second Rat his damage defeats (Q6, CB p.201): the HUD's Minion offer.
    const rat1Token = tokenOf((t) => t.instanceId === rat1)._id;
    const rat2Token = tokenOf((t) => t.instanceId === rat2)._id;
    await openAttack(b.page, "Bryn");
    await pickRow(b.page, rat1Token).click();
    await pickPanel(b.page).getByTestId("hud-pick-go").click();
    await expect(pickPanel(b.page)).toHaveCount(0);
    const brynResult = b.page.getByTestId("hud-result");
    // A roll with Fear may wait for Bryn's after-the-roll feature (Q1, "Your roll waits"): pass, so the damage rolls.
    const held = b.page.getByRole("dialog", { name: "Your roll waits" });
    await expect(brynResult.or(held).first()).toBeVisible({ timeout: 30_000 });
    if (await held.isVisible()) await held.getByRole("button", { name: "Pass" }).click();
    await expect(brynResult.getByTestId("hud-result-row").filter({ hasText: nameOf(rat1) })).toContainText("Defeated", { timeout: 30_000 });
    await expect(brynResult).not.toContainText(NUMBERS);
    const offer = b.page.getByTestId("hud-attack-minions");
    await expect(offer).toContainText(/Your hit can defeat \d+ more Minions?/);
    await offer.getByRole("button", { name: "Pick Minions" }).click();
    await pickRow(b.page, rat2Token).click();
    await expect(pickPanel(b.page).getByTestId("hud-pick-go")).toHaveText("Defeat 1");
    await pickPanel(b.page).getByTestId("hud-pick-go").click();
    await expect(pickPanel(b.page)).toHaveCount(0);
    await expect(offer).toHaveCount(0);
    await expect.poll(async () => [(await instance(rat1)).defeated, (await instance(rat2)).defeated]).toEqual([true, true]);

    // ---- 7. Deft Maneuvers (once per rest) is used and shows so; the GM's rest brings it back (Q3, CB p.101, p.105).
    await useCard(b.page, "Deft Maneuvers");
    const used = handOf(b.page).getByRole("article", { name: "Deft Maneuvers, used: Back after a rest" });
    await expect(used).toHaveAttribute("data-exhausted", "true", { timeout: 30_000 });
    await expect(fanCard(b.page, "Deft Maneuvers")).toContainText("Used · back after a rest");
    await expect(fanCard(b.page, "Deft Maneuvers").getByRole("button", { name: /^Use/ })).toHaveCount(0);
    const { restId } = await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: crypto.randomUUID() });
    await expect(fanCard(b.page, "Deft Maneuvers").getByRole("button", { name: "Use Deft Maneuvers" })).toBeEnabled({ timeout: 30_000 });

    // ---- U1: nothing either player received names an enemy alongside its HP, Stress, thresholds or Difficulty.
    for (const [who, player] of [
      ["Ash's player", a],
      ["Bryn's player", b],
    ] as const) {
      const { seen, leaks } = enemyLeaks(player.frames, enemyIds);
      expect(seen, `${who}: messages about enemies were received`).toBeGreaterThan(0);
      expect(leaks, `${who}: enemy numbers in network responses`).toEqual([]);
    }
  } finally {
    await a.close();
    await b.close();
  }
});
