/**
 * Plan lanes-2 wave 10, E1.4b (docs/tasks/TASK-LN4-E1B.md): the attack and roll paths through the real mutations.
 *
 * Book texts:
 * - CB p.104: "you only make one attack roll and compare its result to the Difficulty of each eligible target"; Vulnerable
 *   (CB p.102): "all rolls targeting them have advantage". User answer 2026-11-01: one d6, per target.
 * - Beguiled (Tentacle Rays, HF p.75): "a Beguiled PC must mark a Stress or attack a target chosen by the Gobstalker". User
 *   answer 2026-10-31: a roll request opens the player's attack with the target locked.
 * - Venomous Stinger (CB p.211): "While Poisoned, the target must roll a d6 before they make an action roll. On a result of
 *   4 or lower, they must mark a Stress." User answer 2026-10-31: bearer riders run automatically.
 * - Spirit Weapon (CB p.44): "You can mark a Stress to target an additional adversary within range with the same attack roll."
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

/** The server's dice show `values` in turn while the test runs. */
function serverDice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const { encounterId, tokenA } = await t.run(async (ctx) => {
    const tokenA = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { encounterId, tokenA };
  });
  let order = 0;
  const enemy = async (label: string, extra: { conditions?: string[]; tags?: string[]; x?: number; difficulty?: number } = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: extra.difficulty ?? 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: (extra.conditions ?? []) as never,
        tags: extra.tags ?? [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: extra.x ?? 6, y: 10, face: Math.PI });
      return { instanceId, tokenId };
    });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch(s) });
    });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const attack = (c: Client, targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    c.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], ...extra, idempotencyKey: key() } as never);
  const forcedRow = (targetTokenIds: Id<"combatTokens">[], characterId: Id<"characters"> = w.characterA, instanceId?: Id<"encounterAdversaries">) =>
    t.run(async (ctx) => {
      const inst = instanceId ?? (await ctx.db.query("encounterAdversaries").first())!._id;
      return ctx.db.insert("combatRequests", {
        campaignId,
        encounterId,
        mapId,
        createdBy: w.users.gm,
        status: "open",
        createdAt: Date.now(),
        responses: [],
        kind: "forcedAttack",
        payload: { schemaVersion: 1, kind: "forcedAttack", characterId, instanceId: inst, instanceLabel: "Gobstalker", feature: "Beguile", targetTokenIds, groupId: "group-forcing-use" },
      });
    });
  return { w, t, gm, player, mapId, encounterId, tokenA, enemy, sheet, edit, rows, attack, forcedRow };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

describe("dcm-uxsd: a forced PC attack opens the player's attack with the target locked", () => {
  it("the player sees the request; the attack with it resolves the request in the forcing use's group", async () => {
    const a = await arena();
    const victim = await a.enemy("Ogre");
    const other = await a.enemy("Imp", { x: 4 });
    const requestId = await a.forcedRow([victim.tokenId]);
    const seen = await a.player.query(api.combatRequests.forcedAttacks, { campaignId: a.w.campaignId });
    expect(seen).toMatchObject([{ requestId, characterId: a.w.characterA, instanceLabel: "Gobstalker", feature: "Beguile", targets: [{ tokenId: victim.tokenId, name: "Ogre" }] }]);
    // Another player's character's request isn't theirs to see.
    expect(await a.w.as("otherPlayer").query(api.combatRequests.forcedAttacks, { campaignId: a.w.campaignId })).toEqual([]);

    // A changed target is refused.
    await expect(a.attack(a.player, [other.tokenId], { forcedRequestId: requestId })).rejects.toSatisfy((e) => errorCode(e) === "INVALID");
    serverDice(6, 3);
    const r = resolved(await a.attack(a.player, [victim.tokenId], { forcedRequestId: requestId }));
    expect(r.targets.map((x) => x.tokenId)).toEqual([victim.tokenId]);
    const row = await a.t.run((ctx) => ctx.db.get("combatRequests", requestId));
    expect(row!.status).toBe("resolved");
    const entry = await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId));
    expect(entry!.groupId).toBe("group-forcing-use");
    // Answered: a second attack with it is REQUEST_NOT_OPEN.
    await expect(a.attack(a.player, [victim.tokenId], { forcedRequestId: requestId })).rejects.toSatisfy((e) => errorCode(e) === "REQUEST_NOT_OPEN");
  });

  it("another character's request is INVALID; an out-of-range locked target needs no sanction", async () => {
    const a = await arena();
    const far = await a.enemy("Archer", { x: 20 });
    const theirs = await a.forcedRow([far.tokenId], a.w.characterB);
    await expect(a.attack(a.player, [far.tokenId], { forcedRequestId: theirs })).rejects.toSatisfy((e) => errorCode(e) === "INVALID");
    const mine = await a.forcedRow([far.tokenId]);
    serverDice(6, 3);
    expect((await a.attack(a.player, [far.tokenId], { forcedRequestId: mine })).status).toBe("resolved");
    // Without the request the same target goes to the GM.
    expect((await a.attack(a.player, [far.tokenId])).status).toBe("pending");
  });
});

describe("dcm-svux: several targets, each with its own edge (CB p.104, p.100)", () => {
  it("a Vulnerable target and a plain one: one roll, the d6 counts against the Vulnerable one only", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "seraph", subclassId: "divine-wielder", subclassRank: "foundation", primaryWeaponId: "broadsword" }) as Partial<CharacterSheet>);
    const open = await a.enemy("Brute", { conditions: ["vulnerable"], difficulty: 30 });
    const plain = await a.enemy("Imp", { x: 6, difficulty: 30 });
    await a.t.run(async (ctx) => ctx.db.patch(plain.tokenId, { y: 11 }));
    serverDice(6, 3);
    const r = resolved(await a.attack(a.player, [open.tokenId, plain.tokenId], { spiritWeapon: true }));
    // The roll itself has no advantage die: it is compared per target.
    expect(r.roll.dice.map((d) => d.role)).not.toContain("advantage");
    const pub = (await a.rows()).find((x) => x._id === r.entryId)!;
    expect(pub.summary).toMatch(/\[edge d6 6: Brute \d+, Imp \d+\]/);
    const totals = /Brute (\d+), Imp (\d+)/.exec(pub.summary)!;
    expect(Number(totals[1]) - Number(totals[2])).toBe(6);
  });
});

describe("dcm-l1er: a bearer's riders run on their own roll (Poisoned, CB p.211)", () => {
  const poisoned: Effect = { id: "card:giant-scorpion/Venomous Stinger:1", source: "Giant Scorpion", text: "Poisoned", until: "rest" };

  it("a Poisoned PC's action roll rolls the d6 first and marks a Stress on 4 or lower, in the roll's row", async () => {
    const a = await arena();
    await a.edit(() => ({ effects: [poisoned], stress: 0 }));
    // The d6 first (3), then Hope 6 / Fear 2 (no critical, which would clear the Stress again).
    serverDice(3, 6, 2);
    const out = await a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, kind: "action", trait: "agility", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [], idempotencyKey: key() });
    expect((await a.sheet()).stress).toBe(1);
    const row = (await a.rows()).find((x) => x._id === out.entryId)!;
    expect(row.summary).toMatch(/Poisoned: marks 1 Stress/);
  });

  it("a reaction roll leaves it alone; a 5 marks nothing", async () => {
    const a = await arena();
    await a.edit(() => ({ effects: [poisoned], stress: 0 }));
    serverDice(3);
    await a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, kind: "reaction", trait: "agility", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [], idempotencyKey: key() });
    expect((await a.sheet()).stress).toBe(0);
    serverDice(5, 6, 2);
    await a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, kind: "action", trait: "agility", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [], idempotencyKey: key() });
    expect((await a.sheet()).stress).toBe(0);
  });
});

describe("dcm-1sk4: a held attack keeps its Spirit Weapon box", () => {
  it("the out-of-range sanction stores spiritWeapon and the GM's approval reaches Close", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "seraph", subclassId: "divine-wielder", subclassRank: "foundation", primaryWeaponId: "broadsword" }) as Partial<CharacterSheet>);
    const far = await a.enemy("Archer", { x: 20 });
    serverDice(6, 3);
    const pending = await a.attack(a.player, [far.tokenId], { spiritWeapon: true });
    expect(pending.status).toBe("pending");
    const row = await a.t.run((ctx) => ctx.db.query("combatRequests").collect());
    const sanction = row.find((x) => x.kind === "sanction")!;
    expect(sanction.payload.kind === "sanction" && sanction.payload.action.kind === "attack" ? sanction.payload.action.roll.spiritWeapon : undefined).toBe(true);
    const approved = await a.gm.mutation(api.combatRequests.sanction, { campaignId: a.w.campaignId, requestId: sanction._id, approve: true, idempotencyKey: key() });
    expect(approved.status).toBe("resolved");
    expect(approved.status === "resolved" ? approved.riders : []).toContain("Spirit Weapon");
  });
});

describe("dcm-kso9: a target's rider benefit is used up by the attack, hit or miss", () => {
  it("the picked benefit runs and the tag goes (Breaking Blow carries no benefit: it stays)", async () => {
    const a = await arena();
    const target = await a.enemy("Ogre", { tags: ["Breaking Blow"], difficulty: 30 });
    serverDice(2, 3);
    resolved(await a.attack(a.player, [target.tokenId], { benefit: "stress" }));
    const inst = await a.t.run((ctx) => ctx.db.get("encounterAdversaries", target.instanceId));
    expect(inst!.tags).toEqual(["Breaking Blow"]);
  });
});
