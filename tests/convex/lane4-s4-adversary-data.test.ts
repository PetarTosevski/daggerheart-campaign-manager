/**
 * Plan lanes-2, wave 10, tracer S4.4 (docs/tasks/TASK-LN4-S4.md): tier 3-4 adversary data switches, proven through the
 * real server paths with the SRD stat blocks.
 *
 * - Money Talks (Demon of Avarice, CB p.228: "they can spend a handful of gold instead of marking HP (1 handful per HP)"):
 *   the hit PC is offered the gold grant on the Demon's standard attack (dcm-5cn5).
 * - Fire Beam (Adonix, HF p.96: "a beam of elemental fire"): its HP marks are fire; Fireproof stops them as a hit's HP
 *   riders (dcm-n7kt; the direct mark path waits on dcm-vvg1).
 * - Ill Omen (Owl Witch, HF p.95: "their Fear Die gains a bonus equal to the amount of Fear you have"): a Fear Die bonus of
 *   the GM's Fear on a PC's roll (dcm-of7v).
 * - Transform (Forlorne, HF p.142-143: "While she embodies a form, she uses its statistics and features"; dcm-3ag5).
 * - Seven-Headed (Mitera, HF p.92: "Permanently remove the Elemental Breath option that corresponds to the result. On a
 *   result of 8, or if the corresponding option has already been removed, tick down the Diamond Hide countdown"; dcm-qw4f).
 * - Immovable Object (Greater Earth Elemental, CB p.230: "moves them two fewer ranges"; dcm-1yo).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { forcedMoveReduceOf } from "../../convex/lib/combatAreas";
import { pcRollAdversaryUses } from "../../convex/lib/adversaryActions";
import { instanceStatsOf } from "../../convex/lib/adversaryFeatures";
import { markHpKeyword } from "../../convex/lib/adversaryHits";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import type { HitRider } from "../../convex/lib/validators/combatRequests";
import { adversaryEffects } from "../../src/lib/srd/adversary-effects";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

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

afterEach(() => {
  vi.restoreAllMocks();
});

const STATS = { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 4 };

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const player = w.as("player");
  const gm = w.as("gm");
  const now = Date.now();
  // Hope & Fear stat blocks and Emberkin (HF p.22).
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { options: { hopeAndFear: true } }));
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, hope: 3, effects: [], domainCards: { owned: [], loadout: [] } }));
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const add = (adversaryId: string, label: string, extra: Partial<Doc<"encounterAdversaries">> = {}) =>
    t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order: 0,
        summoned: false,
        stats: STATS,
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
        ...extra,
      }),
    );
  const hit = (target: Id<"characters">, attacker: { instanceId: Id<"encounterAdversaries">; label: string; feature?: string }, amount: number, riders: HitRider[] = []) =>
    t.run(async (ctx) =>
      openIncomingHit(ctx, {
        campaignId,
        encounterId,
        createdBy: w.users.gm,
        groupId: `g-${key()}`,
        attacker,
        targetCharacterId: target,
        hit: { amount, type: "physical", direct: false, forcedArmor: 0, critical: false },
        party: await partyMembers(ctx, campaignId),
        bands: await bandsOnMap(ctx, undefined),
        riders,
      }),
    );
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const respond = (requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) =>
    player.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId, choice: choice as never, idempotencyKey: key() });
  const pending = (characterId: Id<"characters">) => player.query(api.adversaryActionsReads.pending, { campaignId, characterId });
  /** An answer, then Done if the window stays open. */
  const answer = async (requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) => {
    const r = await respond(requestId, characterId, choice);
    if (r.status === "open") await respond(requestId, characterId, { kind: "pass" });
  };
  const useFeature = (instanceId: Id<"encounterAdversaries">, feature: string) =>
    gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId, feature, targets: [], idempotencyKey: key() });
  return { w, t, campaignId, encounterId, edit, add, hit, sheet, instance, respond, pending, answer, useFeature };
}

describe("S4.4 dcm-5cn5: Money Talks lets the hit PC pay gold instead of HP", () => {
  it("the Demon's standard attack offers the gold grant; the handfuls paid replace HP", async () => {
    const a = await arena();
    const demon = await a.add("demon-of-avarice", "Demon");
    await a.edit(a.w.characterA, (s) => ({ gold: { ...s.gold, handfuls: 3 } }));
    // 10 against Chainmail's 8 / 16 at level 1: Major, 2 HP.
    const { requestId } = await a.hit(a.w.characterA, { instanceId: demon, label: "Demon" }, 10);
    const [view] = await a.pending(a.w.characterA);
    expect(view!.grants).toEqual([expect.objectContaining({ id: "gold", amount: 3 })]);
    expect((await a.respond(requestId!, a.w.characterA, { kind: "grant", id: "gold", amount: 2 })).status).toBe("open");
    await a.answer(requestId!, a.w.characterA, { kind: "noArmor" });
    const after = await a.sheet(a.w.characterA);
    expect(after.hp).toBe(0);
    expect(after.gold.handfuls).toBe(1);
  });

  it("a Demon's feature hit (not the standard attack) offers no gold", async () => {
    const a = await arena();
    const demon = await a.add("demon-of-avarice", "Demon");
    await a.edit(a.w.characterA, (s) => ({ gold: { ...s.gold, handfuls: 3 } }));
    await a.hit(a.w.characterA, { instanceId: demon, label: "Demon", feature: "Money Talks" }, 10);
    expect((await a.pending(a.w.characterA))[0]!.grants).toBeUndefined();
  });
});

describe("S4.4 dcm-n7kt: Fire Beam's HP marks are fire", () => {
  it("the stat block's Elemental Archon marks fire HP; an Emberkin marks none from them as a hit's riders", async () => {
    expect(markHpKeyword(adversaryEffects("supreme-demiurge-adonix"), "Elemental Archon")).toBe("fire");
    const a = await arena();
    const adonix = await a.add("supreme-demiurge-adonix", "Adonix");
    const plain = await a.hit(a.w.characterA, { instanceId: adonix, label: "Adonix", feature: "Elemental Archon" }, 0, [{ kind: "hp", amount: 3 }]);
    if (plain.requestId) await a.answer(plain.requestId, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(3);
    await a.edit(a.w.characterA, () => ({ hp: 0, ancestry: { kind: "single", id: "emberkin" } }));
    const ember = await a.hit(a.w.characterA, { instanceId: adonix, label: "Adonix", feature: "Elemental Archon" }, 0, [{ kind: "hp", amount: 3 }]);
    if (ember.requestId) await a.answer(ember.requestId, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(0);
  });
});

describe("S4.4 dcm-of7v: Ill Omen adds the GM's Fear to a PC's Fear Die", () => {
  it("pcRollAdversaryUses returns a Fear Die bonus equal to the GM's Fear", async () => {
    const a = await arena();
    const witch = await a.add("owl-witch", "Owl Witch");
    await a.t.run(async (ctx) => {
      const state = await ctx.db
        .query("campaignState")
        .withIndex("by_campaign", (q) => q.eq("campaignId", a.campaignId))
        .unique();
      await ctx.db.patch("campaignState", state!._id, { fear: 4 });
    });
    const campaign = await a.t.run(async (ctx) => (await ctx.db.get("campaigns", a.campaignId))!);
    const roll = { kind: "action" as const, hope: 7, fear: 5, total: 12, withHope: true, critical: false };
    const out = await a.t.run((ctx) => pcRollAdversaryUses(ctx, campaign, { characterId: a.w.characterA, roll: roll as never }));
    expect(out.bonuses).toEqual([{ die: "fear", amount: 4, instanceId: witch, feature: "Ill Omen" }]);
  });
});

describe("S4.4 dcm-3ag5: Forlorne's Transform swaps her stat block", () => {
  it("useFeature stores the other form; her numbers follow it, her marks stay", async () => {
    const a = await arena();
    const forlorne = await a.add("forlorne-lykona-dragon-form", "Forlorne", { hp: 2 });
    expect((await a.useFeature(forlorne, "Transform")).status).toBe("resolved");
    const faun = await a.instance(forlorne);
    expect(faun.effects ?? []).toEqual([expect.objectContaining({ form: "forlorne-lykona-faun-form", until: "permanent" })]);
    expect(faun.stress).toBe(1);
    expect(faun.hp).toBe(2);
    expect(instanceStatsOf(faun)).not.toEqual(STATS);
    // And back: the faun form's Transform names the dragon.
    expect((await a.useFeature(forlorne, "Transform")).status).toBe("resolved");
    expect((await a.instance(forlorne)).effects ?? []).toEqual([expect.objectContaining({ form: "forlorne-lykona-dragon-form" })]);
  });
});

describe("S4.4 dcm-qw4f: Seven-Headed removes Elemental Breath heads for good", () => {
  it("a 3 removes 3. Acid; a second 3 (Acid gone) ticks Diamond Hide", async () => {
    const a = await arena();
    const mitera = await a.add("dragon-mother-mitera", "Mitera", { tokens: 5 });
    serverDice(3);
    expect((await a.useFeature(mitera, "Seven-Headed")).status).toBe("resolved");
    const first = await a.instance(mitera);
    expect(first.effects ?? []).toEqual([expect.objectContaining({ label: "Elemental Breath 3. Acid removed", optionsRemoved: [{ feature: "Elemental Breath", choose: "head", option: "acid" }] })]);
    expect(first.tokens).toBe(5);
    vi.restoreAllMocks();
    serverDice(3);
    expect((await a.useFeature(mitera, "Seven-Headed")).status).toBe("resolved");
    expect((await a.instance(mitera)).tokens).toBe(4);
  });
});

describe("S4.4 dcm-1yo: Immovable Object shortens the server's forced moves", () => {
  it("forcedMoveReduceOf reads 2 ranges from the stat block's passive", async () => {
    const a = await arena();
    const elemental = await a.add("greater-earth-elemental", "Elemental");
    const reduce = await a.t.run(async (ctx) => {
      const mapId = await ctx.db.insert("combatMaps", { campaignId: a.campaignId, name: "Camp", live: true, source: "image", w: 10, h: 10, base: "grass", areas: [], seed: 1, schemaVersion: 1, updatedAt: Date.now() });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId: a.campaignId, mapId, ref: { kind: "adversary", adversaryId: elemental }, side: "enemy", x: 3, y: 3, size: 1, face: 0, light: "none", revealedTo: [] });
      return forcedMoveReduceOf(ctx, a.campaignId, (await ctx.db.get("combatTokens", tokenId))!);
    });
    expect(reduce).toBe(2);
  });
});
