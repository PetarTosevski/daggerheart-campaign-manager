/**
 * MG (dcm-3ias; docs/tasks/TASK-LN2-MG.md): `migrations/vanishingActMarker:addMarker` gives a rogue Cloaked by Vanishing Act
 * before lane C2's deploy the source marker a use writes today, and removes the Cloaked when a rest since the use ended it
 * (change 2026-10-31) (TE5: old shape in, new shape out, a second run changes nothing).
 *
 * Expected values: the marker the real feature use writes (`combatFeatures.useFeature`) in the same world. CB p.42
 * (Nightwalker, Vanishing Act): "You remain Cloaked in this way until you roll with Fear or until your next rest."
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { logAction } from "../../convex/lib/actionLog";
import { conditionSources } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { VANISHING_ACT } from "../../convex/migrations/vanishingActMarker";
import type { ActionKind } from "../../convex/lib/validators/actionLog";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FN = "migrations/vanishingActMarker:addMarker";

/** The world with Ash (characterA) a Nightwalker rogue: at mastery (Vanishing Act) unless `rank` says otherwise. */
async function rogue(rank: CharacterSheet["subclassRank"] = "mastery") {
  const w = await buildWorld();
  const sheet = () => w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const raw = () => w.t.run(async (ctx) => (await ctx.db.get("characters", w.characterA))!.sheet);
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    w.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch(s) });
    });
  /** A later feed row (a ms on): the sheet changed by `patch`, logged with its `before`. */
  const logged = async (kind: ActionKind, summary: (name: string) => string, patch: (s: CharacterSheet) => Partial<CharacterSheet>) => {
    vi.advanceTimersByTime(1000);
    await w.t.run(async (ctx) => {
      const character = (await ctx.db.get("characters", w.characterA))!;
      const s = readSheet(character.sheet);
      await saveSheet(ctx, character._id, { ...s, ...patch(s) });
      await logAction(ctx, { campaignId: w.campaignId, characterId: character._id, actorId: character.ownerId, kind, visibility: "public", summary: summary(s.name), before: s, groupId: key(), undoable: true });
    });
  };
  const run = async (extra: { dryRun?: boolean; reset?: boolean } = {}) => {
    await w.t.mutation(internal.migrations.run.run, { fn: FN, ...extra });
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  await edit(() => ({ classId: "rogue", subclassId: "nightwalker", subclassRank: rank, stress: 0, conditions: [] }));
  return { w, sheet, raw, edit, logged, run };
}

type Rogue = Awaited<ReturnType<typeof rogue>>;

/** Uses Vanishing Act for real, then strips the marker C2 writes: a rogue Cloaked by it before the deploy. Returns the effects the use wrote. */
async function usedBeforeDeploy(r: Rogue): Promise<Effect[]> {
  vi.advanceTimersByTime(1000);
  await r.w.as("player").mutation(api.combatFeatures.useFeature, { campaignId: r.w.campaignId, characterId: r.w.characterA, featureId: VANISHING_ACT, targetTokenIds: [], choices: [], idempotencyKey: key() } as never);
  const used = await r.sheet();
  expect(used.conditions).toContain("cloaked");
  expect(conditionSources(used, "cloaked")).toEqual([VANISHING_ACT]);
  await r.edit((s) => ({ effects: s.effects.filter((e) => e.text !== "cloaked") }));
  expect(conditionSources(await r.sheet(), "cloaked")).toEqual([]);
  return used.effects;
}

/** Runs the migration and expects the stored sheet unchanged. */
async function untouched(r: Rogue) {
  const before = await r.raw();
  await r.run();
  expect(await r.raw()).toEqual(before);
}

describe("migrations/vanishingActMarker:addMarker (dcm-3ias)", () => {
  it("migrated: adds the marker exactly as the use writes it; a dry run changes nothing", async () => {
    const r = await rogue();
    const expected = await usedBeforeDeploy(r);
    // A later row that kept Cloaked (a Hope gain) does not hide the use.
    await r.logged("feature", (n) => `${n} gains a Hope`, (s) => ({ hope: Math.min(s.hope + 1, 6) }));
    const before = await r.raw();

    await r.run({ dryRun: true });
    expect(await r.raw()).toEqual(before);

    await r.run();
    const after = await r.sheet();
    expect(after.effects).toEqual(expected);
    expect(conditionSources(after, "cloaked")).toEqual([VANISHING_ACT]);
    // Nothing else on the sheet moved.
    expect({ ...after, effects: [] }).toEqual({ ...readSheet(before), effects: [] });
  });

  it("not migrated: no Vanishing Act (below mastery), Cloaked without a use, Cloaked again the ordinary way", async () => {
    // A Nightwalker below mastery does not hold Vanishing Act, whatever the feed says.
    const spec = await rogue("specialization");
    await spec.logged("feature", (n) => `${n} uses Vanishing Act`, () => ({ conditions: ["cloaked"] }));
    await untouched(spec);

    // A rogue at mastery Cloaked the ordinary way (Hidden -> Cloaked), no use in the feed.
    const plain = await rogue();
    await plain.logged("feature", (n) => `${n} is Cloaked`, () => ({ conditions: ["cloaked"] }));
    await untouched(plain);

    // Vanishing Act's Cloaked ended, then Cloaked again the ordinary way.
    const again = await rogue();
    await usedBeforeDeploy(again);
    await again.logged("combat", (n) => `${n} attacks and is no longer Cloaked`, () => ({ conditions: [] }));
    await again.logged("feature", (n) => `${n} is Cloaked`, () => ({ conditions: ["cloaked"] }));
    await untouched(again);

    // Cloaked again the ordinary way after a rest ended Vanishing Act's (the rest came after the use).
    const restedAgain = await rogue();
    await usedBeforeDeploy(restedAgain);
    await restedAgain.logged("rest", () => "Short rest", (s) => ({ conditions: s.conditions.filter((c) => c !== "cloaked") }));
    await restedAgain.logged("feature", (n) => `${n} is Cloaked`, () => ({ conditions: ["cloaked"] }));
    await untouched(restedAgain);
  });

  it("rested since the use (change 2026-10-31): the stale Cloaked is removed; a dry run changes nothing; a rerun changes nothing", async () => {
    // Before C2 a rest left the bare Cloaked; by the book Vanishing Act's ended there (CB p.42: "until your next rest").
    const r = await rogue();
    await usedBeforeDeploy(r);
    await r.logged("rest", () => "Short rest", () => ({}));
    await r.logged("feature", (n) => `${n} gains a Hope`, (s) => ({ hope: Math.min(s.hope + 1, 6) }));
    const before = await r.raw();

    const endRows = () =>
      r.w.t.run(async (ctx) => (await ctx.db.query("actionLog").withIndex("by_character_at", (q) => q.eq("characterId", r.w.characterA)).take(50)).filter((row) => row.summary.endsWith("Cloaked ends (Vanishing Act)")));
    await r.run({ dryRun: true });
    expect(await r.raw()).toEqual(before);
    expect(await endRows()).toEqual([]);

    await r.run();
    const after = await r.sheet();
    expect(after.conditions).not.toContain("cloaked");
    // dcm-3wt4 (user answer): one public feed row says why the Cloaked is gone.
    const ended = await endRows();
    expect(ended.map((row) => [row.summary, row.visibility, row.undoable])).toEqual([[`${after.name}: Cloaked ends (Vanishing Act)`, "public", false]]);
    expect(conditionSources(after, "cloaked")).toEqual([]);
    // Nothing else on the sheet moved.
    const was = readSheet(before);
    expect({ ...after, conditions: [] }).toEqual({ ...was, conditions: [] });
    expect(after.conditions).toEqual(was.conditions.filter((c) => c !== "cloaked"));

    const once = await r.raw();
    await r.run({ reset: true });
    expect(await r.raw()).toEqual(once);
    expect(await endRows()).toHaveLength(1);
  });

  it("run twice: the second run (from the start) changes nothing", async () => {
    const r = await rogue();
    const expected = await usedBeforeDeploy(r);
    await r.run();
    const once = await r.raw();
    await r.run({ reset: true });
    expect(await r.raw()).toEqual(once);
    expect((await r.sheet()).effects).toEqual(expected);
  });
});
