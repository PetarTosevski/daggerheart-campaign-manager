/**
 * Unshakable on every server Stress mark (plan drawer-answers DA10; docs/tasks/TASK-DA-DA10.md).
 *
 * CB p.59, Firbolg, Unshakable: "When you would mark a Stress, roll a d6. On a result of 6, don't mark it." User answer
 * 2026-10-30 (dcm-bxp.99.19.50 (1)): the server rolls a d6 on EVERY Stress mark it makes (Stress paid as a cost too) and
 * skips the Stress on a 6; the roll shows in the log; manual tracker clicks don't roll; one helper
 * (convex/lib/unshakable.ts). CB p.92: "If you would mark Stress but your Stress is full, mark 1 Hit Point instead."
 *
 * Server dice: `rollDie` maps a random word w to w % sides + 1 (convex/lib/dice.ts), one word per die.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import { holdsUnshakable, markStressOn, rollUnshakable, stressMarksIn, unmarkSkipped, unshakableText, unshake } from "../../convex/lib/unshakable";
import type { RunPlan } from "../../src/lib/domain/card-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { getDomainCard } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

const injected = vi.hoisted(() => ({ entries: new Map<string, unknown>() }));

vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  return { ...real, featureEffect: (id: string) => (injected.entries.get(id) as FeatureEffect | undefined) ?? real.featureEffect(id) };
});

/** A stand-in action a Firbolg holds, with a 2-Stress cost (the real Charge needs its square): clears an Armor Slot. */
const STRESS_COST: FeatureEffect = {
  featureId: "ancestry:firbolg:charge",
  source: "ancestry",
  owner: "firbolg",
  uses: [{ id: "main", name: "Two-Stress test", activation: { kind: "action" }, costs: [{ kind: "stress", amount: { kind: "fixed", value: 2 } }], targets: { side: "self", range: "unlimited", count: { kind: "one" } }, steps: [{ kind: "clear", to: "self", track: "armor", amount: { kind: "fixed", value: 1 } }] }],
};
injected.entries.set(STRESS_COST.featureId, STRESS_COST);

afterEach(() => {
  vi.restoreAllMocks();
});

/** The server's next dice in order; later dice stay random. */
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

const fixed = (...values: number[]) => {
  const queue = [...values];
  return () => queue.shift() ?? 1;
};

const firbolg = { ancestry: { kind: "single" as const, id: "firbolg" } };

describe("the helper (convex/lib/unshakable.ts)", () => {
  const tracks = { stress: 0, stressMax: 6, hp: 0, hpMax: 6 };
  const sheetOf = (over: Partial<CharacterSheet> = {}) => ({ classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", level: 1, communityId: "highborne", effects: [], classState: {}, ...firbolg, ...tracks, ...over }) as unknown as CharacterSheet;

  it("holds for a Firbolg and a mixed ancestry that took Unshakable, not otherwise", () => {
    expect(holdsUnshakable(sheetOf())).toBe(true);
    expect(holdsUnshakable(sheetOf({ ancestry: { kind: "single", id: "human" } }))).toBe(false);
    // CB p.71 (Mixed Ancestry): the second feature from the second ancestry. Firbolg's second feature is Unshakable.
    expect(holdsUnshakable(sheetOf({ ancestry: { kind: "mixed", first: "human", second: "firbolg", name: "Mixed" } }))).toBe(true);
  });

  it("rolls one d6 per Stress and skips each 6", () => {
    expect(rollUnshakable(3, fixed(6, 2, 6))).toEqual({ rolls: [6, 2, 6], skipped: 2 });
    expect(rollUnshakable(0, fixed(6))).toEqual({ rolls: [], skipped: 0 });
  });

  it("takes skipped marks back, the overflow Hit Point included (CB p.92)", () => {
    // 2 Stress marked from 5/6: the track fills (6) and the second marks 1 HP. One skipped: 6/6 and no HP.
    expect(unmarkSkipped({ stress: 5, stressMax: 6, hp: 0, hpMax: 6 }, { stress: 6, hp: 1 }, 2, 1)).toEqual({ stress: 6, hp: 0 });
    // Both skipped: nothing marked.
    expect(unmarkSkipped({ stress: 5, stressMax: 6, hp: 0, hpMax: 6 }, { stress: 6, hp: 1 }, 2, 2)).toEqual({ stress: 5, hp: 0 });
    expect(unmarkSkipped({ stress: 1, stressMax: 6, hp: 0, hpMax: 6 }, { stress: 3, hp: 0 }, 2, 0)).toEqual({ stress: 3, hp: 0 });
  });

  it("marks directly (Recall Cost, Flow State) and rolls only for an Unshakable holder", () => {
    const m = markStressOn(sheetOf(), 2, fixed(6, 4));
    expect(m).toMatchObject({ marked: 1, roll: { rolls: [6, 4], skipped: 1 } });
    expect(m.sheet.stress).toBe(1);
    const human = markStressOn(sheetOf({ ancestry: { kind: "single", id: "human" } }), 2, fixed(6, 6));
    expect(human).toMatchObject({ marked: 2, roll: null });
    expect(human.sheet.stress).toBe(2);
  });

  it("counts a plan's paid Stress costs (the actor's) and its Stress steps on that creature", () => {
    const plan = {
      steps: [
        { kind: "pay", phase: "upfront", paid: true, costs: [{ resource: "stress", amount: 1 }, { resource: "hope", amount: 2 }] },
        { kind: "mark", targetId: "me", track: "stress", amount: 2, hpMarked: 0, overflow: false },
        { kind: "mark", targetId: "ally", track: "stress", amount: 1, hpMarked: 0, overflow: false },
        { kind: "mark", targetId: "me", track: "hp", amount: 1, hpMarked: 1, overflow: false },
      ],
    } as unknown as RunPlan;
    expect(stressMarksIn(plan, "me", true)).toBe(3);
    expect(stressMarksIn(plan, "ally", false)).toBe(1);
  });

  it("unshake leaves a write alone without Stress or without the feature; the feed names the d6s", () => {
    const before = sheetOf();
    expect(unshake(before, { ...before, stress: 0 }, 0, fixed(6)).roll).toBeNull();
    expect(unshake(sheetOf({ ancestry: { kind: "single", id: "elf" } }), { ...before, stress: 1 }, 1, fixed(6)).roll).toBeNull();
    const r = unshake(before, { ...before, stress: 2 }, 2, fixed(3, 6));
    expect(r.sheet.stress).toBe(1);
    expect(unshakableText(r.roll!)).toBe("Unshakable d6: 3, 6 (1 of 2 Stress not marked)");
    expect(unshakableText({ rolls: [6], skipped: 1 })).toBe("Unshakable d6: 6 (1 Stress not marked)");
    expect(unshakableText({ rolls: [2], skipped: 0 })).toBe("Unshakable d6: 2 (marked)");
  });
});

async function world() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>, id: Id<"characters"> = w.characterA) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const sheet = (id: Id<"characters"> = w.characterA) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  await edit(() => ({ ...firbolg, stress: 0, hp: 0 }));
  return { w, t, campaignId, gm, player, edit, sheet, rows, undo };
}

describe("every server Stress mark rolls (convex)", () => {
  it("the Hand's Recall Cost: a 6 skips that Stress, the row names the d6, undo reverts it", async () => {
    const a = await world();
    const card = getDomainCard("bolt-beacon")!;
    expect(card.recallCost).toBe(1);
    await a.edit((s) => ({ domainCards: { owned: [...s.domainCards.owned, card.id], loadout: [] } }));
    serverDice(6);
    await a.player.mutation(api.characters.moveCard, { characterId: a.w.characterA, cardId: card.id, to: "loadout" });
    expect((await a.sheet()).stress).toBe(0);
    const row = (await a.rows()).find((r) => r.summary.includes("recalls"))!;
    expect(row.summary).toContain("Unshakable d6: 6 (1 Stress not marked)");

    // A 5: the Stress is marked.
    await a.player.mutation(api.characters.moveCard, { characterId: a.w.characterA, cardId: card.id, to: "vault" });
    serverDice(5);
    await a.player.mutation(api.characters.moveCard, { characterId: a.w.characterA, cardId: card.id, to: "loadout" });
    expect((await a.sheet()).stress).toBe(1);
    const second = (await a.rows()).filter((r) => r.summary.includes("recalls")).at(-1)!;
    expect(second.summary).toContain("Unshakable d6: 5 (marked)");
    await a.undo(second._id);
    expect((await a.sheet()).stress).toBe(0);
  });

  it("a manual tracker click does not roll", async () => {
    const a = await world();
    serverDice(6, 6, 6);
    await a.player.mutation(api.characters.adjustResource, { characterId: a.w.characterA, resource: "stress", delta: 1 } as never);
    expect((await a.sheet()).stress).toBe(1);
  });

  it("a feature's Stress cost: each Stress rolled separately, logged in the use's group; undo reverts it", async () => {
    const a = await world();
    serverDice(6, 2);
    const r = (await a.player.mutation(api.combatFeatures.useFeature, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: STRESS_COST.featureId, targetTokenIds: [], choices: [], idempotencyKey: key() })) as { status: string; entryId: Id<"actionLog">; notes: string[] };
    expect(r.status).toBe("resolved");
    expect(r.notes).toContain("Unshakable d6: 6, 2 (1 of 2 Stress not marked)");
    expect((await a.sheet()).stress).toBe(1);
    await a.undo(r.entryId);
    expect((await a.sheet()).stress).toBe(0);
  });

  it("Flow State's 'Shift - 1 Stress' rolls too", async () => {
    const a = await world();
    // The Brawler and its stances are Hope & Fear content.
    await a.t.run((ctx) => ctx.db.patch("campaigns", a.campaignId, { options: { hopeAndFear: true } }));
    await a.edit(() => ({ classId: "brawler", subclassId: "martial-artist", subclassRank: "mastery", classState: { martial: { known: ["quick", "reliable"], focus: 0 } } }));
    serverDice(6);
    await a.player.mutation(api.combatFeatures.shiftStance, { campaignId: a.campaignId, characterId: a.w.characterA, stance: "quick", payWith: "stress", idempotencyKey: key() });
    expect(await a.sheet()).toMatchObject({ stress: 0, classState: { martial: { active: "quick" } } });
    expect((await a.rows()).at(-1)!.summary).toContain("Unshakable d6: 6 (1 Stress not marked)");
  });

  it("an adversary hit's Stress riders: one d6 each, a public row with the d6s in the hit's group; the GM's undo reverts all", async () => {
    const a = await world();
    const now = Date.now();
    await a.edit(() => ({ armorId: undefined, armorMarked: 0, effects: [], domainCards: { owned: [], loadout: [] } }));
    const ids = await a.t.run(async (ctx) => {
      const encounterId = await ctx.db.insert("encounters", { campaignId: a.campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
      const bear = await ctx.db.insert("encounterAdversaries", { campaignId: a.campaignId, encounterId, source: { kind: "srd", adversaryId: "bear" }, label: "Bear", order: 0, summoned: false, stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 }, hp: 0, stress: 0, defeated: false, conditions: [], tags: [], spotlights: 0, spotlightTurn: 0, updatedAt: now });
      return { encounterId, bear };
    });
    const groupId = `g-${key()}`;
    serverDice(2, 6);
    const opened = await a.t.run(async (ctx) =>
      openIncomingHit(ctx, {
        campaignId: a.campaignId,
        encounterId: ids.encounterId,
        createdBy: a.w.users.gm,
        groupId,
        attacker: { instanceId: ids.bear, label: "Bear" },
        targetCharacterId: a.w.characterA,
        hit: { amount: 0, type: "physical", direct: false, forcedArmor: 0, critical: false },
        party: await partyMembers(ctx, a.campaignId),
        bands: await bandsOnMap(ctx, undefined),
        riders: [{ kind: "stress", amount: 2 }],
      }),
    );
    expect(opened.resolution).not.toBeNull();
    expect((await a.sheet()).stress).toBe(1);
    const group = (await a.rows()).filter((r) => r.groupId === groupId);
    const roll = group.find((r) => r.summary.includes("Unshakable"))!;
    expect(roll).toMatchObject({ visibility: "public", characterId: a.w.characterA, summary: expect.stringContaining("Unshakable d6: 2, 6 (1 of 2 Stress not marked)") });
    expect(roll.roll?.dice.map((d) => [d.sides, d.value])).toEqual([[6, 2], [6, 6]]);
    const main = group.find((r) => r.before !== undefined)!;
    await a.undo(main._id);
    expect((await a.sheet()).stress).toBe(0);
  });
});
