/**
 * Adversary actions against PCs (plan combat-actions AA2): the standard attack and features, the reaction window (armor,
 * I Am Your Shield, the GM's "Resolve now"), spotlight and Fear (Q19), Momentum, undo, the encounter's end, the live map,
 * and what players receive (Q14: never the attack roll or an adversary's stats). Role checks:
 * adversary-actions-authz.test.ts and the matrix area tests/convex/authz/adversary-actions.entries.ts.
 *
 * Dice are the server's own. Ash and Bryn wear Chainmail (4 Armor Slots, thresholds 8 / 16 at level 1). An Evasion
 * effect of -10 makes every attack hit; a custom "Dummy" with ATK -10 rolling with disadvantage misses but on a double 20.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { openIncomingHit, partyMembers, seededRng } from "../../convex/lib/incomingHits";
import { pcSeverity, stepDown, hpForSeverity } from "../../src/lib/domain/adversary-actions/index";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

const ROLL_KEYS = ["roll", "dice", "total", "modifier", "evasion", "difficulty", "hp", "hpMax", "stress", "stressMax", "major", "severe", "thresholds", "adversaryBefore", "attackTotal"];
const NUMBERS = /\d/;

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
}

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };

async function arena(options: { map?: boolean } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const other = w.as("otherPlayer");
  const now = Date.now();
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>, id: Id<"characters"> = w.characterA) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(() => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, effects: [EASY] }), id);
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const dummyBlock = await t.run((ctx) =>
    ctx.db.insert("customAdversaries", {
      campaignId,
      name: "Dummy",
      tier: 1,
      type: "Standard",
      description: "",
      motives: "",
      difficulty: 10,
      thresholds: { major: 5, severe: 10 },
      hp: 4,
      stress: 2,
      attack: { modifier: -10, name: "Flail", range: "Melee", damage: "1d4 phy" },
      experiences: [],
      features: [{ name: "Taunt", kind: "action", text: "Spend a Fear to taunt a PC.", fearCost: 1 }],
      createdAt: now,
      updatedAt: now,
    }),
  );
  let order = 0;
  const adversary = (label: string, source: { kind: "srd"; adversaryId: string } | { kind: "custom"; customId: Id<"customAdversaries"> }, stats = { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 }) =>
    t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source,
        label,
        order: order++,
        summoned: false,
        stats,
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      }),
    );
  const bear = await adversary("Bear", { kind: "srd", adversaryId: "bear" });
  const dummy = await adversary("Dummy", { kind: "custom", customId: dummyBlock }, { difficulty: 10, major: 5, severe: 10, hpMax: 4, stressMax: 2 });
  let mapId: Id<"combatMaps"> | null = null;
  if (options.map) {
    mapId = (await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() })).mapId;
    const m = mapId;
    await t.run(async (ctx) => {
      const token = { campaignId, mapId: m, size: 1, light: "none" as const, revealedTo: [] };
      await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
      await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: bear }, side: "enemy", x: 6, y: 10, face: Math.PI });
    });
  }
  const sheet = (id: Id<"characters"> = w.characterA) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const setFear = (n: number) =>
    t.run(async (ctx) => {
      const s = await campaignFearState(ctx, campaignId);
      await ctx.db.patch(s._id, { fear: n });
    });
  const request = (id: Id<"combatRequests">) => t.run(async (ctx) => (await ctx.db.get("combatRequests", id))!);
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const feed = (c: Client) => c.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } });
  const attack = (instanceId: Id<"encounterAdversaries">, targets: string[], extra: Record<string, unknown> = {}) =>
    gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets, idempotencyKey: key(), ...extra });
  const feature = (instanceId: Id<"encounterAdversaries">, name: string, targets: string[], extra: Record<string, unknown> = {}) =>
    gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId, feature: name, targets, idempotencyKey: key(), ...extra });
  const respond = (c: Client, requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) =>
    c.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId, choice: choice as never, idempotencyKey: key() });
  const pending = (c: Client, characterId: Id<"characters">) => c.query(api.adversaryActions.pending, { campaignId, characterId });
  return { w, t, campaignId, gm, player, other, encounterId, bear, dummy, mapId, edit, sheet, instance, fear, setFear, request, rows, feed, attack, feature, respond, pending };
}

type Arena = Awaited<ReturnType<typeof arena>>;

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

/** The Bear attacks Ash (always a hit): the open hit's id and stored damage. */
async function bearHitsAsh(a: Arena) {
  const r = resolved(await a.attack(a.bear, [a.w.characterA]));
  const target = r.targets[0]!;
  expect(target.hit).toBe(true);
  const requestId = target.requestId!;
  const row = await a.request(requestId);
  if (row.payload.kind !== "incomingHit") throw new Error("expected an incoming hit");
  return { r, requestId, damage: row.payload.damage };
}

describe("adversaryActions.attack: the hit, armor and the rows", () => {
  allowWorldEmails();

  it("rolls against Evasion, opens a window, the hit PC marks an Armor Slot and the damage resolves one step lower (CB p.114)", async () => {
    const a = await arena();
    const fearBefore = await a.fear();
    const { r, requestId, damage } = await bearHitsAsh(a);
    expect(r.roll?.dice.some((d) => d.sides === 20)).toBe(true);
    expect(damage).toBeGreaterThanOrEqual(4);
    // Momentum (CB p.195): a successful attack gains a Fear at once (Q19); the turn's first spotlight is free.
    expect(await a.fear()).toBe(Math.min(12, fearBefore + 1));
    expect((await a.instance(a.bear)).spotlights).toBe(1);

    const [view] = await a.pending(a.player, a.w.characterA);
    const thresholds = derivedThresholds(await a.sheet());
    const severity = pcSeverity(damage, thresholds).severity;
    expect(view).toMatchObject({ requestId, role: "target", damage, severity, maxSlots: 1, awaiting: true, attackerLabel: "Bear" });
    expect(view!.armorPreview).toEqual([
      { slots: 0, severity, hp: hpForSeverity(severity) },
      { slots: 1, severity: stepDown(severity, 1), hp: hpForSeverity(stepDown(severity, 1)) },
    ]);

    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "armor" })).status).toBe("resolved");
    const after = await a.sheet();
    expect(after.armorMarked).toBe(1);
    expect(after.hp).toBe(hpForSeverity(stepDown(severity, 1)));
    expect((await a.request(requestId)).status).toBe("resolved");
    expect(await a.pending(a.player, a.w.characterA)).toEqual([]);
  });

  it("players get no roll, no damage and no stats: pending for an ally, the feed (Q14, U1)", async () => {
    const a = await arena();
    await a.edit(() => ({ domainCards: { owned: ["i-am-your-shield"], loadout: ["i-am-your-shield"] } }), a.w.characterB);
    const { requestId } = await bearHitsAsh(a);
    const [ally] = await a.pending(a.other, a.w.characterB);
    expect(ally).toMatchObject({ requestId, role: "ally", targetName: "Ash", cardIds: ["i-am-your-shield"] });
    expect(keysOf(ally).filter((k) => ["damage", "severity", "maxSlots", "armorPreview", ...ROLL_KEYS].includes(k))).toEqual([]);
    await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" });
    await a.respond(a.other, requestId, a.w.characterB, { kind: "pass" });
    const page = await a.feed(a.other);
    const mine = page.page.filter((row) => row.kind === "adversary");
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) {
      expect(keysOf(row).filter((k) => ROLL_KEYS.includes(k))).toEqual([]);
      expect(row.summary).not.toMatch(NUMBERS);
    }
    expect(mine.map((row) => row.summary)).toContain("Bear hit Ash");
    // The GM's row has the roll and the numbers.
    const gmRows = (await a.rows()).filter((row) => row.kind === "adversary" && row.visibility === "gm");
    expect(gmRows.some((row) => row.roll !== undefined && /Ash: \d+ physical/.test(row.summary))).toBe(true);
  });

  it("a miss opens nothing and says so publicly", async () => {
    const a = await arena();
    await a.edit(() => ({ effects: [] }));
    const r = resolved(await a.attack(a.dummy, [a.w.characterA], { disadvantage: 1 }));
    if (r.targets[0]!.hit) return; // a double natural 20 (1 in 400)
    expect(r.targets[0]!.requestId).toBeUndefined();
    expect((await a.rows()).some((row) => row.visibility === "public" && row.summary === "Dummy missed Ash")).toBe(true);
    expect(await a.pending(a.player, a.w.characterA)).toEqual([]);
  });

  it("a PC with no free Armor Slot and no card resolves at once", async () => {
    const a = await arena();
    await a.edit(() => ({ armorMarked: 4 }));
    const { r } = await (async () => ({ r: resolved(await a.attack(a.bear, [a.w.characterA])) }))();
    expect(r.targets[0]!.resolved).toBe(true);
    expect((await a.sheet()).hp).toBeGreaterThan(0);
  });
});

describe("adversaryActions: spotlight and Fear (Q19)", () => {
  allowWorldEmails();

  it("a second adversary's spotlight asks for 1 Fear, then spends it; without Fear NOT_ENOUGH_FEAR", async () => {
    const a = await arena();
    await a.setFear(1);
    await bearHitsAsh(a);
    const fearAfterBear = await a.fear(); // 2: Momentum
    const ask = await a.attack(a.dummy, [a.w.characterA]);
    expect(ask).toEqual({ status: "confirmFear", fear: 1, spotlight: 1, feature: 0, experience: 0 });
    expect((await a.instance(a.dummy)).spotlights).toBe(0);
    resolved(await a.attack(a.dummy, [a.w.characterA], { spendFear: 1 }));
    expect(await a.fear()).toBe(fearAfterBear - 1);
    // The Dummy is spotlit now: its next action this turn costs nothing.
    resolved(await a.attack(a.dummy, [a.w.characterA]));

    const b = await arena();
    await b.setFear(0);
    await b.attack(b.dummy, [b.w.characterA], { disadvantage: 1 });
    await b.setFear(0);
    expect(await code(b.attack(b.bear, [b.w.characterA], { spendFear: 1 }))).toBe("NOT_ENOUGH_FEAR");
  });

  it("an Experience costs 1 Fear and is asked first (CB p.160)", async () => {
    const a = await arena();
    await a.setFear(3);
    expect(await a.attack(a.bear, [a.w.characterA], { experience: "Ambusher" })).toMatchObject({ status: "confirmFear", fear: 1, experience: 1 });
    expect(await code(a.attack(a.bear, [a.w.characterA], { experience: "Nope", spendFear: 1 }))).toBe("INVALID");
    resolved(await a.attack(a.bear, [a.w.characterA], { experience: "Ambusher", spendFear: 1 }));
    expect(await a.fear()).toBe(3); // -1 Experience, +1 Momentum
  });

  it("a feature without an effect entry is a manual prompt with its Fear paid (custom block)", async () => {
    const a = await arena();
    await a.setFear(2);
    expect(await a.feature(a.dummy, "Taunt", [a.w.characterA])).toMatchObject({ status: "confirmFear", fear: 1, feature: 1 });
    const r = resolved(await a.feature(a.dummy, "Taunt", [a.w.characterA], { spendFear: 1 }));
    expect(r.prompts).toEqual([{ kind: "manual", text: "Taunt: Spend a Fear to taunt a PC." }]);
    expect(await a.fear()).toBe(1);
    expect(await code(a.feature(a.dummy, "Nonexistent", []))).toBe("ADVERSARY_FEATURE_UNAVAILABLE");
  });
});

describe("adversaryActions.useFeature", () => {
  allowWorldEmails();

  it("Bite: marks a Stress on the Bear, hits Ash, Restrains them and opens a window", async () => {
    const a = await arena();
    const r = resolved(await a.feature(a.bear, "Bite", [a.w.characterA]));
    expect((await a.instance(a.bear)).stress).toBe(1);
    expect(r.targets[0]).toMatchObject({ characterId: a.w.characterA, hit: true });
    // AA2b: Restrained rides with the hit and lands when it resolves on whoever takes it.
    expect((await a.sheet()).conditions).not.toContain("restrained");
    const row = await a.request(r.targets[0]!.requestId!);
    expect(row.payload.kind === "incomingHit" && row.payload.attacker.feature).toBe("Bite");
    expect(row.payload.kind === "incomingHit" && row.payload.riders).toEqual([{ kind: "condition", condition: "restrained" }]);
    await a.respond(a.player, r.targets[0]!.requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet()).conditions).toContain("restrained");
    // A defeated adversary can't act.
    await a.t.run((ctx) => ctx.db.patch(a.bear, { defeated: true }));
    expect(await code(a.feature(a.bear, "Bite", [a.w.characterA]))).toBe("ADVERSARY_FEATURE_UNAVAILABLE");
  });
});

describe("adversaryActions: the reaction window", () => {
  allowWorldEmails();

  it("I Am Your Shield (CB p.341): Bryn marks a Stress, takes the hit and marks two Armor Slots", async () => {
    const a = await arena();
    await a.edit(() => ({ domainCards: { owned: ["i-am-your-shield"], loadout: ["i-am-your-shield"] } }), a.w.characterB);
    const { requestId, damage } = await bearHitsAsh(a);
    const row = await a.request(requestId);
    expect(row.payload.kind === "incomingHit" && row.payload.responders).toEqual([
      { characterId: a.w.characterA, role: "target", cardIds: [] },
      { characterId: a.w.characterB, role: "ally", cardIds: ["i-am-your-shield"] },
    ]);
    // Not offered to Ash; a stranger to the window is refused.
    expect(await code(a.respond(a.player, requestId, a.w.characterA, { kind: "card", cardId: "i-am-your-shield" }))).toBe("NOT_A_RESPONDER");
    expect((await a.respond(a.other, requestId, a.w.characterB, { kind: "card", cardId: "i-am-your-shield" })).status).toBe("open");
    expect((await a.sheet(a.w.characterB)).stress).toBe(1);
    // Ash is released: their answer is refused now.
    expect(await code(a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" }))).toBe("NOT_A_RESPONDER");
    const [view] = await a.pending(a.other, a.w.characterB);
    expect(view).toMatchObject({ role: "target", damage, maxSlots: 4 });
    expect(await code(a.respond(a.other, requestId, a.w.characterB, { kind: "armor", slots: 5 }))).toBe("INVALID");
    expect((await a.respond(a.other, requestId, a.w.characterB, { kind: "armor", slots: 2 })).status).toBe("resolved");
    const bryn = await a.sheet(a.w.characterB);
    const severity = stepDown(pcSeverity(damage, derivedThresholds(bryn)).severity, 2);
    // Any number of slots (CB p.341): both are marked, each one step (AA1's applyHitToPc).
    expect(bryn.armorMarked).toBe(2);
    expect(bryn.hp).toBe(hpForSeverity(severity));
    expect((await a.sheet()).hp).toBe(0);
    expect(await code(a.respond(a.other, requestId, a.w.characterB, { kind: "pass" }))).toBe("REQUEST_NOT_OPEN");
  });

  it("Shrug It Off (CB p.342): the hit PC plays it before answering armor; one step less, its Stress paid, maybe to the vault", async () => {
    const a = await arena();
    await a.edit(() => ({ domainCards: { owned: ["shrug-it-off"], loadout: ["shrug-it-off"] } }));
    const { requestId, damage } = await bearHitsAsh(a);
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view!.cardIds).toEqual(["shrug-it-off"]);
    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "card", cardId: "shrug-it-off" })).status).toBe("open");
    const paid = await a.sheet();
    expect(paid.stress).toBe(1);
    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" })).status).toBe("resolved");
    const severity = stepDown(pcSeverity(damage, derivedThresholds(paid)).severity, 1);
    expect((await a.sheet()).hp).toBe(hpForSeverity(severity));
    expect((await a.sheet()).armorMarked).toBe(0);
  });

  it("the GM's Resolve now: no answer means no armor (Q17)", async () => {
    const a = await arena();
    const { requestId, damage } = await bearHitsAsh(a);
    const r = await a.gm.mutation(api.adversaryActions.resolve, { campaignId: a.campaignId, requestId, idempotencyKey: key() });
    const severity = pcSeverity(damage, derivedThresholds(await a.sheet())).severity;
    expect(r).toMatchObject({ status: "resolved", targetId: a.w.characterA, severity, hpMarked: hpForSeverity(severity) });
    expect((await a.sheet()).armorMarked).toBe(0);
    const windows = await a.gm.query(api.adversaryActions.windows, { campaignId: a.campaignId });
    expect(windows).toEqual([]);
  });

  it("the GM sees open windows and who still has to answer", async () => {
    const a = await arena();
    const { requestId, damage } = await bearHitsAsh(a);
    const [win] = await a.gm.query(api.adversaryActions.windows, { campaignId: a.campaignId });
    expect(win).toMatchObject({ requestId, attackerLabel: "Bear", damage, targetName: "Ash", awaiting: [{ characterId: a.w.characterA, name: "Ash", role: "target" }] });
  });
});

describe("adversaryActions: undo and the encounter's end", () => {
  allowWorldEmails();

  it("the GM's undo restores the PC's sheet, the Bear's Stress and the Fear (U4)", async () => {
    const a = await arena();
    await a.setFear(2);
    const r = resolved(await a.feature(a.bear, "Bite", [a.w.characterA]));
    await a.respond(a.player, r.targets[0]!.requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet()).hp).toBeGreaterThan(0);
    // A player can't undo it (the rows' actor is the GM).
    expect(await code(a.player.mutation(api.actionLog.undo, { entryId: (await a.rows()).find((x) => x.characterId === a.w.characterA && x.visibility === "public")!._id, idempotencyKey: key() }))).toBe("FORBIDDEN");
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    const s = await a.sheet();
    expect(s.hp).toBe(0);
    expect(s.conditions).not.toContain("restrained");
    expect((await a.instance(a.bear)).stress).toBe(0);
    expect(await a.fear()).toBe(2);
  });

  it("undoing an action with an open hit declines the hit", async () => {
    const a = await arena();
    const { r, requestId } = await bearHitsAsh(a);
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    // AA2b: undo declines the group's open hit at once.
    expect((await a.request(requestId)).status).toBe("declined");
    expect(await a.pending(a.player, a.w.characterA)).toEqual([]);
    expect(await code(a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" }))).toBe("REQUEST_NOT_OPEN");
    expect((await a.sheet()).hp).toBe(0);
  });

  it("ending the encounter declines its open hits", async () => {
    const a = await arena();
    const { requestId } = await bearHitsAsh(a);
    await a.gm.mutation(api.encounters.end, { campaignId: a.campaignId, encounterId: a.encounterId });
    expect((await a.request(requestId)).status).toBe("declined");
    expect(await code(a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" }))).toBe("REQUEST_NOT_OPEN");
    expect(await code(a.attack(a.bear, [a.w.characterA]))).toBe("ENCOUNTER_NOT_RUNNING");
  });
});

describe("adversaryActions: the live map (Q2, Q18)", () => {
  allowWorldEmails();

  it("targets PC tokens; a character without a token is refused; the hit row names the token", async () => {
    const a = await arena({ map: true });
    const tokens = await a.gm.query(api.combatTokens.list, { campaignId: a.campaignId, mapId: a.mapId! });
    const ash = tokens.find((t) => t.characterId === a.w.characterA)!._id;
    const r = resolved(await a.attack(a.bear, [ash]));
    expect(r.targets[0]).toMatchObject({ characterId: a.w.characterA, hit: true });
    const row = await a.request(r.targets[0]!.requestId!);
    expect(row.mapId).toBe(a.mapId);
    expect(row.payload.kind === "incomingHit" && row.payload.targetTokenId).toBe(ash);
    expect(await code(a.attack(a.bear, [a.w.characterB]))).toBe("COMBAT_TARGET_INVALID");
  });

  it("without a token of its own the adversary targets the party list (Q18)", async () => {
    const a = await arena({ map: true });
    resolved(await a.attack(a.dummy, [a.w.characterB], { disadvantage: 1 }));
  });
});

describe("AA2b: death move, riders, after-hit cards, scene limits", () => {
  allowWorldEmails();

  /** Ash one HP from their last (any Bear hit marks at least one). */
  const nearDeath = (a: Arena) => a.edit((s) => ({ hp: s.hpMax - 1 }));

  it("a hit that marks the last HP makes the death move due at once (user answer 2026-10-22; CB p.91)", async () => {
    const a = await arena();
    await nearDeath(a);
    await a.t.run((ctx) => ctx.db.patch(a.w.characterA, { deathMoveSpent: true }));
    const { requestId } = await bearHitsAsh(a);
    const answer = await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" });
    expect(answer).toMatchObject({ status: "resolved", deathMove: true });
    const s = await a.sheet();
    expect(s.hp).toBe(s.hpMax);
    expect((await a.t.run((ctx) => ctx.db.get("characters", a.w.characterA)))!.deathMoveSpent).toBeUndefined();
    // The sheet's existing death-move flow takes over.
    expect((await a.player.query(api.deathMoves.state, { characterId: a.w.characterA })).awaitingMove).toBe(true);
    const pub = (await a.rows()).find((row) => row.visibility === "public" && row.summary.startsWith("Ash took Bear's hit"))!;
    expect(pub.summary).toContain("must make a death move");
  });

  it("I Am Your Shield: Bite's Restrained moves with the damage to Bryn (user answer 2026-10-22)", async () => {
    const a = await arena();
    await a.edit(() => ({ domainCards: { owned: ["i-am-your-shield"], loadout: ["i-am-your-shield"] } }), a.w.characterB);
    const r = resolved(await a.feature(a.bear, "Bite", [a.w.characterA]));
    const requestId = r.targets[0]!.requestId!;
    expect((await a.respond(a.other, requestId, a.w.characterB, { kind: "card", cardId: "i-am-your-shield" })).status).toBe("open");
    // The played card isn't offered again; Bryn's line names who was hit first.
    const [bryn] = await a.pending(a.other, a.w.characterB);
    expect(bryn).toMatchObject({ requestId, role: "target", targetName: "Bryn", originalTargetName: "Ash", cardIds: [] });
    const [ash] = await a.pending(a.player, a.w.characterA);
    expect(ash).toMatchObject({ role: "ally", targetName: "Bryn", originalTargetName: "Ash", awaiting: false });
    expect((await a.respond(a.other, requestId, a.w.characterB, { kind: "armor", slots: 1 })).status).toBe("resolved");
    expect((await a.sheet(a.w.characterB)).conditions).toContain("restrained");
    expect((await a.sheet()).conditions).not.toContain("restrained");
  });

  it("Bold Presence (CB p.341): the hit PC avoids Bite's Restrained in the window", async () => {
    const a = await arena();
    await a.edit(() => ({ domainCards: { owned: ["bold-presence"], loadout: ["bold-presence"] } }));
    const r = resolved(await a.feature(a.bear, "Bite", [a.w.characterA]));
    const requestId = r.targets[0]!.requestId!;
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view!.cardIds).toEqual(["bold-presence"]);
    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "card", cardId: "bold-presence", useId: "condition" })).status).toBe("open");
    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" })).status).toBe("resolved");
    const s = await a.sheet();
    expect(s.conditions).not.toContain("restrained");
    expect(s.hp).toBeGreaterThan(0);
    expect(s.featureUses.some((u) => u.key.startsWith("card:bold-presence"))).toBe(true);
  });

  it("Unbreakable (CB p.342) is offered after the hit marks the last HP: the row waits for it; using it clears HP and vaults the card", async () => {
    const a = await arena();
    await a.edit((s) => ({ hp: s.hpMax - 1, domainCards: { owned: ["unbreakable"], loadout: ["unbreakable"] } }));
    const { requestId } = await bearHitsAsh(a);
    expect(await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" })).toMatchObject({ status: "resolved", deathMove: true, afterHit: true });
    expect((await a.request(requestId)).status).toBe("open");
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view).toMatchObject({ requestId, afterHit: true, deathMove: true, cardIds: ["unbreakable"], role: "target", awaiting: true });
    expect(view!.damage).toBeUndefined();
    const windows = await a.gm.query(api.adversaryActions.windows, { campaignId: a.campaignId });
    expect(windows[0]).toMatchObject({ requestId, afterHit: true, awaiting: [{ characterId: a.w.characterA, role: "target" }] });
    // Only Ash answers it.
    expect(await code(a.respond(a.other, requestId, a.w.characterB, { kind: "pass" }))).toBe("NOT_A_RESPONDER");
    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "card", cardId: "unbreakable" })).status).toBe("resolved");
    const s = await a.sheet();
    expect(s.hp).toBeLessThan(s.hpMax);
    expect(s.domainCards.loadout).not.toContain("unbreakable");
    expect((await a.request(requestId)).status).toBe("resolved");
    expect(await a.pending(a.player, a.w.characterA)).toEqual([]);
  });

  it("the GM's Resolve now passes an after-hit offer; undo declines an open one", async () => {
    const a = await arena();
    await a.edit((s) => ({ hp: s.hpMax - 1, domainCards: { owned: ["unbreakable"], loadout: ["unbreakable"] } }));
    const first = await bearHitsAsh(a);
    await a.respond(a.player, first.requestId, a.w.characterA, { kind: "noArmor" });
    const r = await a.gm.mutation(api.adversaryActions.resolve, { campaignId: a.campaignId, requestId: first.requestId, idempotencyKey: key() });
    expect(r).toMatchObject({ status: "resolved", deathMove: true, targetId: a.w.characterA });
    expect((await a.request(first.requestId)).status).toBe("resolved");

    const b = await arena();
    await b.edit((s) => ({ hp: s.hpMax - 1, domainCards: { owned: ["unbreakable"], loadout: ["unbreakable"] } }));
    const second = await bearHitsAsh(b);
    await b.respond(b.player, second.requestId, b.w.characterA, { kind: "noArmor" });
    await b.gm.mutation(api.actionLog.undo, { entryId: second.r.entryId, idempotencyKey: key() });
    expect((await b.request(second.requestId)).status).toBe("declined");
  });

  it("Rise Up's automatic use (CB p.341) clears a Stress when the hit marks HP", async () => {
    const a = await arena();
    await a.edit(() => ({ stress: 2, domainCards: { owned: ["rise-up"], loadout: ["rise-up"] } }));
    const { requestId } = await bearHitsAsh(a);
    await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" });
    const s = await a.sheet();
    expect(s.hp).toBeGreaterThan(0);
    expect(s.stress).toBe(1);
    expect((await a.rows()).some((row) => row.visibility === "public" && row.summary.includes("(Rise Up)"))).toBe(true);
  });

  it("a once-per-scene feature is refused the second time and comes back when the encounter runs again", async () => {
    const a = await arena();
    const now = Date.now();
    const captain = await a.t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId: a.campaignId,
        encounterId: a.encounterId,
        source: { kind: "srd", adversaryId: "pirate-captain" },
        label: "Captain",
        order: 9,
        summoned: false,
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 5 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      }),
    );
    const first = resolved(await a.feature(captain, "Reinforcements", []));
    expect(first.prompts.some((p) => p.kind === "summon")).toBe(true);
    expect((await a.instance(captain)).featureUses).toHaveLength(1);
    expect(await code(a.feature(captain, "Reinforcements", []))).toBe("ADVERSARY_FEATURE_UNAVAILABLE");
    // Ending the encounter ends the scene: started again, the limit is back.
    await a.gm.mutation(api.encounters.end, { campaignId: a.campaignId, encounterId: a.encounterId });
    await a.t.run((ctx) => ctx.db.patch(a.encounterId, { status: "running", startedAt: now + 1000 }));
    resolved(await a.feature(captain, "Reinforcements", [], { spendFear: 1 }));
  });
});

describe("AA2c: riders on a negated hit, session limits, undo of limits, reflected damage, featureAsk", () => {
  allowWorldEmails();

  /** An SRD adversary added to the arena's running encounter. */
  const addAdversary = (a: Arena, adversaryId: string, label: string, stressMax = 5) =>
    a.t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId: a.campaignId,
        encounterId: a.encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order: 10,
        summoned: false,
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: Date.now(),
      }),
    );
  const setSession = (a: Arena, startedAt: number | undefined) =>
    a.t.run(async (ctx) => {
      const s = await campaignFearState(ctx, a.campaignId);
      await ctx.db.patch(s._id, { sessionStartedAt: startedAt });
    });
  const restartEncounter = async (a: Arena, at: number) => {
    await a.gm.mutation(api.encounters.end, { campaignId: a.campaignId, encounterId: a.encounterId });
    await a.t.run((ctx) => ctx.db.patch(a.encounterId, { status: "running", startedAt: at }));
  };
  const ask = (a: Arena, instanceId: Id<"encounterAdversaries">, feature: string, use?: string) =>
    a.gm.query(api.adversaryActions.featureAsk, { campaignId: a.campaignId, instanceId, feature, ...(use ? { use } : {}) });
  const groupOf = async (a: Arena, id: Id<"combatRequests">) => {
    const row = await a.request(id);
    return row.payload.kind === "incomingHit" ? row.payload.groupId : null;
  };

  it("riders land when only the damage was negated: Arcane Deflection stops Bite's damage, not its Restrained (user answer 2026-10-22)", async () => {
    const a = await arena();
    await a.edit(() => ({ hope: 2, domainCards: { owned: ["book-of-grynn"], loadout: ["book-of-grynn"] } }));
    const r = resolved(await a.feature(a.bear, "Bite", [a.w.characterA]));
    const requestId = r.targets[0]!.requestId!;
    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "card", cardId: "book-of-grynn", useId: "arcane-deflection" })).status).toBe("open");
    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" })).status).toBe("resolved");
    const s = await a.sheet();
    expect(s.hp).toBe(0);
    expect(s.conditions).toContain("restrained");
    expect((await a.rows()).some((row) => row.visibility === "public" && row.summary === "Ash took no damage from Bear's hit")).toBe(true);
  });

  it("a full avoidance stops the riders: Scramble avoids Bite, so no Restrained", async () => {
    const a = await arena();
    await a.edit(() => ({ domainCards: { owned: ["scramble"], loadout: ["scramble"] } }));
    const r = resolved(await a.feature(a.bear, "Bite", [a.w.characterA]));
    const requestId = r.targets[0]!.requestId!;
    await a.respond(a.player, requestId, a.w.characterA, { kind: "card", cardId: "scramble" });
    if ((await a.request(requestId)).status === "open") await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" });
    expect((await a.request(requestId)).status).toBe("resolved");
    const s = await a.sheet();
    expect(s.hp).toBe(0);
    expect(s.conditions).not.toContain("restrained");
    expect((await a.rows()).some((row) => row.visibility === "public" && row.summary === "Ash avoided Bear's hit")).toBe(true);
  });

  it("a once-per-session feature stays spent across encounter runs until the session ends (user answer 2026-10-22)", async () => {
    const a = await arena();
    await a.setFear(12);
    const now = Date.now();
    await setSession(a, now - 5000);
    const oracle = await addAdversary(a, "oracle-of-doom", "Oracle");
    resolved(await a.feature(oracle, "Summon Tormentors", [a.w.characterA], { spendFear: 3 }));
    expect((await a.instance(oracle)).featureUses).toEqual([expect.objectContaining({ session: now - 5000 })]);
    expect(await code(a.feature(oracle, "Summon Tormentors", [a.w.characterA], { spendFear: 3 }))).toBe("ADVERSARY_FEATURE_UNAVAILABLE");
    // A new run of the encounter is a new scene, not a new session.
    await restartEncounter(a, now + 1000);
    expect(await code(a.feature(oracle, "Summon Tormentors", [a.w.characterA], { spendFear: 3 }))).toBe("ADVERSARY_FEATURE_UNAVAILABLE");
    expect(await ask(a, oracle, "Summon Tormentors")).toMatchObject({ available: false, unavailable: ["Used up this session"] });
    // The session ends (sessions.end clears sessionStartedAt): the feature is back.
    await setSession(a, undefined);
    expect((await ask(a, oracle, "Summon Tormentors")).available).toBe(true);
    resolved(await a.feature(oracle, "Summon Tormentors", [a.w.characterA], { spendFear: 3 }));
  });

  it("the GM's undo gives an instance's limited use back (adversaryBefore.featureUses)", async () => {
    const a = await arena();
    const captain = await addAdversary(a, "pirate-captain", "Captain");
    const first = resolved(await a.feature(captain, "Reinforcements", []));
    expect((await a.instance(captain)).featureUses).toHaveLength(1);
    const gmRow = (await a.rows()).find((row) => row._id === first.entryId)!;
    expect(gmRow.adversaryBefore?.[0]).toMatchObject({ instanceId: captain, featureUses: [] });
    await a.gm.mutation(api.actionLog.undo, { entryId: first.entryId, idempotencyKey: key() });
    expect((await a.instance(captain)).featureUses).toBeUndefined();
    resolved(await a.feature(captain, "Reinforcements", []));
  });

  it("damage reflected at a PC attacker opens an incoming hit on that PC (user answer 2026-10-22)", async () => {
    const a = await arena();
    await a.edit(() => ({ hope: 3, domainCards: { owned: ["arcane-reflection"], loadout: ["arcane-reflection"] } }));
    // Bryn's card catches Ash for 6 magic damage; find a row whose seeded d6 for Arcane Reflection is a 6.
    let requestId: Id<"combatRequests"> | null = null;
    for (let i = 0; i < 80 && requestId === null; i++) {
      const opened = await a.t.run(async (ctx) =>
        openIncomingHit(ctx, {
          campaignId: a.campaignId,
          encounterId: a.encounterId,
          createdBy: a.w.users.gm,
          groupId: `card-group-${i}`,
          attacker: { kind: "pc", characterId: a.w.characterB, label: "Bryn", cardId: "chain-lightning" },
          targetCharacterId: a.w.characterA,
          hit: { amount: 6, type: "magic", direct: false, forcedArmor: 0, critical: false },
          party: await partyMembers(ctx, a.campaignId),
          bands: () => undefined,
        }),
      );
      if (seededRng(`${opened.requestId}:0`)(6) === 6) requestId = opened.requestId;
      else await a.t.run((ctx) => ctx.db.patch(opened.requestId, { status: "declined" }));
    }
    expect(requestId).not.toBeNull();
    const id = requestId!;
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view!.cardIds).toContain("arcane-reflection");
    await a.respond(a.player, id, a.w.characterA, { kind: "card", cardId: "arcane-reflection" });
    if ((await a.request(id)).status === "open") await a.respond(a.player, id, a.w.characterA, { kind: "noArmor" });
    expect((await a.request(id)).status).toBe("resolved");
    expect((await a.sheet()).hp).toBe(0);
    // Bryn now has the normal incoming-hit prompt, from Ash's Arcane Reflection, in the same group.
    const [bryn] = await a.pending(a.other, a.w.characterB);
    expect(bryn).toMatchObject({ role: "target", targetCharacterId: a.w.characterB, attackerLabel: "Ash", damage: 6, awaiting: true });
    const reflected = await a.request(bryn!.requestId);
    expect(reflected.payload.kind === "incomingHit" && reflected.payload.attacker).toMatchObject({ kind: "pc", characterId: a.w.characterA, cardId: "arcane-reflection" });
    expect(await groupOf(a, bryn!.requestId)).toBe(await groupOf(a, id));
    expect((await a.respond(a.other, bryn!.requestId, a.w.characterB, { kind: "noArmor" })).status).toBe("resolved");
    expect((await a.sheet(a.w.characterB)).hp).toBeGreaterThan(0);
  });

  it("featureAsk: an attack with a Stress cost and its target; nothing written", async () => {
    const a = await arena();
    const before = await a.rows();
    const bite = await ask(a, a.bear, "Bite");
    expect(bite).toMatchObject({
      feature: "Bite",
      useId: "main",
      automated: true,
      activation: "action",
      needsSpotlight: true,
      available: true,
      attack: true,
      targets: { side: "enemy", range: "melee", count: "one", max: 1 },
      picked: null,
      allies: null,
      options: [],
      optionals: [],
      splits: [],
      eitherCosts: [],
      stress: 1,
      fear: { total: 0, spotlight: 0, feature: 0, perTrigger: false },
    });
    expect(await a.rows()).toHaveLength(before.length);
  });

  it("featureAsk: optional steps with their Fear, choose options, a situation trigger, either costs, the spotlight's Fear, a used-up limit, a manual feature", async () => {
    const a = await arena();
    await a.setFear(5);
    const defender = await addAdversary(a, "deeproot-defender", "Defender");
    expect((await ask(a, defender, "Grab and Drag")).optionals).toEqual([{ id: "drag", label: expect.any(String), fear: 1, stress: 0 }]);

    const elemental = await addAdversary(a, "minor-fire-elemental", "Elemental");
    const kindling = await ask(a, elemental, "Consume Kindling");
    expect(kindling).toMatchObject({ activation: "reaction", needsSpotlight: false, trigger: { kind: "situation", text: "The Elemental moves onto highly flammable objects" } });
    expect(kindling.options).toEqual([{ id: "consume", label: "Clear a HP or a Stress", count: 1, distinct: false, options: [{ id: "hp", label: "Clear a HP" }, { id: "stress", label: "Clear a Stress" }] }]);

    const monarch = await addAdversary(a, "monarch", "Monarch");
    const execute = await ask(a, monarch, "Execute Them!");
    expect(execute.eitherCosts).toHaveLength(1);
    expect(execute.eitherCosts[0]!.options).toHaveLength(12);
    expect(execute.eitherCosts[0]!.options[3]).toMatchObject({ index: 3, fear: 4, label: "4 Fear" });
    // Nobody is spotlit yet: the first option's 1 Fear only.
    expect(execute.fear).toMatchObject({ feature: 1, spotlight: 0, total: 1, gmFear: 5, enough: true });

    // A second adversary spotlit in the GM turn costs a Fear (CB p.153).
    resolved(await a.attack(a.bear, [a.w.characterA]));
    expect((await ask(a, monarch, "Execute Them!")).fear).toMatchObject({ spotlight: 1, total: 2 });

    const captain = await addAdversary(a, "pirate-captain", "Captain");
    resolved(await a.feature(captain, "Reinforcements", [], { spendFear: 1 }));
    expect(await ask(a, captain, "Reinforcements")).toMatchObject({ available: false, unavailable: ["Used up this scene"] });

    expect(await ask(a, a.dummy, "Taunt")).toMatchObject({ automated: false, text: "Spend a Fear to taunt a PC.", activation: "action", fear: { feature: 1 } });
    // A passive has no use to run (as useFeature).
    const ogre = await addAdversary(a, "cave-ogre", "Ogre");
    expect(await code(ask(a, ogre, "Bone Breaker"))).toBe("ADVERSARY_FEATURE_UNAVAILABLE");
    expect(await code(ask(a, a.bear, "No Such Feature"))).toBe("ADVERSARY_FEATURE_UNAVAILABLE");
  });
});
