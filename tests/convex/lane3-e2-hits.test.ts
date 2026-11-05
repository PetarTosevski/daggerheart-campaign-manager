/**
 * Plan lanes-2, tracer E2.3 (docs/tasks/TASK-LN3-E2.md): incoming hits on the server.
 *
 * - dcm-8f51: the hit PC's damage ends what they made on adversaries (Hush, CB p.336: "or you take Major damage").
 * - User answer 2026-10-31: "took damage" means at least 1 HP marked; a hit armor reduced to 0 HP ends nothing.
 * - dcm-nnbl: Hope before forced HP (Doom / Tentacle Rays, HF p.75), offered as the `hope` grant.
 * - dcm-5cn5: gold instead of HP (Money Talks, CB p.228): which stat blocks grant it (`goldForHp`).
 *
 * Ash and Bryn wear Chainmail: thresholds 8 / 16 at level 1 (CB p.91: Minor 1 HP, Major 2 HP).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { applyRiders, goldForHp, hopeReducibleHp } from "../../convex/lib/adversaryHits";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import type { HitRider } from "../../convex/lib/validators/combatRequests";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const player = w.as("player");
  const now = Date.now();
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, hope: 3, effects: [], domainCards: { owned: [], loadout: [] } }));
  const ids = await t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const mapId = await ctx.db.insert("combatMaps", { campaignId, name: "Camp", live: true, source: "image", w: 10, h: 10, base: "grass", areas: [], seed: 1, schemaVersion: 1, updatedAt: now });
    const tokenA = await ctx.db.insert("combatTokens", { campaignId, mapId, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 1, y: 1, size: 1, face: 0, light: "none", revealedTo: [] });
    const bear = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bear",
      order: 0,
      summoned: false,
      stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    return { encounterId, mapId, tokenA, bear };
  });
  const hit = (target: Id<"characters">, amount: number, riders: HitRider[] = []) =>
    t.run(async (ctx) => {
      const groupId = `g-${key()}`;
      const opened = await openIncomingHit(ctx, {
        campaignId,
        encounterId: ids.encounterId,
        mapId: ids.mapId,
        createdBy: w.users.gm,
        groupId,
        attacker: { instanceId: ids.bear, label: "Bear" },
        targetCharacterId: target,
        hit: { amount, type: "physical", direct: false, forcedArmor: 0, critical: false },
        party: await partyMembers(ctx, campaignId),
        bands: await bandsOnMap(ctx, undefined),
        riders,
      });
      return { ...opened, groupId };
    });
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const bear = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", ids.bear))!);
  const respond = (requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) =>
    player.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId, choice: choice as never, idempotencyKey: key() });
  const pending = (characterId: Id<"characters">) => player.query(api.adversaryActionsReads.pending, { campaignId, characterId });
  /** An answer, then Done if a fitting answer keeps the window open (A1). */
  const answer = async (requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) => {
    const r = await respond(requestId, characterId, choice);
    if (r.status === "open") await respond(requestId, characterId, { kind: "pass" });
  };
  return { w, t, ids, edit, hit, sheet, bear, respond, pending, answer };
}

const TRANSFORMED = { id: `${effectKeyOf("book-of-ronin")}:1`, source: "Book of Ronin", text: "Transformed", until: "manual" as const };

describe("dcm-8f51: the hit PC's damage ends what they made on the adversaries", () => {
  async function silenced() {
    const a = await arena();
    await a.t.run((ctx) =>
      ctx.db.patch("encounterAdversaries", a.ids.bear, { effects: [{ id: `card:hush:1~${a.ids.tokenA}`, source: "Hush", label: "Silenced (Hush)", until: "temporary" }] }),
    );
    return a;
  }

  it("Major damage ends Hush's Silenced on the bear (logged for undo)", async () => {
    const a = await silenced();
    const { requestId } = await a.hit(a.w.characterA, 10);
    await a.answer(requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(2);
    expect((await a.bear()).effects ?? []).toEqual([]);
  });

  it("Minor damage leaves it", async () => {
    const a = await silenced();
    const { requestId } = await a.hit(a.w.characterA, 5);
    await a.answer(requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.bear()).effects?.map((e) => e.label)).toEqual(["Silenced (Hush)"]);
  });
});

describe("user answer 2026-10-31: taking damage means marking at least 1 HP", () => {
  it("a Minor hit the Armor Slot reduced to no HP leaves Transform; an unreduced one ends it", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ effects: [TRANSFORMED] }));
    const first = await a.hit(a.w.characterA, 5);
    await a.answer(first.requestId!, a.w.characterA, { kind: "armor", slots: 1 });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 0, armorMarked: 1 });
    expect((await a.sheet(a.w.characterA)).effects.map((e) => e.id)).toEqual([TRANSFORMED.id]);
    const second = await a.hit(a.w.characterA, 5);
    await a.answer(second.requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).effects).toEqual([]);
  });
});

describe("dcm-nnbl: Hope before forced HP", () => {
  it("a forced-HP hit with no damage asks the target; the Hope spent marks that many fewer HP", async () => {
    const a = await arena();
    const { requestId, resolution } = await a.hit(a.w.characterA, 0, [{ kind: "hp", amount: 2, reduceWithHope: true }]);
    expect(resolution).toBeNull();
    const [view] = await a.pending(a.w.characterA);
    expect(view!.grants).toEqual([{ id: "hope", label: expect.any(String), amount: 2 }]);
    await expect(a.respond(requestId!, a.w.characterA, { kind: "grant", id: "hope", amount: 3 })).rejects.toMatchObject({ data: { code: "NOT_A_RESPONDER" } });
    expect((await a.respond(requestId!, a.w.characterA, { kind: "grant", id: "hope", amount: 1 })).status).toBe("open");
    const [after] = await a.pending(a.w.characterA);
    expect(after!.grants).toBeUndefined();
    await a.answer(requestId!, a.w.characterA, { kind: "noArmor" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 1, hope: 2 });
  });

  it("forced HP without reduceWithHope offers nothing and lands whole", async () => {
    const a = await arena();
    const { requestId } = await a.hit(a.w.characterA, 0, [{ kind: "hp", amount: 2 }]);
    expect((await a.pending(a.w.characterA))[0]!.grants).toBeUndefined();
    await a.answer(requestId!, a.w.characterA, { kind: "noArmor" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 2, hope: 3 });
  });

  it("applyRiders spends Hope only on reducible HP, never more than held, Unstuck at double", () => {
    const sheet = { hp: 0, hpMax: 6, hope: 3, stress: 0, stressMax: 6, conditions: [], effects: [] } as unknown as CharacterSheet;
    const riders: HitRider[] = [{ kind: "hp", amount: 1 }, { kind: "hp", amount: 3, reduceWithHope: true }];
    expect(hopeReducibleHp(riders)).toBe(3);
    expect(applyRiders(sheet, riders, false, false, new Set(), { amount: 5 })).toMatchObject({ sheet: { hp: 1, hope: 0 }, hopeSpent: 3 });
    expect(applyRiders(sheet, riders, false, false, new Set(), { amount: 2, factor: 2 })).toMatchObject({ sheet: { hp: 3, hope: 1 }, hopeSpent: 2 });
  });
});

describe("dcm-5cn5: Money Talks' gold instead of HP", () => {
  const block = (steps: unknown[], attack?: "standard" | "any"): AdversaryFeatureEffect[] =>
    [{ adversaryId: "demon-of-avarice", feature: "Money Talks", uses: [{ id: "pay-instead", activation: { kind: "auto", trigger: { kind: "onTargetMarksHp", ...(attack ? { attack } : {}) } }, steps }] }] as unknown as AdversaryFeatureEffect[];
  const convert = { kind: "convertMarks", to: "targets", from: "hp", into: "gold" };

  it("an onTargetMarksHp use converting HP into gold grants it on the standard attack only", () => {
    expect(goldForHp(block([convert], "standard"), undefined)).toBe(true);
    expect(goldForHp(block([{ kind: "optional", id: "o", label: "Pay", by: "targets", steps: [convert] }]), undefined)).toBe(true);
    expect(goldForHp(block([convert], "standard"), "Claws")).toBe(false);
    expect(goldForHp(block([convert], "any"), undefined)).toBe(true);
    expect(goldForHp(block([{ kind: "manual", text: "pay gold" }], "standard"), undefined)).toBe(false);
  });
});
