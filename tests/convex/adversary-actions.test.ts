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
    expect((await a.sheet()).conditions).toContain("restrained");
    const row = await a.request(r.targets[0]!.requestId!);
    expect(row.payload.kind === "incomingHit" && row.payload.attacker.feature).toBe("Bite");
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
    expect(await a.pending(a.player, a.w.characterA)).toEqual([]);
    expect((await a.respond(a.player, requestId, a.w.characterA, { kind: "noArmor" })).status).toBe("declined");
    expect((await a.request(requestId)).status).toBe("declined");
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
