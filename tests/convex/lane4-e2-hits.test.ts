/**
 * Plan lanes-2, tracer E2.4 (docs/tasks/TASK-LN4-E2.md): incoming hits, round 4, on the server.
 *
 * - dcm-12kx: a hit reads the mods adversaries put on PCs (Unstuck, CB p.237; Leechpoles, HF p.90; Ravenous, HF p.94).
 * - dcm-5gng / dcm-7vei: the hit's keyword walks reaction-roll branches, follow-ups and check tables; a feature whose
 *   branches disagree (Randomized Tactics: Fire Jets fire, Mana Beam not) gives no keyword.
 * - dcm-dztv: a standard attack's keyword comes from its stat block.
 * - dcm-sk4r (user answer 2026-10-31): a fire hit applies Fireproof (HF p.22: "You are immune to damage from magical or
 *   mundane flame") directly; a hit the data can't settle asks the GM "Was this hit fire?".
 * - dcm-n7kt: Fireproof stops a fire feature's outright HP marks.
 * - dcm-i9c1: the window's feature actor carries the sheet's stats (Armored Shell's Armor Score, CB p.33).
 * - dcm-8fc2: a reaction card's or feature's own roll ends Vanishing Act's Cloaked on Fear (CB p.42).
 *
 * Ash and Bryn wear Chainmail: thresholds 8 / 16 at level 1 (CB p.91: Minor 1 HP, Major 2 HP, Severe 3 HP).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  featureActor,
  hitKeyword,
  hitKeywordInfo,
  keywordGuards,
  markHpGuard,
  markHpKeyword,
  pcDamageMods,
  pcFlags,
  rollEnds,
  rollEndLines,
} from "../../convex/lib/adversaryHits";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import { adversaryEffects } from "../../src/lib/srd/adversary-effects/index";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

const EMBERKIN = { ancestry: { kind: "single" as const, id: "emberkin" } };

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const player = w.as("player");
  const gm = w.as("gm");
  const now = Date.now();
  // Emberkin is Hope & Fear content (HF p.22).
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { options: { hopeAndFear: true } }));
  const edit =(id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, hope: 3, effects: [], domainCards: { owned: [], loadout: [] } }));
  const ids = await t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const instance = (adversaryId: string, label: string) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order: 0,
        summoned: false,
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 4 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
    return { encounterId, bear: await instance("bear", "Bear"), sorcerer: await instance("fallen-sorcerer", "Sorcerer"), box: await instance("battle-box", "Box") };
  });
  const hit = (target: Id<"characters">, attacker: { instanceId: Id<"encounterAdversaries">; label: string; feature?: string }, amount: number, type: "physical" | "magic" = "physical") =>
    t.run(async (ctx) =>
      openIncomingHit(ctx, {
        campaignId,
        encounterId: ids.encounterId,
        createdBy: w.users.gm,
        groupId: `g-${key()}`,
        attacker,
        targetCharacterId: target,
        hit: { amount, type, direct: false, forcedArmor: 0, critical: false },
        party: await partyMembers(ctx, campaignId),
        bands: await bandsOnMap(ctx, undefined),
      }),
    );
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const row = (id: Id<"combatRequests">) => t.run(async (ctx) => (await ctx.db.get("combatRequests", id))!);
  const respond = (requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) =>
    player.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId, choice: choice as never, idempotencyKey: key() });
  const pending = (characterId: Id<"characters">) => player.query(api.adversaryActions.pending, { campaignId, characterId });
  const asks = () => gm.query(api.hitKeywords.asks, { campaignId });
  const answer = (requestId: Id<"combatRequests">, carries: boolean) => gm.mutation(api.hitKeywords.answer, { campaignId, requestId, answer: { keyword: "fire", carries }, idempotencyKey: key() });
  return { w, t, ids, edit, hit, sheet, row, respond, pending, asks, answer, player, gm };
}

describe("dcm-12kx: a hit reads what adversaries put on the PC", () => {
  it("Unstuck doubles the marks, Leechpoles add their tokens", async () => {
    const a = await arena();
    // In memory: these two ids exceed the sheet's 40-character effect id limit, so they can't be saved (follow-up for lane E7, TASK-LN4-E2.md).
    const s: CharacterSheet = {
      ...(await a.sheet(a.w.characterA)),
      effects: [
        { id: "card:outer-realms-abomination/Reality Quake:1", source: "Reality Quake", text: "Unstuck", until: "manual" },
        { id: "card:cephilith-abomination/Burrowing Leechpoles:1", source: "Burrowing Leechpoles", text: "Leechpoles", until: "manual" },
      ],
      creatureTokens: [{ name: "leechpole", count: 3 }],
    };
    expect(pcDamageMods(s, true)).toEqual({ damageTakenBonus: 3, marksMultiplier: { factor: 2, of: expect.arrayContaining(["hope", "armor", "hp", "stress"]) } });
    expect(pcDamageMods({ ...s, creatureTokens: [] }, true)).not.toHaveProperty("damageTakenBonus");
  });

  it("the flags of an adversary's condition reach the payers (Ravenous, HF p.94)", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ effects: [{ id: "card:harbinger-of-famine/Hunger Pangs:1", source: "Hunger Pangs", text: "Ravenous", until: "manual" }] }));
    expect(pcFlags(await a.sheet(a.w.characterA), true)).toEqual({ flags: ["cannotSpendHope"] });
    expect(pcFlags(await a.sheet(a.w.characterB), true)).toEqual({});
  });
});

describe("dcm-5gng / dcm-7vei / dcm-dztv: the hit's keyword", () => {
  it("walks reaction-roll branches and follow-ups; disagreeing branches give none", () => {
    expect(hitKeyword(adversaryEffects("archmage"), "Fireball")).toBe("fire");
    expect(hitKeyword(adversaryEffects("battle-box"), "Randomized Tactics")).toBeUndefined();
    expect(hitKeywordInfo(adversaryEffects("battle-box"), "Randomized Tactics")).toEqual({ known: false });
    expect(hitKeywordInfo(adversaryEffects("fallen-sorcerer"), "Conflagration")).toEqual({ keyword: "fire", known: true });
  });

  it("a standard attack reads its stat block's keyword (known for an SRD block, not for a custom one)", () => {
    expect(hitKeywordInfo([], undefined, { keyword: "fire" })).toEqual({ keyword: "fire", known: true });
    expect(hitKeywordInfo([], undefined, {})).toEqual({ known: true });
    expect(hitKeywordInfo([], undefined)).toEqual({ known: false });
  });
});

describe("dcm-sk4r: Fireproof and the GM's ask", () => {
  it("a fire hit is ignored by Fireproof, which isn't offered as an answer", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => EMBERKIN);
    expect(keywordGuards(await a.sheet(a.w.characterA), true)).toEqual([expect.objectContaining({ keyword: "fire", feature: "Fireproof", immune: true })]);
    const { requestId } = await a.hit(a.w.characterA, { instanceId: a.ids.sorcerer, label: "Sorcerer", feature: "Conflagration" }, 20, "magic");
    expect((await a.row(requestId!)).payload).not.toHaveProperty("keywordAsk");
    const [view] = await a.pending(a.w.characterA);
    expect((view?.features ?? []).map((f) => f.name)).not.toContain("Fireproof");
    if ((await a.row(requestId!)).status === "open") await a.respond(requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(0);
  });

  it("a known non-fire hit (the bear's standard attack) asks nothing and marks HP", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => EMBERKIN);
    const { requestId } = await a.hit(a.w.characterA, { instanceId: a.ids.bear, label: "Bear" }, 10);
    expect((await a.row(requestId!)).payload).not.toHaveProperty("keywordAsk");
    await a.respond(requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(2);
  });

  it("an unsettled hit waits for the GM: yes, fire → no HP", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => EMBERKIN);
    const { requestId, resolution } = await a.hit(a.w.characterA, { instanceId: a.ids.box, label: "Box", feature: "Randomized Tactics" }, 10);
    expect(resolution).toBeNull();
    expect((await a.row(requestId!)).payload).toMatchObject({ keywordAsk: { keyword: "fire", characterId: a.w.characterA, feature: "Fireproof" } });
    expect(await a.asks()).toEqual([expect.objectContaining({ requestId, targetName: expect.any(String), question: "Was this hit fire? (Fireproof)" })]);
    // The target's armor answer alone doesn't resolve it: the ask holds the hit.
    expect((await a.respond(requestId!, a.w.characterA, { kind: "noArmor" })).status).toBe("open");
    expect((await a.answer(requestId!, true)).status).toBe("resolved");
    expect((await a.sheet(a.w.characterA)).hp).toBe(0);
    expect((await a.row(requestId!)).payload).toMatchObject({ keywordAsk: { answer: true, answeredBy: a.w.users.gm } });
    expect(await a.asks()).toEqual([]);
  });

  it("no, not fire → the hit marks HP; a second answer is refused", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => EMBERKIN);
    const { requestId } = await a.hit(a.w.characterA, { instanceId: a.ids.box, label: "Box", feature: "Randomized Tactics" }, 10);
    expect((await a.answer(requestId!, false)).status).toBe("open");
    await expect(a.answer(requestId!, true)).rejects.toMatchObject({ data: { code: "REQUEST_NOT_OPEN" } });
    await a.respond(requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(2);
  });

  it("a PC without a guard is never asked", async () => {
    const a = await arena();
    const { requestId } = await a.hit(a.w.characterA, { instanceId: a.ids.box, label: "Box", feature: "Randomized Tactics" }, 10);
    expect((await a.row(requestId!)).payload).not.toHaveProperty("keywordAsk");
  });

  it("players can't answer or list the asks", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => EMBERKIN);
    const { requestId } = await a.hit(a.w.characterA, { instanceId: a.ids.box, label: "Box", feature: "Randomized Tactics" }, 10);
    await expect(a.player.mutation(api.hitKeywords.answer, { campaignId: a.w.campaignId, requestId: requestId!, answer: { keyword: "fire", carries: true }, idempotencyKey: key() })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(a.player.query(api.hitKeywords.asks, { campaignId: a.w.campaignId })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
});

describe("dcm-n7kt: Fireproof stops a fire feature's outright HP marks", () => {
  const beam = [
    {
      feature: "Fire Beam",
      uses: [{ id: "main", activation: { kind: "action" }, steps: [{ kind: "save", to: "targets", difficulty: { kind: "fixed", value: 15 }, onFail: [{ kind: "markHp", to: "targets", amount: { kind: "fixed", value: 3 }, keyword: "fire" }], onSuccess: [{ kind: "markHp", to: "targets", amount: { kind: "fixed", value: 1 }, keyword: "fire" }] }] }],
    },
  ] as unknown as AdversaryFeatureEffect[];

  it("reads the markHp keyword and the guard that stops it", async () => {
    expect(markHpKeyword(beam, "Fire Beam")).toBe("fire");
    expect(markHpKeyword(beam, undefined)).toBeUndefined();
    const a = await arena();
    await a.edit(a.w.characterA, () => EMBERKIN);
    expect(markHpGuard(await a.sheet(a.w.characterA), true, "fire")).toMatchObject({ feature: "Fireproof" });
    expect(markHpGuard(await a.sheet(a.w.characterB), true, "fire")).toBeNull();
    expect(markHpGuard(await a.sheet(a.w.characterA), true, undefined)).toBeNull();
  });
});

describe("dcm-i9c1: the window's feature actor carries the sheet's stats", () => {
  it("Armor Score, thresholds and Evasion are bound", async () => {
    const a = await arena();
    const s = await a.sheet(a.w.characterA);
    expect(featureActor("pc", s).stats).toMatchObject({ armorScore: expect.any(Number), majorThreshold: 8, severeThreshold: 16 });
    expect(featureActor("pc", s).stats!.armorScore).toBeGreaterThan(0);
  });
});

describe("dcm-8fc2: a window answer's own roll ends Cloaked on Fear", () => {
  const marker: Effect = { id: `${effectKeyOf("subclass:nightwalker:vanishing-act")}:1`, source: "Vanishing Act", text: "cloaked", until: "rest" };
  const sheet = { conditions: ["cloaked"], effects: [marker] } as unknown as CharacterSheet;
  const plan = (outcome: "successFear" | "successHope") => ({ roll: { record: { kind: "reaction", dice: [], modifier: 0, total: 12, outcome, manual: false } } }) as never;

  it("a roll with Fear ends it and names it; with Hope it stays", () => {
    expect(rollEnds(sheet, plan("successFear")).sheet.conditions).toEqual([]);
    expect(rollEndLines("Ash", sheet, plan("successFear"))).toEqual(["Ash: Cloaked ends (Vanishing Act)"]);
    expect(rollEnds(sheet, plan("successHope")).sheet.conditions).toEqual(["cloaked"]);
    expect(rollEnds(sheet, { roll: null } as never).sheet).toBe(sheet);
  });
});
