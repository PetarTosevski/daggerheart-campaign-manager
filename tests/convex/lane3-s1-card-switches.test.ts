/**
 * Plan lanes-2, wave 9, tracer S1 (docs/tasks/TASK-LN3-S1.md): the domain-card data switched this wave, proven through
 * the real server paths with the real SRD entries (no fixtures). Printed pages: CB = Core Book, HF = Hope & Fear.
 *
 * - Dark Army (HF p.181): "When you deal damage to a target within Very Close range, you can spend any number of tokens
 *   to add 1d8 for each token spent to your damage roll" (`whenYouDealDamage.within`, E1 dcm-76l5).
 * - Spectral Mist (HF p.181): "They become corporeal again after they pass through a solid object or make an action
 *   roll. Otherwise, this effect lasts until the end of the scene" (`endsOn: actionRoll`, E1 dcm-wn7).
 * - Midnight-Touched (CB p.337): "When you make a successful attack, you can mark a Stress to add the result of your Fear
 *   Die to your damage roll" (`dualityDie fear` from the host roll, E1 dcm-n0dv; dcm-vbzy (1)).
 * - Rejuvenation Barrier (CB p.339): "you and all allies within have resistance to physical damage from outside the
 *   barrier" (`from: "outsideArea"`, E2 dcm-nt4).
 * - Words of Discord (CB p.335): data now carries `forcedAttack` (dcm-c8h3); the server doesn't run it yet (dcm-f70y), so
 *   the use still resolves with its manual step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { pcResistance } from "../../convex/lib/adversaryHits";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

/** The server's dice: each queued value is the next die (as lane-e1-round2.test.ts); the real generator after. */
function serverDice(...values: number[]) {
  vi.restoreAllMocks();
  const queue = [...values];
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    const next = queue.shift();
    if (next === undefined) return real(buf as never) as T;
    (buf as unknown as Uint32Array)[0] = next - 1;
    return buf;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The world on a live map: Ash (characterA) at (5, 10) with a Shortbow (Far), a running encounter. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, encounterId };
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, primaryWeaponId: "shortbow", ...patch });
    });
  const holding = (cards: string[], extra: Partial<CharacterSheet> = {}) => edit({ domainCards: { owned: cards, loadout: cards.slice(0, 5) }, hope: 4, stress: 0, ...extra });
  const attack = (targetTokenIds: Id<"combatTokens">[], riders: unknown[] = []) =>
    player.mutation(api.combatActions.attack, {
      campaignId,
      characterId: w.characterA,
      mapId,
      targetTokenIds,
      slot: "primary",
      modifier: 0,
      experienceIds: [],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
      idempotencyKey: key(),
      ...(riders.length > 0 ? { riders: riders as never } : {}),
    });
  const use = (cardId: string, targetTokenIds: Id<"combatTokens">[] = []) =>
    player.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId, targetTokenIds, choices: [], idempotencyKey: key() });
  const manual = (values: number[], kind: "action" | "reaction") =>
    player.mutation(api.rolls.manualRoll, { characterId: w.characterA, values, roll: { kind, trait: "agility", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] }, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, edit, holding, attack, use, manual };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

const tokensOf = (s: CharacterSheet, cardId: string) => s.cardTokens?.find((t) => t.cardId === cardId)?.count ?? 0;

describe("S1: Dark Army's fiends ride only on damage within Very Close (whenYouDealDamage.within)", () => {
  allowWorldEmails();
  const strike = (tokens: number) => ({ source: "card", id: "dark-army", useId: "strike", choices: [{ id: "n:tokens", value: tokens }] });

  it("a target 2 squares away (Very Close): 2 tokens spent, the rider applies", async () => {
    const a = await arena();
    const near = await a.enemy("Near", 7, 10);
    await a.holding(["dark-army"], { cardTokens: [{ cardId: "dark-army", count: 8 }] });
    const r = resolved(await a.attack([near.tokenId], [strike(2)]));
    expect(r.skipped ?? []).toEqual([]);
    expect(r.riders).toContain("Dark Army");
    expect(tokensOf(await a.sheet(), "dark-army")).toBe(6);
  });

  it("a target 7 squares away (Close): the rider is skipped, no token spent", async () => {
    const a = await arena();
    const far = await a.enemy("Far", 12, 10);
    await a.holding(["dark-army"], { cardTokens: [{ cardId: "dark-army", count: 8 }] });
    const r = resolved(await a.attack([far.tokenId], [strike(2)]));
    expect(r.skipped).toEqual(["Dark Army: fiends add to your damage"]);
    expect(tokensOf(await a.sheet(), "dark-army")).toBe(8);
  });
});

describe("S1: Spectral Mist ends on the bearer's action roll (endsOn actionRoll)", () => {
  allowWorldEmails();

  it("cast writes the incorporeal effect; a reaction roll keeps it; an action roll ends it", async () => {
    const a = await arena();
    await a.holding(["spectral-mist"]);
    resolved(await a.use("spectral-mist"));
    const cast = await a.sheet();
    expect(cast.hope).toBe(2);
    expect(cast.effects.filter((e) => e.source === "Spectral Mist")).toHaveLength(1);
    await a.manual([5, 4], "reaction");
    expect((await a.sheet()).effects.filter((e) => e.source === "Spectral Mist")).toHaveLength(1);
    await a.manual([5, 4], "action");
    expect((await a.sheet()).effects.filter((e) => e.source === "Spectral Mist")).toEqual([]);
  });
});

describe("S1: Midnight-Touched adds the attack's own Fear Die (dualityDie fear)", () => {
  allowWorldEmails();
  const loadout = ["pick-and-pull", "rain-of-blades", "midnight-spirit", "shadowbind", "midnight-touched"];

  it("the same dice with and without the rider: the damage differs by the Fear Die (3), and a Stress is marked", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 10);
    await a.holding(loadout);
    serverDice(9, 3, 4);
    const plain = resolved(await a.attack([bear.tokenId]));
    serverDice(9, 3, 4);
    const touched = resolved(await a.attack([bear.tokenId], [{ source: "card", id: "midnight-touched", useId: "fear-die", choices: [] }]));
    expect(plain.roll.outcome).toBe("successHope");
    expect(touched.riders).toContain("Midnight-Touched");
    expect(touched.damage!.total - plain.damage!.total).toBe(3);
    expect((await a.sheet()).stress).toBe(1);
  });
});

describe("S1: Rejuvenation Barrier's resistance is only from outside the barrier (from outsideArea)", () => {
  allowWorldEmails();

  it("the cast writes the barrier effect; the PC resists physical damage unless the attacker stands in the barrier", async () => {
    const a = await arena();
    await a.holding(["rejuvenation-barrier"]);
    // 12 + 5 + Spellcast beats 15 with Hope; then the 1d4 heal.
    serverDice(12, 5, 2);
    const r = resolved(await a.use("rejuvenation-barrier"));
    expect(r.success).toBe(true);
    const s = await a.sheet();
    expect(s.effects.filter((e) => e.source === "Rejuvenation Barrier")).toHaveLength(1);
    expect(pcResistance(s, { hopeAndFear: false })).toEqual({ physical: "resistant", magic: "none" });
    expect(pcResistance(s, { hopeAndFear: false, attackerAreas: [] })).toEqual({ physical: "resistant", magic: "none" });
    expect(pcResistance(s, { hopeAndFear: false, attackerAreas: ["rejuvenation-barrier"] })).toBeUndefined();
  });
});

describe("S1: Words of Discord carries forcedAttack; the server still resolves it with the manual step (dcm-f70y)", () => {
  allowWorldEmails();

  it("a success marks the target's Stress and leaves the forced attack to the table", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.holding(["words-of-discord"]);
    serverDice(11, 6);
    const r = resolved(await a.use("words-of-discord", [bear.tokenId]));
    expect(r.success).toBe(true);
    expect((await a.instance(bear.instanceId)).stress).toBe(1);
    expect(JSON.stringify(r)).toContain("attack against another adversary");
  });
});
