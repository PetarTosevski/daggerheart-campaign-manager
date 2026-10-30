/**
 * Plan drawer-answers DA1 (bead dcm-bxp.99.19; answers dcm-bxp.99.19.45 (3), .46 (3), .49 (1) and (3)): the server's
 * adversary attack roll with the PCs' own defences.
 *
 * - Sturdy (CB p.68 Orc: "When you have 1 Hit Point remaining, attacks against you have disadvantage."): on an attack
 *   against several PCs the disadvantage counts only against the Sturdy PC (user 2026-10-30). One roll (CB p.161: "you
 *   make one attack roll and ask if it hits any of the targets"), one pair of d20s: the extra die is kept low only for the
 *   orc (CB p.161: "if an NPC has disadvantage, roll an extra d20 and use the lowest result").
 * - Harrowing Invocation (HF p.14: "give them disadvantage on the roll. If the adversary fails the roll, they must also
 *   mark a Stress."): the attacker marks the Stress when the roll fails against ANY PC it protected (user 2026-10-30).
 * - Drained (HF p.14: "uses a d12 instead of a d20 for attack rolls (including for advantage or disadvantage) until they
 *   fail a roll"): the stored roll lists d12s; a hit keeps Drained, a failed attack roll ends it.
 * - A forced reroll of the attack (Danger Sense, CB p.63) keeps the roll's advantage / disadvantage (pin).
 *
 * The Acid Burrower's Spit Acid ("Make an attack against all targets in front of the Burrower within Close range",
 * ATK +3) attacks Ash (characterA) and Bryn (characterB); no live map (Q18: any party PC). The server's d20s are set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { resolveRerolls, seededRng } from "../../convex/lib/adversaryHits";
import { pcCombatant } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { RollRecord } from "../../src/lib/domain/duality";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

afterEach(() => {
  vi.restoreAllMocks();
});

/** The server's next dice (`rollDie` maps a random word w to w % sides + 1); later dice stay random. */
function serverDice(...values: number[]) {
  const queue = [...values];
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    const next = queue.shift();
    if (next === undefined) return real(buf as never) as T;
    (buf as unknown as Uint32Array)[0] = next - 1;
    return buf;
  });
}

const ATK = 3;
const SPIT_ACID = "Spit Acid";
const HARROWING = "subclass:pact-of-the-endless:harrowing-invocation";
const DRAINING = "subclass:pact-of-the-endless:draining-bane";

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { options: { hopeAndFear: true } }));
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorMarked: 0, hp: 0, stress: 0, hope: 3, effects: [], domainCards: { owned: [], loadout: [] } }));
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Tunnels", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const burrower = await t.run((ctx) =>
    ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "acid-burrower" },
      label: "Burrower",
      order: 0,
      summoned: false,
      stats: { difficulty: 14, major: 8, severe: 15, hpMax: 8, stressMax: 3 },
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
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const evasion = async (id: Id<"characters">) => pcCombatant(id, await sheet(id)).evasion!;
  const burrowerNow = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", burrower))!);
  const spit = (targets: Id<"characters">[], extra: Record<string, unknown> = {}) =>
    gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: burrower, feature: SPIT_ACID, targets, spendFear: 1, idempotencyKey: key(), ...extra });
  const gmRoll = () => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((r) => r.visibility === "gm" && r.roll !== undefined).at(-1)!);
  const hits = () => t.run(async (ctx) => (await ctx.db.query("combatRequests").collect()).filter((r) => r.kind === "incomingHit"));
  const respond = (requestId: Id<"combatRequests">, characterId: Id<"characters">, featureId: string) =>
    w.as("player").mutation(api.adversaryActions.respond, { campaignId, requestId, characterId, choice: { kind: "feature", featureId, choices: [] } as never, idempotencyKey: key() });
  /** Ash an orc with 1 Hit Point unmarked (Sturdy, CB p.68). */
  const sturdy = (id: Id<"characters">) => edit(id, (s) => ({ ancestry: { kind: "single", id: "orc" }, hp: s.hpMax - 1 }));
  /** Ash a Pact of the Endless warlock holding Favor. */
  const warlock = (rank: "specialization" | "mastery") =>
    edit(w.characterA, (s) => ({ classId: "warlock", subclassId: "pact-of-the-endless", subclassRank: rank, classState: { ...s.classState, favor: 2 } }));
  return { w, t, campaignId, gm, burrower, edit, sheet, evasion, burrowerNow, spit, gmRoll, hits, respond, sturdy, warlock };
}

type Arena = Awaited<ReturnType<typeof arena>>;
type Resolved = Extract<Awaited<ReturnType<Arena["spit"]>>, { status: "resolved" }>;
const resolved = (r: Awaited<ReturnType<Arena["spit"]>>): Resolved => {
  if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
  return r;
};
const hitOf = (r: Resolved, id: Id<"characters">) => r.targets.find((t) => t.characterId === id)?.hit;
const d20s = (roll: RollRecord | StoredLike) => roll.dice.filter((d) => d.role !== "damage").map((d) => [d.sides, d.value, d.dropped === true, d.role]);
type StoredLike = { dice: { sides: number; value: number; role: string; dropped?: boolean }[] };

describe("Sturdy on a multi-target attack (CB p.68; user 2026-10-30)", () => {
  it("one roll 18 / 2: Bryn keeps the 18 (21, a hit), the Sturdy orc keeps the 2 (5, a miss)", async () => {
    const a = await arena();
    await a.sturdy(a.w.characterA);
    serverDice(18, 2);
    const r = resolved(await a.spit([a.w.characterA, a.w.characterB]));
    vi.restoreAllMocks();
    expect(hitOf(r, a.w.characterB)).toBe(true);
    expect(hitOf(r, a.w.characterA)).toBe(false);
    // The record: the 18 kept for the whole roll, the orc's 2 listed and dropped (one roll, two d20s).
    expect(d20s((await a.gmRoll()).roll!)).toEqual([
      [20, 18, false, "extra"],
      [20, 2, true, "extra"],
    ]);
    expect((await a.gmRoll()).summary).toContain(`disadvantage against them: 2, total ${2 + ATK}`);
    expect((await a.hits()).map((h) => h.payload.kind === "incomingHit" && h.payload.targetCharacterId)).toEqual([a.w.characterB]);
  });

  it("the same dice 2 / 18: Bryn keeps the first die (a miss); the orc keeps the lower, also a miss", async () => {
    const a = await arena();
    await a.sturdy(a.w.characterA);
    serverDice(2, 18);
    const r = resolved(await a.spit([a.w.characterA, a.w.characterB]));
    vi.restoreAllMocks();
    expect(r.targets.map((t) => t.hit)).toEqual([false, false]);
  });

  it("without Sturdy (2 HP unmarked) one die decides for both", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, (s) => ({ ancestry: { kind: "single", id: "orc" }, hp: s.hpMax - 2 }));
    serverDice(18);
    const r = resolved(await a.spit([a.w.characterA, a.w.characterB]));
    vi.restoreAllMocks();
    expect(r.targets.map((t) => t.hit)).toEqual([true, true]);
    expect(d20s((await a.gmRoll()).roll!)).toEqual([[20, 18, false, "extra"]]);
  });

  it("a Sturdy orc attacked alone: the whole roll has disadvantage (as SD2), 18 / 2 keeps the 2", async () => {
    const a = await arena();
    await a.sturdy(a.w.characterA);
    serverDice(18, 2);
    const r = resolved(await a.spit([a.w.characterA]));
    vi.restoreAllMocks();
    expect(r.targets.map((t) => t.hit)).toEqual([false]);
    expect(d20s((await a.gmRoll()).roll!)).toEqual([
      [20, 18, true, "extra"],
      [20, 2, false, "disadvantage"],
    ]);
  });

  it("a natural 20 is critical only for Bryn; the orc keeps its 19 (22): a hit without the critical damage (CB p.148)", async () => {
    const a = await arena();
    await a.sturdy(a.w.characterA);
    serverDice(20, 19);
    const r = resolved(await a.spit([a.w.characterA, a.w.characterB]));
    vi.restoreAllMocks();
    expect(r.targets.map((t) => t.hit)).toEqual([true, true]);
    const byTarget = new Map((await a.hits()).flatMap((h) => (h.payload.kind === "incomingHit" ? [[h.payload.targetCharacterId, h.payload] as const] : [])));
    const ash = byTarget.get(a.w.characterA)!;
    const bryn = byTarget.get(a.w.characterB)!;
    expect(bryn.critical).toBe(true);
    expect(ash.critical).toBe(false);
    // Same damage dice (2d6); the critical adds the dice's maximum, 12 (CB p.148).
    expect(bryn.damage - ash.damage).toBe(12);
  });

  it("a natural 20 the orc doesn't keep: its 1 (4) misses although the other die shows a 20", async () => {
    const a = await arena();
    await a.sturdy(a.w.characterA);
    serverDice(20, 1);
    const r = resolved(await a.spit([a.w.characterA, a.w.characterB]));
    vi.restoreAllMocks();
    expect(hitOf(r, a.w.characterA)).toBe(false);
    expect(hitOf(r, a.w.characterB)).toBe(true);
    expect((await a.burrowerNow()).stress).toBe(0);
  });
});

describe("Harrowing Invocation: a Stress when the roll fails against any protected PC (HF p.14; user 2026-10-30)", () => {
  it("the roll hits Bryn and misses Ash: the Burrower marks a Stress (SD4 had 'every')", async () => {
    const a = await arena();
    await a.warlock("specialization");
    // Nimble (CB p.70): +1 Evasion, so the same total can hit one and miss the other.
    await a.edit(a.w.characterB, () => ({ ancestry: { kind: "single", id: "simiah" } }));
    const [ash, bryn] = [await a.evasion(a.w.characterA), await a.evasion(a.w.characterB)];
    expect(ash).not.toBe(bryn);
    // No map (Q18): both PCs are protected, so the disadvantage counts for the whole roll; the kept die meets the lower Evasion.
    const kept = Math.min(ash, bryn) - ATK;
    const held = resolved(await a.spit([a.w.characterA, a.w.characterB])).held!;
    expect(held).toBeDefined();
    serverDice(19, kept);
    await a.respond(held, a.w.characterA, HARROWING);
    vi.restoreAllMocks();
    const hitIds = (await a.hits()).map((h) => h.payload.kind === "incomingHit" && h.payload.targetCharacterId);
    expect(hitIds).toEqual([ash < bryn ? a.w.characterA : a.w.characterB]);
    expect((await a.burrowerNow()).stress).toBe(1);
  });

  it("the roll hits both protected PCs: no Stress", async () => {
    const a = await arena();
    await a.warlock("specialization");
    const held = resolved(await a.spit([a.w.characterA, a.w.characterB])).held!;
    serverDice(19, 18);
    await a.respond(held, a.w.characterA, HARROWING);
    vi.restoreAllMocks();
    expect((await a.hits()).length).toBe(2);
    expect((await a.burrowerNow()).stress).toBe(0);
  });

  it("Harrowing on Ash and Sturdy on Bryn: both carry one disadvantage, so the roll keeps the lower die for both", async () => {
    const a = await arena();
    await a.warlock("specialization");
    await a.sturdy(a.w.characterB);
    const held = resolved(await a.spit([a.w.characterA, a.w.characterB])).held!;
    serverDice(19, 1);
    await a.respond(held, a.w.characterA, HARROWING);
    vi.restoreAllMocks();
    expect((await a.hits()).length).toBe(0);
    expect(d20s((await a.gmRoll()).roll!)).toEqual([
      [20, 19, true, "extra"],
      [20, 1, false, "disadvantage"],
    ]);
  });
});

// DA17 (bead dcm-bxp.99.19.53, user 2026-10-30): several disadvantage sources on the same target count once (on / off),
// and one advantage source cancels it. Ash is a Pact of the Endless warlock and an orc with 1 HP unmarked: Sturdy (CB
// p.68) and Harrowing Invocation (HF p.14) both put disadvantage on the attack against Ash.
describe("Sturdy and Harrowing on the same target count once (DA17)", () => {
  async function both(a: Arena, targets: Id<"characters">[], dice: number[], advantage: number) {
    await a.warlock("specialization");
    await a.sturdy(a.w.characterA);
    const held = resolved(await a.spit(targets, { advantage })).held!;
    expect(held).toBeDefined();
    serverDice(...dice);
    await a.respond(held, a.w.characterA, HARROWING);
    vi.restoreAllMocks();
  }

  it("one advantage source cancels both: one die decides (18, a hit; per source the 2 was kept)", async () => {
    const a = await arena();
    // 18 + 3 = 21 meets Ash's Evasion; 2 + 3 = 5 would not.
    expect(await a.evasion(a.w.characterA)).toBeGreaterThan(5);
    await both(a, [a.w.characterA], [18, 2], 1);
    expect(d20s((await a.gmRoll()).roll!)).toEqual([[20, 18, false, "extra"]]);
    expect((await a.hits()).map((h) => h.payload.kind === "incomingHit" && h.payload.targetCharacterId)).toEqual([a.w.characterA]);
  });

  it("two advantage sources against both: advantage, the higher die (per source they cancelled to the first die)", async () => {
    const a = await arena();
    await both(a, [a.w.characterA], [2, 18], 2);
    const kept = d20s((await a.gmRoll()).roll!).filter((d) => d[2] === false);
    expect(kept).toEqual([[20, 18, false, "advantage"]]);
    expect((await a.hits()).length).toBe(1);
    expect((await a.burrowerNow()).stress).toBe(0);
  });

  it("Ash (Sturdy + Harrowing) and Bryn (Harrowing) with one advantage source: no residual, one die for both", async () => {
    const a = await arena();
    await both(a, [a.w.characterA, a.w.characterB], [18, 2], 1);
    expect(d20s((await a.gmRoll()).roll!)).toEqual([[20, 18, false, "extra"]]);
    expect((await a.gmRoll()).summary).not.toContain("disadvantage against them");
    expect((await a.hits()).length).toBe(2);
  });
});

describe("Drained (HF p.14; dcm-bxp.99.19.49 (1))", () => {
  async function drained(a: Arena, targets: Id<"characters">[], dice: number[], extra: Record<string, unknown> = {}) {
    await a.warlock("mastery");
    const held = resolved(await a.spit(targets, extra)).held!;
    serverDice(...dice);
    await a.respond(held, a.w.characterA, DRAINING);
    vi.restoreAllMocks();
  }

  it("the stored roll lists d12s for every die of a Drained attack, advantage / disadvantage included", async () => {
    const a = await arena();
    await drained(a, [a.w.characterA], [12, 3], { disadvantage: 1 });
    const roll = (await a.gmRoll()).roll!;
    expect(d20s(roll)).toEqual([
      [12, 12, true, "extra"],
      [12, 3, false, "disadvantage"],
    ]);
    expect(roll.dice.some((d) => d.sides === 20)).toBe(false);
  });

  it("a failed attack roll ends Drained; a hit keeps it (attack rolls only, as built)", async () => {
    const a = await arena();
    await drained(a, [a.w.characterA], [1]);
    expect((await a.burrowerNow()).tags ?? []).not.toContain("Drained");

    const b = await arena();
    await b.edit(b.w.characterA, () => ({ hp: 0 }));
    const ev = await b.evasion(b.w.characterA);
    // A d12 of 12 + 3 = 15: a hit when Ash's Evasion is 15 or lower.
    expect(ev).toBeLessThanOrEqual(15);
    await drained(b, [b.w.characterA], [12]);
    expect((await b.burrowerNow()).tags ?? []).toContain("Drained");
  });
});

describe("a forced reroll keeps the original advantage / disadvantage (dcm-bxp.99.19.49 (3), pin)", () => {
  it("Danger Sense's reroll of a roll with disadvantage rolls two d20s and keeps the lower", () => {
    const record: RollRecord = {
      kind: "action",
      dice: [
        { sides: 20, value: 17, role: "extra", dropped: true },
        { sides: 20, value: 9, role: "disadvantage" },
      ],
      modifier: 3,
      total: 12,
      outcome: "none",
      manual: false,
    };
    const rng = seededRng("seed");
    const [x, y] = [rng(20), rng(20)];
    expect(resolveRerolls([{ kind: "rerollAttack" }], "seed", record, null)).toEqual([{ kind: "attackRoll", total: Math.min(x, y) + 3, critical: Math.min(x, y) === 20 }]);
    const plain: RollRecord = { ...record, dice: [{ sides: 20, value: 9, role: "extra" }] };
    expect(resolveRerolls([{ kind: "rerollAttack" }], "seed", plain, null)).toEqual([{ kind: "attackRoll", total: x + 3, critical: x === 20 }]);
  });
});
