import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan combat-actions AA6 (bead dcm-bxp.99.9): adversary actions end to end, in three browsers (the GM and two players).
// 1. From the Encounter tab (Q12, Q16) the GM's Bandit attacks Mira; in the reaction window (Q13) Tabby's player answers
//    with I Am Your Shield (CB p.341), marks an Armor Slot, and the hit resolves on Tabby.
// 2. From the Combat Map (Q12 "he can also use combat map if he wants"; the HUD stat block since plan combat-hud H8.2)
//    the Bandit attacks Mira again; Mira's player marks an Armor Slot (CB p.114) in the HUD's hit window, Tabby's player
//    passes; the GM undoes it from the HUD's Resolutions (U4) and Mira's sheet comes back.
// 3. A multi-target Fear feature: the Minor Fire Elemental's Explosion (CB p.214, "Spend a Fear … Make an attack against
//    all targets within Close range") asks "Spend N Fear?" first (Q19), then makes ONE roll against Mira and Tabby (AR7,
//    CB p.161); its Momentum (CB p.195) gains a Fear on a hit with no prompt (Q19); the GM undoes it.
// 4. Momentum on a standard attack: the Elemental hits, the GM's Fear goes up by 1 at once; undo takes it back.
// 5. A Minion Group Attack: three Sellswords (Minion (4), 3 physical each, CB p.217) make one shared roll and deal the
//    combined 9 damage (AR9, CB p.201).
// 6. Throughout, every message the players' browsers receive is kept; no object about an adversary or its action carries
//    the attack roll, dice, the stat block's numbers or the GM's before-state (Q14, U1).
// SRD dice are random: steps 3-5 roll through the server API until the case they check comes up (each retry is undone).

test.use({ actionTimeout: 30_000 });

const PLAYER_A = "e2e-player@example.test";
const PLAYER_B = "e2e-player2@example.test";

/** A Bandit that always hits (ATK +15) for 2d6+12. */
const SURE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 15, name: "Club", range: "Melee", damage: "2d6+12 phy" },
  experiences: [],
  features: [],
};

/** A level-1 Guardian (Stalwart) in Chainmail holding I Am Your Shield (Valor 1, CB p.341). */
const guardianDraft = (name: string) => ({
  ...bardDraft(name),
  classId: "guardian",
  subclassId: "stalwart",
  ancestry: { kind: "single" as const, id: "dwarf" },
  communityId: "ridgeborne",
  traits: { agility: 1, strength: 2, finesse: 0, instinct: 1, presence: 0, knowledge: -1 },
  pronouns: "he/him",
  primaryWeaponId: "broadsword",
  armorId: "chainmail-armor",
  experiences: ["Shieldwall", "Stubborn"],
  domainCards: ["i-am-your-shield", "whirlwind"],
});

type Player = { page: Page; client: ConvexHttpClient; frames: string[]; close: () => Promise<void> };

/** A player's browser, signed in and joined; every websocket message and JSON response it receives is kept (U1, Q14). */
async function joinAs(browser: Browser, gm: ConvexHttpClient, campaignId: Id<"campaigns">, email: string): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const frames: string[] = [];
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(page, email);
  // On a loaded machine the test sign-in sometimes answers "Test sign-in failed."; press it again.
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

/** Fields that would give away an adversary's attack roll or its stat block (Q14, U1). */
const SECRET_FIELDS = new Set([
  "roll",
  "dice",
  "total",
  "modifier",
  "attackTotal",
  "evasion",
  "difficulty",
  "hp",
  "hpMax",
  "stress",
  "stressMax",
  "major",
  "severe",
  "thresholds",
  "stats",
  "adversaryBefore",
]);
/** The hit PC's own preview of their sheet after armor (Q14: they see their own damage and severity). */
const OWN_FIELDS = new Set(["armorPreview"]);

/**
 * Q14 / U1 over everything a player's browser received: every object about an adversary (one of its own values is an
 * encounter instance or adversary token id, it is an adversary feed row, or it is an incoming hit naming its attacker)
 * has no secret field anywhere inside it. Returns how many such objects were seen, so the check is not vacuous.
 */
function adversaryLeaks(frames: readonly string[], enemyIds: ReadonlySet<string>): { seen: number; leaks: string[] } {
  let seen = 0;
  const leaks: string[] = [];
  const secretsIn = (value: unknown, path: string, out: string[]) => {
    if (Array.isArray(value)) value.forEach((v, i) => secretsIn(v, `${path}[${i}]`, out));
    else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (OWN_FIELDS.has(k)) continue;
        if (SECRET_FIELDS.has(k)) out.push(`${path}.${k}`);
        secretsIn(v, `${path}.${k}`, out);
      }
    }
  };
  const aboutAdversary = (obj: Record<string, unknown>) =>
    obj.kind === "adversary" ||
    "attackerLabel" in obj ||
    Object.values(obj).some((v) => (typeof v === "string" && enemyIds.has(v)) || (Array.isArray(v) && v.some((x) => typeof x === "string" && enemyIds.has(x))));
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (aboutAdversary(obj)) {
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

type ActionResult = FunctionReturnType<typeof api.adversaryActions.attack>;

test("adversary actions from both pages: I Am Your Shield, armor, undo, a multi-target Fear feature, Momentum, a Minion Group Attack; players never get the roll", async ({ page, browser }) => {
  test.setTimeout(600_000);
  const { client: gm, campaignId, url } = await openCombatMap(page);
  const a = await joinAs(browser, gm, campaignId, PLAYER_A);
  const b = await joinAs(browser, gm, campaignId, PLAYER_B);
  try {
    // ---- Seed: Mira (a Bard, player A) and Tabby (a Guardian with I Am Your Shield, player B) beside the Bandit on the
    // live map; the Minor Fire Elemental and three Sellswords in the encounter, off the map (Q18: the party list).
    const { characterId: mira } = await a.client.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
    const { characterId: tabby } = await b.client.mutation(api.characters.create, { campaignId, draft: guardianDraft("Tabby"), idempotencyKey: crypto.randomUUID() });
    const { customId } = await gm.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
    const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
    const add = async (source: { kind: "custom"; customId: Id<"customAdversaries"> } | { kind: "srd"; adversaryId: string }, count = 1) =>
      (await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source, count, summoned: false, idempotencyKey: crypto.randomUUID() })).instanceIds;
    const [bandit] = await add({ kind: "custom", customId });
    const [elemental] = await add({ kind: "srd", adversaryId: "minor-fire-elemental" });
    const sellswords = await add({ kind: "srd", adversaryId: "sellsword" }, 3);
    await gm.mutation(api.encounters.start, { campaignId, encounterId });
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [bandit!], idempotencyKey: crypto.randomUUID() });
    const tokens = await gm.query(api.combatTokensReads.list, { campaignId, mapId });
    await gm.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === mira)!._id, x: 5, y: 10 });
    await gm.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === tabby)!._id, x: 5, y: 11 });
    await gm.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === bandit)!._id, x: 6, y: 10 });
    await gm.mutation(api.fear.set, { campaignId, value: 6, idempotencyKey: crypto.randomUUID() });
    const enemyIds = new Set<string>([bandit!, elemental!, ...sellswords, ...tokens.filter((t) => t.instanceId !== undefined && t.instanceId !== null).map((t) => t._id as string)]);

    const sheet = async (id: Id<"characters">) => (await gm.query(api.charactersReads.get, { characterId: id }))!.sheet;
    const fear = async () => (await gm.query(api.campaigns.fear, { campaignId }))!; // the GM always gets a number (R1)
    const undo = (r: { entryId: Id<"actionLog"> }) => gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: crypto.randomUUID() });

    for (const p of [a.page, b.page]) {
      await p.goto(url);
      await expect(p.getByRole("region", { name: "Battle map" })).toBeVisible({ timeout: 30_000 });
    }

    // ---- 1. Encounter tab: the Bandit attacks Mira; Tabby answers with I Am Your Shield and takes it (Q12, Q13).
    await page.goto(`/campaigns/${campaignId}/adversaries`);
    await page.getByRole("tab", { name: "Encounters" }).click();
    const tracker = page.getByRole("tabpanel", { name: "Encounters" }).getByRole("region", { name: "Encounter tracker" });
    await tracker.getByRole("article", { name: "Bandit", exact: true }).getByRole("button", { name: "Bandit", exact: true }).click();
    const panel = tracker.getByRole("article", { name: "Bandit stat block" }).getByRole("region", { name: "Adversary actions" });
    await panel.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Mira" }).click();
    await panel.getByRole("button", { name: "⚔ Attack Mira with Club" }).click();
    const result = panel.getByRole("region", { name: "Action result" });
    await expect(result.getByTestId("tracker-action-roll")).toHaveText(/^Roll \d+ \(d20 \d+, \+15\)/);
    await expect(result.getByRole("list", { name: "Targets" })).toContainText(/Mira\s*Hit\s*\d+ damage\s*waiting for answers/);
    const windows = tracker.getByRole("region", { name: "Reaction windows" });
    await expect(windows.getByTestId("tracker-window")).toContainText("Mira (armor choice)");

    // The players answer in the HUD's hit window (plan combat-hud H4.2; H8.1 removed the classic "Incoming hit" card).
    const tabbySees = b.page.getByRole("dialog", { name: "Tabby can react" });
    await expect(tabbySees).toContainText("Bandit hit Mira", { timeout: 30_000 });
    await expect(tabbySees).not.toContainText(/\d+ damage/);
    await tabbySees.getByRole("button", { name: "Use I Am Your Shield" }).click();
    const shield = b.page.getByRole("dialog", { name: "You were hit" });
    await expect(shield).toContainText("Bandit hit Tabby (instead of Mira)", { timeout: 30_000 });
    await expect(a.page.getByTestId("hud-hit-window")).toHaveCount(0, { timeout: 30_000 });
    await shield.getByRole("button", { name: /^Mark Armor · take / }).click();
    await expect(b.page.getByTestId("hud-hit-window")).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await sheet(tabby)).armorMarked).toBe(1);
    expect((await sheet(tabby)).stress).toBe(1);
    expect((await sheet(tabby)).hp).toBeGreaterThan(0);
    expect((await sheet(mira)).hp).toBe(0);
    await expect(windows).toHaveCount(0);
    await expect(a.page.getByTestId("hud-feed")).toContainText("Bandit hit Mira", { timeout: 30_000 });

    // ---- 2. Combat Map (the HUD stat block, plan combat-hud H8.2): the Bandit attacks Mira; Mira marks an Armor Slot,
    // Tabby passes; the GM undoes it from the HUD's Resolutions (U4).
    const map = await page.context().newPage();
    await map.setViewportSize({ width: 1440, height: 900 });
    await map.goto(url);
    await map
      .getByRole("region", { name: "Battle map" })
      .getByRole("button", { name: /^Open the Bandit’s stat block/ })
      .click({ timeout: 30_000 });
    const block = map.getByRole("complementary", { name: "Bandit’s stat block" });
    await block.getByTestId("hud-statblock-attack").click();
    const pick = map.getByTestId("hud-pick");
    await pick.getByTestId("hud-pick-row").filter({ hasText: "Mira" }).click();
    const before = await sheet(mira);
    await pick.getByTestId("hud-pick-go").click();
    const confirm = map.getByTestId("hud-fear-confirm");
    // The GM turn's second spotlight may cost a Fear (the Encounter tab's attack took the first): pay it.
    const mapResult = block.getByTestId("tracker-action-result");
    await expect(mapResult.or(confirm).first()).toBeVisible({ timeout: 30_000 });
    if (await confirm.isVisible()) await confirm.getByRole("button", { name: /^Spend \d Fear$/ }).click();
    await expect(mapResult).toContainText(/Mira\s*Hit/, { timeout: 30_000 });
    const miraWin = a.page.getByRole("dialog", { name: "You were hit" });
    await expect(miraWin).toContainText("Bandit hit Mira", { timeout: 30_000 });
    await expect(miraWin.getByTestId("hud-hit-damage")).toHaveText(/^\d+$/);
    await expect(miraWin).not.toContainText(/\b(roll|Evasion|Difficulty|ATK)\b/i);
    await miraWin.getByRole("button", { name: /^Mark Armor · take / }).click();
    await b.page.getByRole("dialog", { name: "Tabby can react" }).getByRole("button", { name: "Pass" }).click({ timeout: 30_000 });
    await expect.poll(async () => (await sheet(mira)).armorMarked).toBe(before.armorMarked + 1);
    expect((await sheet(mira)).hp).toBeGreaterThan(before.hp);
    // Resolutions open from the dock's Log (plan combat-hud H9.2).
    const log = map.getByRole("toolbar", { name: "Map controls" }).getByRole("button", { name: "Log" });
    if ((await log.getAttribute("aria-pressed")) !== "true") await log.click();
    const resolution = map.getByTestId("hud-resolution").filter({ hasText: /Club/ }).first();
    await resolution.getByRole("button", { name: /^Undo: / }).click({ timeout: 30_000 });
    await expect.poll(async () => (await sheet(mira)).armorMarked).toBe(before.armorMarked);
    expect((await sheet(mira)).hp).toBe(before.hp);
    await map.close();

    // ---- 3. Explosion (1 Fear, every target within Close range): asked first, then one roll against both PCs.
    const explode = (spendFear?: number) =>
      gm.mutation(api.adversaryActions.useFeature, {
        campaignId,
        instanceId: elemental!,
        feature: "Explosion",
        targets: [mira, tabby],
        ...(spendFear === undefined ? {} : { spendFear }),
        idempotencyKey: crypto.randomUUID(),
      });
    let fearBefore = await fear();
    const ask = await explode();
    if (ask.status !== "confirmFear") throw new Error("Explosion should ask for its Fear first (Q19)");
    expect(ask.feature).toBe(1);
    expect(ask.fear).toBe(ask.feature + ask.spotlight);
    expect(await fear()).toBe(fearBefore);
    const boom = await explode(ask.fear);
    if (boom.status !== "resolved") throw new Error("Explosion not resolved");
    expect(boom.roll?.dice.filter((d) => d.sides === 20)).toHaveLength(1);
    expect(boom.targets.map((t) => t.characterId).sort()).toEqual([mira, tabby].sort());
    const anyHit = boom.targets.some((t) => t.hit);
    // Momentum ("When the X makes a successful attack against a PC, you gain a Fear"): automatic, no prompt (Q19).
    expect(await fear()).toBe(Math.min(12, fearBefore - ask.fear + (anyHit ? 1 : 0)));
    await undo(boom);
    await expect.poll(fear).toBe(fearBefore);
    expect(await gm.query(api.adversaryActions.pending, { campaignId, characterId: mira })).toEqual([]);
    expect(await gm.query(api.adversaryActions.pending, { campaignId, characterId: tabby })).toEqual([]);

    // ---- 4. Momentum on the Elemental's standard attack: a hit gains the GM a Fear at once; undo takes it back.
    let momentum = false;
    for (let attempt = 0; attempt < 8 && !momentum; attempt += 1) {
      await gm.mutation(api.fear.set, { campaignId, value: 6, idempotencyKey: crypto.randomUUID() });
      fearBefore = await fear();
      let r: ActionResult = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: elemental!, targets: [mira], advantage: 3, idempotencyKey: crypto.randomUUID() });
      let paid = 0;
      if (r.status === "confirmFear") {
        paid = r.fear;
        r = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: elemental!, targets: [mira], advantage: 3, spendFear: r.fear, idempotencyKey: crypto.randomUUID() });
      }
      if (r.status !== "resolved") throw new Error("attack not resolved");
      if (r.targets[0]!.hit) {
        momentum = true;
        expect(await fear()).toBe(fearBefore - paid + 1);
      } else {
        expect(await fear()).toBe(fearBefore - paid);
      }
      await undo(r);
      await expect.poll(fear).toBe(fearBefore);
    }
    expect(momentum, "the Elemental hit Mira at least once in eight attacks with advantage").toBe(true);

    // ---- 5. Group Attack: three Sellswords, one shared roll, 3 damage each combined (AR9, CB p.201).
    let grouped = false;
    for (let attempt = 0; attempt < 8 && !grouped; attempt += 1) {
      await gm.mutation(api.fear.set, { campaignId, value: 6, idempotencyKey: crypto.randomUUID() });
      const args = { campaignId, instanceId: sellswords[0]!, feature: "Group Attack", targets: [mira] };
      let r: ActionResult = await gm.mutation(api.adversaryActions.useFeature, { ...args, idempotencyKey: crypto.randomUUID() });
      if (r.status === "confirmFear") {
        expect(r.feature).toBe(1);
        r = await gm.mutation(api.adversaryActions.useFeature, { ...args, spendFear: r.fear, idempotencyKey: crypto.randomUUID() });
      }
      if (r.status !== "resolved") throw new Error("Group Attack not resolved");
      expect(r.roll?.dice.filter((d) => d.sides === 20)).toHaveLength(1);
      if (r.targets[0]!.hit) {
        grouped = true;
        const [hit] = await gm.query(api.adversaryActions.pending, { campaignId, characterId: mira });
        expect(hit?.damage).toBe(9);
        // Mira's player is asked about armor against the combined damage, without the roll (Q13, Q14).
        const win = a.page.getByRole("dialog", { name: "You were hit" });
        await expect(win).toContainText(/Sellsword.* hit Mira/, { timeout: 30_000 });
        await expect(win.getByTestId("hud-hit-damage")).toHaveText("9");
        await expect(win).not.toContainText(/\b(roll|Evasion|Difficulty|ATK)\b/i);
      }
      await undo(r);
    }
    expect(grouped, "the Sellswords hit Mira at least once in eight Group Attacks").toBe(true);
    await expect(a.page.getByTestId("hud-hit-window")).toHaveCount(0, { timeout: 30_000 });

    // ---- 6. Q14 / U1 over the network: nothing either player received carries an adversary's roll or numbers.
    for (const [who, player] of [
      ["Mira's player", a],
      ["Tabby's player", b],
    ] as const) {
      const { seen, leaks } = adversaryLeaks(player.frames, enemyIds);
      expect(seen, `${who}: adversary objects received`).toBeGreaterThan(0);
      expect(leaks, `${who}: adversary rolls or numbers in network responses`).toEqual([]);
    }
  } finally {
    await a.close();
    await b.close();
  }
});
