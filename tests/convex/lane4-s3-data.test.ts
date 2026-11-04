/**
 * Plan lanes-2 wave 10, tracer S3.4 (docs/tasks/TASK-LN4-S3.md): tier 1-2 adversary data switched onto live engine
 * paths, each proven through the real server path with the SRD data (no test-only entries).
 *
 * - dcm-dztv: the fire standard attacks (Minor Fire Elemental Elemental Blast, CB p.214; Redcap Candlemaker Burning
 *   Candlestick, HF p.67; Guahalan Spirit Singer Spirit Flame, HF p.77; Catrin Spirit Flame, HF p.81, user 2026-11-01)
 *   carry `keyword: "fire"`; a Fireproof PC (HF p.22) takes nothing and the GM isn't asked.
 * - dcm-0hlq: Encumber (CB p.218): the GM's Escaped clears the bramble tokens and the "spawn" use summons that many
 *   Tangle Bramble Minions.
 * - dcm-nh44 / dcm-mvgc: Stone of Omens (HF p.62): the GM's ask lists the Hope split among the PCs.
 * - dcm-spj0: Tentacle Rays' Doom (HF p.75): every unmarked HP, offered to the PC's Hope first in their own window.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

/** Evasion -10: every attack hits (as adversary-actions.test.ts). */
const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };
const EMBERKIN = { ancestry: { kind: "single" as const, id: "emberkin" } };
const FIRE_ATTACKS = ["minor-fire-elemental", "redcap-candlemaker", "guahalan-spirit-singer", "catrin"];

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const now = Date.now();
  // Emberkin's Fireproof and the Hope & Fear adversaries need the option (HF p.22).
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { options: { hopeAndFear: true } }));
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, hope: 3, effects: [EASY], domainCards: { owned: [], loadout: [] } }));
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const add = (adversaryId: string, label: string, order = 0) =>
    t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order,
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
      }),
    );
  const hit = (target: Id<"characters">, instanceId: Id<"encounterAdversaries">, label: string, amount: number) =>
    t.run(async (ctx) =>
      openIncomingHit(ctx, {
        campaignId,
        encounterId,
        createdBy: w.users.gm,
        groupId: `g-${key()}`,
        attacker: { instanceId, label },
        targetCharacterId: target,
        hit: { amount, type: "magic", direct: false, forcedArmor: 0, critical: false },
        party: await partyMembers(ctx, campaignId),
        bands: await bandsOnMap(ctx, undefined),
      }),
    );
  const row = (id: Id<"combatRequests">) => t.run(async (ctx) => (await ctx.db.get("combatRequests", id))!);
  const respond = (requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) =>
    player.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId, choice: choice as never, idempotencyKey: key() });
  const setFear = (n: number) =>
    t.run(async (ctx) => {
      const s = await campaignFearState(ctx, campaignId);
      await ctx.db.patch(s._id, { fear: n });
    });
  return { w, t, gm, campaignId, add, edit, sheet, hit, row, respond, setFear };
}

describe("dcm-dztv: fire standard attacks", () => {
  it("the four stat blocks carry the fire keyword", () => {
    for (const id of FIRE_ATTACKS) expect(ADVERSARIES.find((a) => a.id === id)?.attack.keyword).toBe("fire");
    // A non-fire attack carries none.
    expect(ADVERSARIES.find((a) => a.id === "bear")?.attack.keyword).toBeUndefined();
  });

  it.each(FIRE_ATTACKS)("%s's standard attack: Fireproof takes nothing and the GM isn't asked", async (adversaryId) => {
    const a = await arena();
    await a.edit(a.w.characterA, () => EMBERKIN);
    const instance = await a.add(adversaryId, "Burner");
    const { requestId } = await a.hit(a.w.characterA, instance, "Burner", 20);
    expect((await a.row(requestId!)).payload).not.toHaveProperty("keywordAsk");
    if ((await a.row(requestId!)).status === "open") await a.respond(requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(0);
  });

  it("a PC without Fireproof still marks HP from it", async () => {
    const a = await arena();
    const instance = await a.add("minor-fire-elemental", "Elemental");
    const { requestId } = await a.hit(a.w.characterA, instance, "Elemental", 10);
    await a.respond(requestId!, a.w.characterA, { kind: "noArmor" });
    expect((await a.sheet(a.w.characterA)).hp).toBe(2);
  });
});

describe("dcm-0hlq: Encumber's escape spawns Minions (CB p.218)", () => {
  it("the GM's Escaped clears the tokens and summons one Tangle Bramble per token", async () => {
    const a = await arena();
    await a.add("tangle-bramble-swarm", "Swarm");
    await a.edit(a.w.characterA, () => ({ creatureTokens: [{ name: "bramble", count: 3 }] }));
    const res = await a.gm.mutation(api.adversaryActions.pcEscape, { campaignId: a.campaignId, characterId: a.w.characterA, name: "bramble", idempotencyKey: key() });
    expect(res.tokens).toBe(3);
    expect(res.lines.some((l) => l.includes("Encumber (automatic)"))).toBe(true);
    expect(res.prompts).toContainEqual(expect.objectContaining({ kind: "summon", text: expect.stringMatching(/^Summon 3 Tangle Bramble within melee/) }));
    expect((await a.sheet(a.w.characterA)).creatureTokens).toBeUndefined();
  });
});

describe("dcm-nh44 / dcm-mvgc: Stone of Omens (HF p.62)", () => {
  it("the GM's ask targets every PC and lists the Hope split", async () => {
    const a = await arena();
    const atototl = await a.add("atototl", "Atototl");
    const ask = await a.gm.query(api.adversaryActions.featureAsk, { campaignId: a.campaignId, instanceId: atototl, feature: "Stone of Omens" });
    expect(ask.splits).toEqual([{ what: "hope", among: "targets" }]);
    expect(ask.targets).toMatchObject({ count: "all" });
  });
});

describe("dcm-spj0: Tentacle Rays' Doom (HF p.75)", () => {
  it("a hit with the Doom beam opens the PC's window: every unmarked HP, bought down with Hope", async () => {
    const a = await arena();
    await a.setFear(3);
    const gob = await a.add("gobstalker", "Gobstalker");
    await a.edit(a.w.characterA, () => ({ hp: 2 }));
    const res = await a.gm.mutation(api.adversaryActions.useFeature, {
      campaignId: a.campaignId,
      instanceId: gob,
      feature: "Tentacle Rays",
      targets: [a.w.characterA],
      options: [
        { id: "how", values: ["pick"] },
        { id: "beam", values: ["3"] },
      ],
      spendFear: 1,
      idempotencyKey: key(),
    });
    expect(res.status).toBe("resolved");
    // Nothing marked yet: the window waits for the PC's Hope.
    const s = await a.sheet(a.w.characterA);
    expect(s.hp).toBe(2);
    const rows = await a.t.run((ctx) => ctx.db.query("combatRequests").withIndex("by_campaign_status", (q) => q.eq("campaignId", a.campaignId).eq("status", "open")).collect());
    const window = rows.find((r) => r.payload.kind === "incomingHit" && r.payload.targetCharacterId === a.w.characterA);
    expect(window?.payload.kind === "incomingHit" ? window.payload.riders : undefined).toEqual([{ kind: "hp", amount: s.hpMax - 2, reduceWithHope: true }]);
  });
});
