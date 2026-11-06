import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { readSheet, storedSheet } from "../../convex/lib/characterSheet";
import { key } from "./helpers";
import { buildWorld, type Role, type World } from "./authz/world";

/**
 * Bead dcm-jh6d.62 (the follow-up of config R1): with "Players see the GM's Fear" off, no mutation result or read a
 * player gets carries a Fear change. `restsReads.current`'s last rest, a roll's `fearGained` (0 would say the pool is
 * full), an undo's `fearReverted`. The GM and a co-GM keep the numbers; "with Fear" on the roll stays (the die).
 * The combat results (attack, card, feature) are checked in combat-attack.test.ts.
 */

const FULL = 12;
/** Manual dice: Hope 2, Fear 8, a roll with Fear. */
const WITH_FEAR = [2, 8];
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
const PLAYERS: readonly Role[] = ["player", "grantee"];
const GMS: readonly Role[] = ["gm", "coGm"];

async function setup(playersSeeFear: boolean) {
  const w = await buildWorld();
  await w.as("gm").mutation(api.fear.set, { campaignId: w.campaignId, value: FULL, idempotencyKey: key() });
  await w.as("gm").mutation(api.campaignSettings.set, { campaignId: w.campaignId, change: { key: "playersSeeFear", value: playersSeeFear } });
  return w;
}

/** A Fear number or change anywhere in a value: a numeric fear field, or a number next to "Fear". */
function expectNoFearNumbers(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/"fear(Gained|Delta|Reverted|Roll)?":\s*-?\d/);
  expect(text).not.toMatch(/\d+ Fear\b|Fear \d+ →/);
}

const roll = (w: World, as: Role) =>
  w.as(as).mutation(api.rolls.manualRoll, { characterId: w.characterA, values: WITH_FEAR, roll: agility, idempotencyKey: key() });

/** A finished long rest that gained 4 Fear on a 1d4 of 2 (CB 105), the campaign's latest. */
async function finishedRest(w: World) {
  await w.t.run((ctx) =>
    ctx.db.insert("rests", { campaignId: w.campaignId, kind: "long", status: "finished", startedBy: w.users.gm, startedAt: Date.now() - 1000, finishedAt: Date.now(), fearRoll: 2, fearGained: 4 }),
  );
}

/** An undoable feature row of the player's on Ash that gained 2 Fear and rolled nothing (a player may undo it). */
async function featureRow(w: World) {
  return w.t.run(async (ctx) => {
    const sheet = JSON.stringify(storedSheet(readSheet((await ctx.db.get("characters", w.characterA))!.sheet)));
    return ctx.db.insert("actionLog", { campaignId: w.campaignId, characterId: w.characterA, actorId: w.users.player, kind: "feature", visibility: "public", summary: "Ash uses a feature", before: sheet, fearDelta: 2, undoable: true, at: Date.now() });
  });
}

describe("Fear changes in player results (dcm-jh6d.62)", () => {
  it("off: a player's roll with Fear has no fearGained, though the pool is full; 'with Fear' stays", async () => {
    const w = await setup(false);
    for (const as of PLAYERS) {
      const out = await roll(w, as);
      expect(out, as).not.toHaveProperty("fearGained");
      expect(out.roll.outcome).toMatch(/Fear$/);
      expectNoFearNumbers(out);
    }
  });

  it("off: the GM and a co-GM still get fearGained (0: the pool is full)", async () => {
    const w = await setup(false);
    for (const as of GMS) expect(await roll(w, as), as).toMatchObject({ fearGained: 0 });
  });

  it("on: a player gets fearGained", async () => {
    const w = await setup(true);
    expect(await roll(w, "player")).toMatchObject({ fearGained: 0 });
  });

  it("off: the last rest has no Fear roll or gain for a player; the GM and a co-GM keep them", async () => {
    const w = await setup(false);
    await finishedRest(w);
    for (const as of PLAYERS) {
      const { last } = await w.as(as).query(api.restsReads.current, { campaignId: w.campaignId });
      expect(last, as).toMatchObject({ fearRoll: null, fearGained: null });
      expectNoFearNumbers(last);
    }
    for (const as of GMS) {
      const { last } = await w.as(as).query(api.restsReads.current, { campaignId: w.campaignId });
      expect(last, as).toMatchObject({ fearRoll: 2, fearGained: 4 });
    }
  });

  it("on: a player sees the last rest's Fear", async () => {
    const w = await setup(true);
    await finishedRest(w);
    const { last } = await w.as("player").query(api.restsReads.current, { campaignId: w.campaignId });
    expect(last).toMatchObject({ fearRoll: 2, fearGained: 4 });
  });

  it("off: a player's undo has no fearReverted; the GM's has it", async () => {
    const w = await setup(false);
    const out = await w.as("player").mutation(api.actionLog.undo, { entryId: await featureRow(w), idempotencyKey: key() });
    expect(out.undone).toHaveLength(1);
    expect(out).not.toHaveProperty("fearReverted");
    expectNoFearNumbers(out);
    expect(await w.as("gm").mutation(api.actionLog.undo, { entryId: await featureRow(w), idempotencyKey: key() })).toMatchObject({ fearReverted: 2 });
  });
});
