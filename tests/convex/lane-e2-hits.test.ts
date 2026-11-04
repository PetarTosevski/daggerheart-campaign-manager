/**
 * Plan lanes, tracer E2 (docs/tasks/TASK-LN-E2.md): incoming hits on the server.
 *
 * - dcm-fyb (user answer 2026-10-30): a successful adversary attack runs `expire(sheet, "hit")` for the PC who took it
 *   (Rogue's Dodge, CB p.42: "+2 bonus to your Evasion until the next time an attack succeeds against you").
 * - dcm-nt4: a PC's resistance from the effects on their sheet applies to the hit (CB p.99: "they halve damage of that
 *   type before comparing it to their damage thresholds"; Retract, CB p.61: "While in your shell, you have resistance to physical damage").
 * - dcm-s77: the attacker's dearer Armor Slots, read from its stat block (a fixture `armorCost` step on the Bear here;
 *   Armor Eater, HF p.71: "that PC must mark an additional Armor Slot to reduce the severity of the damage").
 *
 * Ash and Bryn wear Chainmail: thresholds 8 / 16 at level 1 (CB p.91: Minor 1 HP, Major 2 HP, Severe 3 HP).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

/** A fixture Armor Eater on the Bear (wave 5 writes the real one on the Dire Pangolati). */
const ARMOR_EATER: AdversaryFeatureEffect = {
  adversaryId: "bear",
  feature: "Armor Eater (fixture)",
  uses: [{ id: "main", activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } }, needsSpotlight: false, steps: [{ kind: "armorCost", to: "targets", slotsPerStep: 2 }] }],
};
let eater = false;

vi.mock("../../src/lib/srd/adversary-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/adversary-effects/index")>();
  return { ...real, adversaryEffects: (id: string) => (eater && id === "bear" ? [...real.adversaryEffects(id), ARMOR_EATER] : real.adversaryEffects(id)) };
});

allowWorldEmails();

afterEach(() => {
  eater = false;
  vi.restoreAllMocks();
});

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const player = w.as("player");
  const gm = w.as("gm");
  const now = Date.now();
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, hope: 3, effects: [], domainCards: { owned: [], loadout: [] } }));
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const bear = await t.run((ctx) =>
    ctx.db.insert("encounterAdversaries", {
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
    }),
  );
  const hit = (target: Id<"characters">, amount: number, attackTotal?: number, groupId = `g-${key()}`) =>
    t.run(async (ctx) => {
      const party = await partyMembers(ctx, campaignId);
      const opened = await openIncomingHit(ctx, {
        campaignId,
        encounterId,
        createdBy: w.users.gm,
        groupId,
        attacker: { instanceId: bear, label: "Bear" },
        targetCharacterId: target,
        hit: { amount, type: "physical", direct: false, forcedArmor: 0, critical: false, ...(attackTotal !== undefined ? { attackTotal } : {}) },
        party,
        bands: await bandsOnMap(ctx, undefined),
      });
      return { ...opened, groupId };
    });
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const respond = (c: Client, requestId: Id<"combatRequests">, characterId: Id<"characters">, choice: Record<string, unknown>) =>
    c.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId, choice: choice as never, idempotencyKey: key() });
  const pending = (c: Client, characterId: Id<"characters">) => c.query(api.adversaryActions.pending, { campaignId, characterId });
  /** "Don't mark", then Done if a fitting answer keeps the window open (A1). */
  const noArmor = async (requestId: Id<"combatRequests">, characterId: Id<"characters">) => {
    const r = await respond(player, requestId, characterId, { kind: "noArmor" });
    if (r.status === "open") await respond(player, requestId, characterId, { kind: "pass" });
  };
  const publicRow = (groupId: string) => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).find((r) => r.groupId === groupId && r.visibility === "public")!);
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, player, edit, hit, sheet, respond, pending, noArmor, publicRow, undo };
}

const DODGE = { id: "class:dodge", source: "Dodge", text: "Dodge: +2 Evasion", until: "hit" as const, mods: { evasion: 2 } };
const LONG = { id: "class:other", source: "Other", text: "Other", until: "longRest" as const };

describe("E2 dcm-fyb: a successful adversary attack ends until-hit effects", () => {
  it("the hit PC's Dodge ends; a longer effect stays; the GM's undo brings it back", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ effects: [DODGE, LONG] }));
    const { requestId, groupId } = await a.hit(a.w.characterA, 10, 18);
    await a.noArmor(requestId!, a.w.characterA);
    expect((await a.sheet(a.w.characterA)).effects.map((e) => e.id)).toEqual(["class:other"]);
    await a.undo((await a.publicRow(groupId))._id);
    expect((await a.sheet(a.w.characterA)).effects.map((e) => e.id)).toEqual(["class:dodge", "class:other"]);
  });

  it("a hit without an attack roll (a feature's reaction-roll damage) leaves it; so does an ally's sheet", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ effects: [DODGE] }));
    await a.edit(a.w.characterB, () => ({ effects: [DODGE] }));
    const { requestId } = await a.hit(a.w.characterA, 10);
    await a.noArmor(requestId!, a.w.characterA);
    expect((await a.sheet(a.w.characterA)).effects.map((e) => e.id)).toEqual(["class:dodge"]);
    const second = await a.hit(a.w.characterA, 10, 18);
    await a.noArmor(second.requestId!, a.w.characterA);
    expect((await a.sheet(a.w.characterA)).effects).toEqual([]);
    expect((await a.sheet(a.w.characterB)).effects.map((e) => e.id)).toEqual(["class:dodge"]);
  });
});

describe("E2 dcm-nt4: the PC's resistance applies to the hit", () => {
  it("Retract (Galapa) halves 17 physical to 9: Major, 2 HP instead of Severe", async () => {
    const a = await arena();
    const retract = { id: `${effectKeyOf("ancestry:galapa:retract")}:1`, source: "Retract", text: "Retracted into your shell; ends when You come out of your shell", until: "manual" as const };
    await a.edit(a.w.characterA, () => ({ effects: [retract] }));
    const { requestId } = await a.hit(a.w.characterA, 17);
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view).toMatchObject({ damage: 17, severity: "major" });
    await a.noArmor(requestId!, a.w.characterA);
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 2 });
  });

  it("without the effect the same hit is Severe: 3 HP", async () => {
    const a = await arena();
    const { requestId } = await a.hit(a.w.characterA, 17);
    await a.noArmor(requestId!, a.w.characterA);
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 3 });
  });
});

describe("E2 dcm-s77: the attacker's dearer Armor Slots", () => {
  it("Armor Eater on the attacker: the hit PC marks 2 slots for one step; 1 slot is refused (INVALID)", async () => {
    eater = true;
    const a = await arena();
    const { requestId } = await a.hit(a.w.characterA, 10);
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view).toMatchObject({ damage: 10, severity: "major", maxSlots: 2 });
    expect(view!.armorPreview).toEqual([
      { slots: 0, severity: "major", hp: 2 },
      { slots: 2, severity: "minor", hp: 1 },
    ]);
    expect(await code(a.respond(a.player, requestId!, a.w.characterA, { kind: "armor", slots: 1 }))).toBe("INVALID");
    const r = await a.respond(a.player, requestId!, a.w.characterA, { kind: "armor", slots: 2 });
    if (r.status === "open") await a.respond(a.player, requestId!, a.w.characterA, { kind: "pass" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 1, armorMarked: 2 });
  });

  it("without it one slot is one step (CB p.114)", async () => {
    const a = await arena();
    const { requestId } = await a.hit(a.w.characterA, 10);
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view).toMatchObject({ maxSlots: 1 });
    const r = await a.respond(a.player, requestId!, a.w.characterA, { kind: "armor", slots: 1 });
    if (r.status === "open") await a.respond(a.player, requestId!, a.w.characterA, { kind: "pass" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 1, armorMarked: 1 });
  });
});
