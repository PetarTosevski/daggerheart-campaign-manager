import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
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
// Locators are roles and labels only, so the sheet-drawer wave's layout changes leave them working.

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

/** The non-drag way to play a card (WCAG 2.5.7): focus raises it out of the fan, Enter presses its Use. */
async function useByKeyboard(card: Locator, name: string) {
  const use = card.getByRole("button", { name: `Use ${name}` });
  await use.focus();
  await use.press("Enter");
}

/** Presses the dialog's creature chips so exactly `names` are picked. */
async function pickExactly(dialog: Locator, all: readonly string[], names: readonly string[]) {
  for (const name of all) {
    const chip = dialog.getByRole("button", { name, exact: true });
    const on = (await chip.getAttribute("aria-pressed")) === "true";
    if (on !== names.includes(name)) await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", String(names.includes(name)));
  }
}

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
    await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [bandit, raider, rat1, rat2], idempotencyKey: crypto.randomUUID() });
    const tokens = await gm.query(api.combatTokens.list, { campaignId, mapId });
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
    const sheetOf = async (characterId: Id<"characters">) => (await gm.query(api.characters.get, { characterId }))!.sheet;

    await a.page.goto(url);
    await b.page.goto(url);
    await page.goto(url);
    const ashHand = a.page.getByRole("region", { name: "Your hand" });
    const brynHand = b.page.getByRole("region", { name: "Your hand" });
    await expect(ashHand.getByRole("article", { name: "Book of Tyfar" })).toBeVisible({ timeout: 30_000 });
    await expect(brynHand.getByRole("article", { name: "Deft Maneuvers" })).toBeVisible({ timeout: 30_000 });
    const resolutions = page.getByRole("region", { name: "Resolutions" });
    await expect(resolutions).toBeVisible({ timeout: 30_000 });

    // ---- 1. Ash attacks the Bandit with the Rapier: Hit, 2 HP on the GM's side only (R1, R3, U1).
    const ashBoard = a.page.getByRole("region", { name: "Battle map" });
    const ashAttack = a.page.getByRole("region", { name: "Attack", exact: true });
    await ashBoard.getByRole("button", { name: /^Bandit, Enemy/ }).click();
    await ashAttack.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    const attackResult = ashAttack.getByRole("region", { name: "Attack result" });
    await expect(attackResult.getByTestId("combat-verdict")).toHaveText(/Bandit\s*Hit/);
    await expect(attackResult).not.toContainText(/\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b/);
    await expect.poll(async () => (await instance(bandit)).hp).toBe(2);
    await expect(resolutions.getByTestId("combat-resolution").filter({ hasText: "Ash → Bandit" }).first()).toContainText("Major → 2 HP (2/5)");

    // ---- 2. Wild Flame (Book of Tyfar) on the Bandit and the Raider: one roll, both hit, 2d6 magic and a Stress each.
    await useByKeyboard(ashHand.getByRole("article", { name: "Book of Tyfar" }), "Book of Tyfar");
    const tyfar = a.page.getByRole("dialog", { name: "Book of Tyfar" });
    await expect(tyfar.getByRole("button", { name: "Wild Flame", exact: true })).toHaveAttribute("aria-pressed", "true");
    await pickExactly(tyfar, ["Bandit", "Raider"], ["Bandit", "Raider"]);
    await tyfar.getByRole("button", { name: "Use Wild Flame" }).click();
    await expect(tyfar).toHaveCount(0);
    const cardResult = ashHand.getByRole("region", { name: "Card result" });
    await expect(cardResult.getByTestId("combat-card-verdict")).toHaveText([/Bandit\s*Hit/, /Raider\s*Hit/]);
    await expect(cardResult).not.toContainText(/\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b/);
    await expect.poll(async () => [(await instance(bandit)).stress, (await instance(raider)).stress]).toEqual([1, 1]);
    expect((await instance(bandit)).hp).toBe(4);
    expect((await instance(raider)).hp).toBe(2);
    const flameRow = resolutions.getByTestId("combat-resolution").filter({ hasText: "Ash · Book of Tyfar" });
    await expect(flameRow).toContainText("Raider");

    // ---- 3. The GM undoes Wild Flame: both enemies go back to their state before it (U4).
    await flameRow.getByRole("button", { name: /^Undo/ }).click();
    await expect(flameRow).toContainText("Undone");
    await expect.poll(async () => [(await instance(bandit)).hp, (await instance(bandit)).stress, (await instance(raider)).hp, (await instance(raider)).stress]).toEqual([2, 0, 0, 0]);
    await expect(a.page.getByRole("region", { name: "Roll feed" }).getByTestId("combat-mini-feed")).toContainText("(undone)");

    // ---- 4. Recant (Book of Korvax): the Raider makes a Reaction Roll (15), rolled by the server (Q7); a Hope is spent.
    const hopeBefore = (await sheetOf(ash)).hope;
    await useByKeyboard(ashHand.getByRole("article", { name: "Book of Korvax" }), "Book of Korvax");
    const korvax = a.page.getByRole("dialog", { name: "Book of Korvax" });
    await korvax.getByRole("button", { name: "Recant", exact: true }).click();
    await expect(korvax.getByRole("button", { name: "Recant", exact: true })).toHaveAttribute("aria-pressed", "true");
    // The Wild Flame picks may still be on (they ring the tokens on the map): leave only the Raider.
    await pickExactly(korvax, ["Bandit", "Raider"], ["Raider"]);
    await korvax.getByRole("button", { name: "Use Recant" }).click();
    await expect(korvax).toHaveCount(0);
    await expect(cardResult).toContainText("Book of Korvax");
    await expect(cardResult).not.toContainText(/\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b/);
    await expect.poll(async () => (await sheetOf(ash)).hope).toBe(hopeBefore - 1);
    await expect(resolutions.getByTestId("combat-resolution").filter({ hasText: "Ash · Book of Korvax" })).toContainText(/Raider: reaction \d+ vs 15 → (succeeds|fails)/);

    // ---- 5. Recall: Book of Illiat comes back from the vault for its Recall Cost in Stress (R7, CB p.101).
    const stressBefore = (await sheetOf(ash)).stress;
    await ashHand.getByRole("button", { name: "Open vault, 1 card" }).click();
    await ashHand.getByRole("list", { name: "Vault" }).getByRole("button", { name: "Recall: 2 Stress, Book of Illiat" }).click();
    await expect(ashHand.getByRole("list", { name: "Loadout" }).getByRole("article", { name: "Book of Illiat" })).toBeVisible();
    await expect.poll(async () => (await sheetOf(ash)).stress).toBe(stressBefore + 2);

    // ---- 6. Bryn hits a Rat and picks the second Rat his damage defeats (Q6, CB p.201).
    const brynBoard = b.page.getByRole("region", { name: "Battle map" });
    const brynAttack = b.page.getByRole("region", { name: "Attack", exact: true });
    const rat1Name = nameOf(rat1);
    const rat2Name = nameOf(rat2);
    await brynBoard.getByRole("button", { name: new RegExp(`^${rat1Name}, Enemy`) }).click();
    await brynAttack.getByRole("button", { name: `⚔ Attack ${rat1Name} with Rapier` }).click();
    await expect(brynAttack.getByRole("region", { name: "Attack result" }).getByTestId("combat-verdict")).toHaveText(new RegExp(`${rat1Name}\\s*Defeated`));
    // The offer opens the pick dialog by itself.
    const minions = b.page.getByRole("dialog", { name: "Pick Minions" });
    await expect(minions).toBeVisible();
    await minions.getByRole("group", { name: rat2Name }).getByRole("button", { name: /^More / }).click();
    await minions.getByRole("button", { name: "Defeat 1" }).click();
    await expect(minions).toHaveCount(0);
    await expect.poll(async () => [(await instance(rat1)).defeated, (await instance(rat2)).defeated]).toEqual([true, true]);

    // ---- 7. Deft Maneuvers (once per rest) greys out; the GM's rest brings it back (Q3, CB p.101, p.105).
    await useByKeyboard(brynHand.getByRole("article", { name: "Deft Maneuvers" }), "Deft Maneuvers");
    const used = brynHand.getByRole("article", { name: "Deft Maneuvers, used: Back after a rest" });
    await expect(used).toHaveAttribute("data-exhausted", "true");
    await expect(used.getByRole("button", { name: /^Use/ })).toHaveCount(0);
    const { restId } = await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: crypto.randomUUID() });
    await expect(brynHand.getByRole("article", { name: "Deft Maneuvers" }).getByRole("button", { name: "Use Deft Maneuvers" })).toBeEnabled();

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
