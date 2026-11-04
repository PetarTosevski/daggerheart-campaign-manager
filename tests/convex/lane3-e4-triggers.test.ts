/**
 * Plan lanes-2 wave 9, tracer E4.3 (docs/tasks/TASK-LN3-E4.md): uses the server runs on a move (dcm-bpr, dcm-g90o engine
 * half; dcm-cma) and a creature's second position (dcm-v27). A fixture card stands in for Hold the Line's pull use as an
 * `auto` `whenEnemyEntersRange` use (the SRD switch is wave 10's).
 *
 * Expected values come from the book:
 * - CB p.103 Defined Ranges: Melee 1 square, Very Close 3, Close 6.
 * - CB p.342 (Hold the Line): "If an adversary moves within Very Close range, they're pulled into Melee range and
 *   Restrained."
 * - HF p.71 (Blink Beast): "a duplicate of itself appears ... within Close range".
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { placeDuplicate } from "../../convex/combatTokens";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { tokenDistance } from "../../src/lib/domain/combat-actions/distance";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

const HOLD = vi.hoisted(() => "fixture-hold-the-line");

vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  const entry = {
    cardId: HOLD,
    uses: [
      {
        id: "pull",
        name: "Hold the Line (adversary moves in)",
        activation: { kind: "auto", trigger: { kind: "whenEnemyEntersRange", range: "veryClose" } },
        steps: [
          { kind: "move", to: "triggerSource", mode: "intoMelee", range: "melee", relativeTo: "self", note: "Pulled into Melee range" },
          { kind: "condition", to: "triggerSource", condition: { kind: "standard", condition: "restrained" }, duration: "manual" },
        ],
      },
    ],
  };
  return { ...real, cardEffect: (id: string) => (id === HOLD ? (entry as unknown as ReturnType<typeof real.cardEffect>) : real.cardEffect(id)) };
});

/** The world plus a live medium map: Ash (characterA) at (2, 10), Bryn (characterB) at (4, 10), an encounter running. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10, face: 0 });
    const bryn = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 4, y: 14, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const instanceId = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bear",
      order: 0,
      summoned: false,
      stats: { difficulty: 10, major: 5, severe: 10, hpMax: 6, stressMax: 2 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    const bear = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: 14, y: 10, face: Math.PI });
    return { ash, bryn, bear, instanceId };
  });
  const loadout = (cards: string[]) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, domainCards: { ...s.domainCards, loadout: cards } });
    });
  const token = (id: Id<"combatTokens">) => t.run(async (ctx) => (await ctx.db.get("combatTokens", id))!);
  const instance = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", ids.instanceId))!);
  return { w, t, campaignId, mapId, gm, ...ids, loadout, token, instance };
}

describe("uses a move sets off (combatAreas.ts runTriggeredUse)", () => {
  allowWorldEmails();

  it("an auto whenEnemyEntersRange use pulls the adversary into Melee and Restrains it (Hold the Line, CB p.342)", async () => {
    const a = await arena();
    await a.loadout([HOLD]);
    await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.bear, x: 5, y: 10 });
    const bear = await a.token(a.bear);
    expect(tokenDistance(bear, await a.token(a.ash))).toBeLessThanOrEqual(1);
    expect((await a.instance()).conditions).toContain("restrained");
  });

  it("without the card, the move stays where it ended", async () => {
    const a = await arena();
    await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.bear, x: 5, y: 10 });
    expect(await a.token(a.bear)).toMatchObject({ x: 5, y: 10 });
    expect((await a.instance()).conditions).not.toContain("restrained");
  });
});

describe("second positions (combatTokens.ts placeDuplicate, dcm-v27)", () => {
  allowWorldEmails();

  it("a duplicate within Close; one at a time; it goes with the original (Blink Beast, HF p.71)", async () => {
    const a = await arena();
    const original = await a.token(a.bear);
    await expect(a.t.run((ctx) => placeDuplicate(ctx, { original, x: 25, y: 10 }))).rejects.toThrow();
    const first = await a.t.run((ctx) => placeDuplicate(ctx, { original, x: 18, y: 10 }));
    expect(await a.token(first)).toMatchObject({ x: 18, y: 10, duplicateOf: a.bear, ref: original.ref });
    const second = await a.t.run((ctx) => placeDuplicate(ctx, { original, x: 12, y: 10 }));
    expect(await a.t.run((ctx) => ctx.db.get("combatTokens", first))).toBeNull();
    await a.gm.mutation(api.combatTokens.remove, { campaignId: a.campaignId, tokenId: a.bear });
    expect(await a.t.run((ctx) => ctx.db.get("combatTokens", second))).toBeNull();
  });
});
