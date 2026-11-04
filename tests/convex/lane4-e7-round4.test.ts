/**
 * Plan lanes-2 wave 10, tracer E7.4 (docs/tasks/TASK-LN4-E7.md): the adversary server, round 4. Condition markers on PCs
 * (dcm-1alq), creature tokens on PC sheets and the PC's escape (dcm-wiwi, dcm-0hlq; Encumber, CB p.218), stored instance
 * condition ends (dcm-thwj), the forced-attack roll request (dcm-uxsd opener), Hope before forced HP with no hit
 * (dcm-spj0; Doom, HF p.75) and the GM ask's Hope splits (dcm-mvgc; Stone of Omens, HF p.62).
 */
import { afterEach, describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { forcedTargetTokens, openForcedAttacks } from "../../convex/lib/forcedAttacks";
import { ADVERSARY_EFFECTS } from "../../src/lib/srd/adversary-effects/index";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

/** Evasion -10: every attack hits (as adversary-actions.test.ts). */
const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };
const STATS = { difficulty: 14, major: 10, severe: 18, hpMax: 7, stressMax: 4 };

// Test-only entries added to an SRD adversary's table (the server reads ADVERSARY_EFFECTS); removed after each test.
const patched: { id: string; list: readonly AdversaryFeatureEffect[] | undefined }[] = [];
function addEffect(adversaryId: string, effect: AdversaryFeatureEffect) {
  const map = ADVERSARY_EFFECTS as Map<string, readonly AdversaryFeatureEffect[]>;
  patched.push({ id: adversaryId, list: map.get(adversaryId) });
  map.set(adversaryId, [...(map.get(adversaryId) ?? []), effect]);
}
afterEach(() => {
  const map = ADVERSARY_EFFECTS as Map<string, readonly AdversaryFeatureEffect[]>;
  for (const p of patched.reverse()) {
    if (p.list === undefined) map.delete(p.id);
    else map.set(p.id, p.list);
  }
  patched.length = 0;
});

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, hope: 3, effects: [EASY], domainCards: { owned: [], loadout: [] } }));
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const add = (adversaryId: string, label: string, order: number, extra: Record<string, unknown> = {}) =>
    t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order,
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
  const get = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  return { w, t, gm, campaignId, encounterId, add, edit, sheet, get };
}

async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("dcm-1alq / dcm-wiwi: Encumber on a PC (CB p.218)", () => {
  it("stores the bramble token on the sheet and Restrained with its ac: marker", async () => {
    const { w, gm, campaignId, add, sheet } = await arena();
    const swarm = await add("tangle-bramble-swarm", "Swarm", 0);
    const res = await gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: swarm, feature: "Encumber", targets: [], trigger: { subjectId: w.characterA }, idempotencyKey: key() });
    expect(res.status).toBe("resolved");
    const s = await sheet(w.characterA);
    expect(s.creatureTokens).toEqual([{ name: "bramble", count: 1 }]);
    expect(s.conditions).toContain("restrained");
    const marker = s.effects.find((e) => e.id.startsWith("ac:"));
    expect(marker?.text).toMatch(/Restrained until Swarm takes Major damage or more/);
    expect(marker?.text).toContain(`"by":"${swarm}"`);
    // The GM's list of PC tokens names it.
    expect(await gm.query(api.adversaryActions.pcTokens, { campaignId })).toEqual([expect.objectContaining({ characterId: w.characterA, name: "bramble", count: 1 })]);
  });
});

describe("dcm-0hlq: a PC escapes the tokens; pcEscapes fires", () => {
  it("clears the tokens and runs an automatic pcEscapes use with trigger amount = tokens", async () => {
    const { w, gm, campaignId, add, edit, sheet } = await arena();
    addEffect("tangle-bramble-swarm", {
      adversaryId: "tangle-bramble-swarm",
      feature: "Test Escape Fear",
      uses: [{ id: "main", activation: { kind: "auto", trigger: { kind: "pcEscapes", name: "bramble" } }, needsSpotlight: false, steps: [{ kind: "fear", to: "self", change: "gain", amount: { kind: "triggerAmount" } }] }],
    });
    await add("tangle-bramble-swarm", "Swarm", 0);
    await edit(w.characterA, () => ({ creatureTokens: [{ name: "bramble", count: 2 }] }));
    const fearBefore = (await gm.query(api.campaigns.fear, { campaignId }))!; // the GM always gets a number (R1)
    const res = await gm.mutation(api.adversaryActions.pcEscape, { campaignId, characterId: w.characterA, name: "bramble", idempotencyKey: key() });
    expect(res.tokens).toBe(2);
    expect(res.lines.some((l) => l.includes("Test Escape Fear (automatic)"))).toBe(true);
    expect((await sheet(w.characterA)).creatureTokens).toBeUndefined();
    const fearAfter = await gm.query(api.campaigns.fear, { campaignId });
    expect(fearAfter).toBe(Math.min(12, fearBefore + 2));
    // Nothing left to escape: INVALID.
    expect(await codeOf(() => gm.mutation(api.adversaryActions.pcEscape, { campaignId, characterId: w.characterA, name: "bramble", idempotencyKey: key() }))).toBe("INVALID");
  });
});

describe("dcm-thwj: stored condition ends on instances", () => {
  it("its own attack roll ends a condition whose endsOnRoll is an action roll", async () => {
    const { w, gm, campaignId, add, get } = await arena();
    const troll = await add("mountain-troll", "Troll", 0, {
      conditions: ["vulnerable"],
      effects: [{ id: "card:test:1", source: "Test", label: "vulnerable", until: "temporary", condition: "vulnerable", casterId: w.characterA, endsOnRoll: { roll: "action" } }],
    });
    const res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: troll, targets: [w.characterA], spendFear: 1, idempotencyKey: key() });
    expect(res.status).toBe("resolved");
    const after = await get(troll);
    expect(after.conditions).not.toContain("vulnerable");
    expect(after.effects ?? []).toEqual([]);
  });

  it("the caster's roll ends what it gave an ally (caster endsOnRoll); other modifiers stay", async () => {
    const { w, gm, campaignId, add, get } = await arena();
    const troll = await add("mountain-troll", "Troll", 0);
    const ally = await add("mountain-troll", "Ally", 1, {
      tags: ["Shielded"],
      effects: [
        { id: "adv:x:1", source: "Test", label: "Shielded", until: "temporary", condition: "Shielded", casterId: troll, endsOnRoll: { roll: "action", by: "caster" } },
        { id: "adv:y:1", source: "Other", label: "Kept", until: "temporary", difficulty: 1 },
      ],
    });
    await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: troll, targets: [w.characterA], spendFear: 1, idempotencyKey: key() });
    const a = await get(ally);
    expect(a.tags).not.toContain("Shielded");
    expect((a.effects ?? []).map((e) => e.id)).toEqual(["adv:y:1"]);
  });
});

describe("dcm-0wj1 / dcm-f0m: bearer riders on itself run when it acts", () => {
  it("On Fire (Cinder Grasp, CB p.328): the instance takes 2d6 magic damage after its action", async () => {
    const { w, gm, campaignId, add, get, t } = await arena();
    const troll = await add("mountain-troll", "Troll", 0, { tags: ["On Fire"] });
    await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: troll, targets: [w.characterA], spendFear: 1, idempotencyKey: key() });
    expect((await get(troll)).hp).toBeGreaterThan(0);
    const rows = await t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
    expect(rows.some((r) => r.visibility === "gm" && /On Fire \(.*\): Troll acts and takes \d+ magic damage/.test(r.summary))).toBe(true);
  });
});

describe("dcm-spj0: Hope before forced HP with no hit (Doom, HF p.75)", () => {
  it("opens a window whose rider is the HP the PC may buy down with Hope", async () => {
    const { w, gm, campaignId, add, sheet, t } = await arena();
    addEffect("mountain-troll", {
      adversaryId: "mountain-troll",
      feature: "Test Doom",
      uses: [{ id: "main", activation: { kind: "action" }, needsSpotlight: false, targets: { side: "enemy", range: "unlimited", count: { kind: "one" } }, steps: [{ kind: "markHp", to: "targets", amount: { kind: "fixed", value: 3 }, reduceWith: "hope" }] }],
    });
    const troll = await add("mountain-troll", "Troll", 0);
    const res = await gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: troll, feature: "Test Doom", targets: [w.characterA], idempotencyKey: key() });
    expect(res.status).toBe("resolved");
    // Nothing marked yet: the window waits for the PC.
    expect((await sheet(w.characterA)).hp).toBe(0);
    const rows = await t.run((ctx) => ctx.db.query("combatRequests").withIndex("by_campaign_status", (q) => q.eq("campaignId", campaignId).eq("status", "open")).collect());
    const hit = rows.find((r) => r.payload.kind === "incomingHit" && r.payload.targetCharacterId === w.characterA);
    expect(hit).toBeDefined();
    expect(hit!.payload.kind === "incomingHit" ? hit!.payload.riders : undefined).toEqual([{ kind: "hp", amount: 3, reduceWithHope: true }]);
  });
});

describe("dcm-uxsd opener: a forced PC attack is a roll request", () => {
  it("writes one forcedAttack row per PC with the named targets' tokens locked; a newer one replaces the older", async () => {
    const { w, t, gm, campaignId, encounterId, add } = await arena();
    const troll = await add("mountain-troll", "Gobstalker", 0);
    const gmId = w.users.gm;
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
    const ids = await t.run(async (ctx) => {
      const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
      const pcToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 1, y: 1, face: 0 });
      const advToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: troll }, side: "enemy", x: 2, y: 2, face: 0 });
      const tokens = [await ctx.db.get("combatTokens", pcToken), await ctx.db.get("combatTokens", advToken)].filter((x) => x !== null);
      const input = { campaignId, encounterId, mapId, createdBy: gmId, groupId: "g1", instance: { _id: troll, label: "Gobstalker" }, feature: "Tentacle Rays", characterIds: [w.characterA], againstIds: [w.characterB, w.characterA], tokens };
      const first = await openForcedAttacks(ctx, input);
      const second = await openForcedAttacks(ctx, { ...input, groupId: "g2" });
      return { first, second, pcToken };
    });
    const rows = await t.run(async (ctx) => Promise.all([...ids.first, ...ids.second].map((id) => ctx.db.get("combatRequests", id))));
    expect(rows[0]!.status).toBe("declined");
    expect(rows[1]!.status).toBe("open");
    expect(rows[1]!.payload).toEqual({ schemaVersion: 1, kind: "forcedAttack", characterId: w.characterA, instanceId: troll, instanceLabel: "Gobstalker", feature: "Tentacle Rays", targetTokenIds: [ids.pcToken], groupId: "g2" });
  });

  it("forcedTargetTokens skips the attacker and unknown creatures", () => {
    const tokens = [{ _id: "t1", ref: { kind: "pc", characterId: "a" } }, { _id: "t2", ref: { kind: "adversary", adversaryId: "x" } }] as never;
    expect(forcedTargetTokens(tokens, ["a", "x", "nobody", "x"], "a")).toEqual(["t2"]);
  });
});

describe("dcm-mvgc: the GM's ask lists Hope splits", () => {
  it("a split Hope gain is asked like a damage split", async () => {
    const { gm, campaignId, add } = await arena();
    addEffect("mountain-troll", {
      adversaryId: "mountain-troll",
      feature: "Test Omens",
      uses: [{ id: "main", activation: { kind: "action" }, needsSpotlight: false, targets: { side: "enemy", range: "unlimited", count: { kind: "all" } }, steps: [{ kind: "hope", to: "targets", change: "gain", amount: { kind: "fixed", value: 2 }, distribution: "split" }] }],
    });
    const troll = await add("mountain-troll", "Troll", 0);
    const ask = await gm.query(api.adversaryActions.featureAsk, { campaignId, instanceId: troll, feature: "Test Omens" });
    expect(ask.splits).toEqual([{ what: "hope", among: "targets" }]);
  });
});
