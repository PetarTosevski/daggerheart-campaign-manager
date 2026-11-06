/**
 * Plan lanes-2, tracer E2 (docs/tasks/TASK-LN2-E2.md): a resolved hit's end events on the server (dcm-t8c, E6's engine).
 *
 * - dcm-utu: Transform (Book of Ronin, CB p.334: "You can remain in this shape until you take damage").
 * - dcm-4qv: Night's Glamour (HF p.17: "Unless you mark a Stress to maintain your Glamour, it drops when you mark a Hit
 *   Point"): it drops with the hit and the after-hit prompt offers the Stress that keeps it.
 *
 * Ash and Bryn wear Chainmail: thresholds 8 / 16 at level 1 (CB p.91: Minor 1 HP, Major 2 HP).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { bandsOnMap, maintainId, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();


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
  const pending = (c: Client, characterId: Id<"characters">) => c.query(api.adversaryActionsReads.pending, { campaignId, characterId });
  /** "Don't mark", then Done if a fitting answer keeps the window open (A1). */
  const noArmor = async (requestId: Id<"combatRequests">, characterId: Id<"characters">) => {
    const r = await respond(player, requestId, characterId, { kind: "noArmor" });
    if (r.status === "open") await respond(player, requestId, characterId, { kind: "pass" });
  };
  const publicRow = (groupId: string) => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).find((r) => r.groupId === groupId && r.visibility === "public")!);
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, player, edit, hit, sheet, respond, pending, noArmor, publicRow, undo };
}

const TRANSFORMED = { id: `${effectKeyOf("book-of-ronin")}:1`, source: "Book of Ronin", text: "Transformed", until: "manual" as const };
const GLAMOUR_ID = `${effectKeyOf("subclass:moon:nights-glamour")}:1`;
const GLAMOURED = { id: GLAMOUR_ID, source: "Night's Glamour", text: "Glamoured", until: "manual" as const };

describe("E2 dcm-t8c: a resolved hit ends what ends on damage", () => {
  it("Transform ends when the PC takes damage; the GM's undo brings it back", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ effects: [TRANSFORMED] }));
    const { requestId, groupId } = await a.hit(a.w.characterA, 5);
    await a.noArmor(requestId!, a.w.characterA);
    expect((await a.sheet(a.w.characterA)).effects).toEqual([]);
    await a.undo((await a.publicRow(groupId))._id);
    expect((await a.sheet(a.w.characterA)).effects.map((e) => e.id)).toEqual([TRANSFORMED.id]);
  });

  it("an ally's Transform stays", async () => {
    const a = await arena();
    await a.edit(a.w.characterB, () => ({ effects: [TRANSFORMED] }));
    const { requestId } = await a.hit(a.w.characterA, 5);
    await a.noArmor(requestId!, a.w.characterA);
    expect((await a.sheet(a.w.characterB)).effects.map((e) => e.id)).toEqual([TRANSFORMED.id]);
  });
});

describe("E2 dcm-4qv: Night's Glamour drops on a marked HP unless the Stress is paid", () => {
  it("drops with the hit; the after-hit prompt offers Keep; paying marks a Stress and puts it back", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ effects: [GLAMOURED] }));
    const { requestId } = await a.hit(a.w.characterA, 5);
    const r = await a.respond(a.player, requestId!, a.w.characterA, { kind: "noArmor" });
    if (r.status === "open") await a.respond(a.player, requestId!, a.w.characterA, { kind: "pass" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ hp: 1, stress: 0, effects: [] });
    const [view] = await a.pending(a.player, a.w.characterA);
    expect(view).toMatchObject({ afterHit: true });
    const keep = view!.features?.find((f) => f.featureId === maintainId(GLAMOUR_ID));
    expect(keep).toMatchObject({ useId: "maintain" });
    await a.respond(a.player, requestId!, a.w.characterA, { kind: "feature", featureId: maintainId(GLAMOUR_ID), useId: "maintain", choices: [] });
    const after = await a.sheet(a.w.characterA);
    expect(after).toMatchObject({ hp: 1, stress: 1 });
    expect(after.effects.map((e) => e.id)).toEqual([GLAMOUR_ID]);
  });

  it("passing leaves it dropped", async () => {
    const a = await arena();
    await a.edit(a.w.characterA, () => ({ effects: [GLAMOURED] }));
    const { requestId } = await a.hit(a.w.characterA, 5);
    const r = await a.respond(a.player, requestId!, a.w.characterA, { kind: "noArmor" });
    if (r.status === "open") await a.respond(a.player, requestId!, a.w.characterA, { kind: "pass" });
    await a.respond(a.player, requestId!, a.w.characterA, { kind: "pass" });
    expect(await a.sheet(a.w.characterA)).toMatchObject({ stress: 0, effects: [] });
  });
});
