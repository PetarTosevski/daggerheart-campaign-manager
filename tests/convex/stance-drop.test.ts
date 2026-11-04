/**
 * Grappling's Restrain ends when the stance drops (plan drawer-answers DA10; docs/tasks/TASK-DA-DA10.md).
 *
 * HF p.12, Grappling: "On a successful attack within Melee range, you can spend a Focus or mark a Stress to temporarily
 * Restrain the target or throw the target up to Close range." HF p.12, Dropping Out of Stances: "If you are already in a
 * stance when you shift into a different stance, you automatically drop out of the previously active stance. You also
 * drop out of your active stance when you take Severe damage or mark your last Hit Point. Otherwise, you drop out of your
 * active stance at the end of the scene. When you drop out of a stance, you lose any ongoing benefits it provides."
 * User answer 2026-10-29 (dcm-bxp.99.19.10): the Restrain ends when the stance drops. Plan acceptance: also on a rest.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { writeSheetChanges } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import { stanceDropMarker, stanceMarkers, withoutStance } from "../../convex/lib/stanceDrop";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import { STANCE_EFFECTS } from "../../src/lib/srd/feature-effects/stances";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the marker", () => {
  it("Grappling's Restrain carries endsOn stanceDrops", () => {
    const grappling = STANCE_EFFECTS.find((e) => e.featureId === "stance:martial-artist:grappling")!;
    const step = grappling.uses[0]!.steps[0]!;
    if (step.kind !== "choose") throw new Error("expected the choose step");
    expect(step.options.find((o) => o.id === "restrain")!.steps).toEqual([
      { kind: "condition", to: "targets", condition: { kind: "standard", condition: "restrained" }, duration: "temporary", endsOn: ["stanceDrops"] },
    ]);
  });

  it("the actor who gives it gets a marker naming the target's token; a stance drop takes it and the stance off", async () => {
    const w = await buildWorld();
    const sheet = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    const steps: PlanStep[] = [{ kind: "condition", targetId: "token123", condition: { kind: "standard", condition: "restrained" }, duration: "temporary", endsOn: ["stanceDrops"] }];
    const after = writeSheetChanges(sheet, steps, "me", "feat:x", "Grappling", false, true);
    expect(stanceMarkers(after)).toEqual([{ tokenId: "token123", condition: "restrained", source: "Grappling" }]);
    // Given twice to the same target: one marker.
    expect(stanceMarkers(writeSheetChanges(after, steps, "me", "feat:x", "Grappling", false, true))).toHaveLength(1);
    // Not for an ally's own sheet, nor without the end event.
    expect(stanceMarkers(writeSheetChanges(sheet, steps, "token123", "feat:x", "Grappling", false, false))).toEqual([]);
    const plain: PlanStep[] = [{ kind: "condition", targetId: "token123", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" }];
    expect(stanceMarkers(writeSheetChanges(sheet, plain, "me", "feat:x", "Grappling", false, true))).toEqual([]);

    const inStance = { ...after, classState: { ...after.classState, martial: { known: ["grappling"], active: "grappling", focus: 1 } } };
    const off = withoutStance(inStance);
    expect(off.dropped).toBe(true);
    expect(off.sheet.classState.martial).toEqual({ known: ["grappling"], focus: 1 });
    expect(stanceMarkers(off.sheet)).toEqual([]);
  });
});

/** Ash (characterA) in Grappling with a Bear Restrained by it (the marker on Ash's sheet, as `writeSheetChanges` leaves it). */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { options: { hopeAndFear: true } }));
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const bear = await ctx.db.insert("encounterAdversaries", { campaignId, encounterId, source: { kind: "srd", adversaryId: "bear" }, label: "Bear", order: 0, summoned: false, stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 }, hp: 0, stress: 0, defeated: false, conditions: ["restrained"], tags: [], spotlights: 0, spotlightTurn: 0, updatedAt: now });
    const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: bear }, side: "enemy", x: 6, y: 10, face: 0 });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    const sheet: CharacterSheet = {
      ...s,
      classId: "brawler",
      subclassId: "martial-artist",
      subclassRank: "foundation",
      armorId: "chainmail-armor",
      armorMarked: 0,
      hp: 0,
      stress: 0,
      effects: [stanceDropMarker(tokenId, "Grappling", "restrained")],
      domainCards: { owned: [], loadout: [] },
      classState: { ...s.classState, martial: { known: ["grappling", "quick"], active: "grappling", focus: 2 } },
    };
    await saveSheet(ctx, w.characterA, sheet);
    return { encounterId, bear, tokenId };
  });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const bearNow = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", ids.bear))!);
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, campaignId, gm, player, ...ids, sheet, bearNow, rows, undo };
}

describe("dropStance where the stance drops (convex)", () => {
  it("a shift to another stance ends the Restrain in the shift's undo group", async () => {
    const a = await arena();
    await a.player.mutation(api.combatFeatures.shiftStance, { campaignId: a.campaignId, characterId: a.w.characterA, stance: "quick", idempotencyKey: key() });
    expect((await a.bearNow()).conditions).toEqual([]);
    const s = await a.sheet();
    expect(s.classState.martial).toMatchObject({ active: "quick", focus: 1 });
    expect(stanceMarkers(s)).toEqual([]);
    const row = (await a.rows()).find((r) => r.summary.includes("shifts into"))!;
    expect(row.summary).toContain("Bear is no longer restrained");
    await a.undo(row._id);
    expect((await a.bearNow()).conditions).toEqual(["restrained"]);
    expect((await a.sheet()).classState.martial).toMatchObject({ active: "grappling", focus: 2 });
  });

  it("the scene's end ends it; undo restores it", async () => {
    const a = await arena();
    const result = await a.gm.mutation(api.combatScenes.end, { campaignId: a.campaignId, idempotencyKey: key() });
    expect((await a.bearNow()).conditions).toEqual([]);
    expect((await a.sheet()).classState.martial?.active).toBeUndefined();
    await a.undo(result.entryId!);
    expect((await a.bearNow()).conditions).toEqual(["restrained"]);
    expect((await a.sheet()).classState.martial?.active).toBe("grappling");
  });

  it("a rest leaves the stance (SD8 Q3, tests/convex/feature-hooks.test.ts), so the Restrain stays too (see QUESTIONS 1)", async () => {
    const a = await arena();
    const { restId } = await a.gm.mutation(api.rests.start, { campaignId: a.campaignId, kind: "short", idempotencyKey: key() });
    await a.gm.mutation(api.rests.finish, { campaignId: a.campaignId, restId, idempotencyKey: key() });
    expect((await a.bearNow()).conditions).toEqual(["restrained"]);
    const s = await a.sheet();
    expect(s.classState.martial?.active).toBe("grappling");
    expect(stanceMarkers(s)).toHaveLength(1);
  });

  it("Severe damage drops the stance and ends it in the hit's group; a Minor hit doesn't", async () => {
    const a = await arena();
    const hit = (amount: number, groupId: string) =>
      a.t.run(async (ctx) =>
        openIncomingHit(ctx, {
          campaignId: a.campaignId,
          encounterId: a.encounterId,
          createdBy: a.w.users.gm,
          groupId,
          attacker: { instanceId: a.bear, label: "Bear" },
          targetCharacterId: a.w.characterA,
          hit: { amount, type: "physical", direct: false, forcedArmor: 0, critical: false },
          party: await partyMembers(ctx, a.campaignId),
          bands: await bandsOnMap(ctx, undefined),
        }),
      );
    const respond = (requestId: Id<"combatRequests">) => a.player.mutation(api.adversaryActions.respond, { campaignId: a.campaignId, requestId, characterId: a.w.characterA, choice: { kind: "noArmor" } as never, idempotencyKey: key() });
    // Chainmail at level 1: thresholds 8 / 16 (CB p.91). 3 is Minor.
    const minor = await hit(3, "g-minor");
    await respond(minor.requestId);
    expect((await a.sheet()).classState.martial?.active).toBe("grappling");
    expect((await a.bearNow()).conditions).toEqual(["restrained"]);

    const severe = await hit(17, "g-severe");
    await respond(severe.requestId);
    expect((await a.sheet()).classState.martial?.active).toBeUndefined();
    expect((await a.bearNow()).conditions).toEqual([]);
    const group = (await a.rows()).filter((r) => r.groupId === "g-severe");
    expect(group.find((r) => r.visibility === "public" && r.before !== undefined)!.summary).toContain("drops out of their stance");
    await a.undo(group.find((r) => r.before !== undefined)!._id);
    expect((await a.bearNow()).conditions).toEqual(["restrained"]);
    expect((await a.sheet()).classState.martial?.active).toBe("grappling");
  });
});
