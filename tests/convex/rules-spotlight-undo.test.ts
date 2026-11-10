/**
 * Plan rule-switches CU2 (bead dcm-bxp.99.32.10; docs/tasks/TASK-RULES-CU2.md): undoing a PC action roll that moved the
 * spotlight to the GM (S1 Book, CB p.100: "making moves until someone fails a roll or rolls with Fear"; CB p.149) puts it
 * back to who held it before: the whole party (no row) or the PC the GM had handed it to. It stays with the GM when the
 * GM's turn has moved on since the roll: the GM spotlighted an adversary, an adversary acted, or the GM handed it on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { campaignFearState } from "../../convex/lib/fear";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

/** The server's dice show `values` in turn (Hope Die first), then repeat. */
function dice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

/** A medium live map: Ash next to a Bear (Difficulty 1), Bryn nearby; a running encounter. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 5, y: 12, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const bear = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bear",
      order: 0,
      summoned: false,
      stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    const bearToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: bear }, side: "enemy", x: 6, y: 10, face: Math.PI });
    return { encounterId, bear, bearToken };
  });
  const spotlight = () => t.run(async (ctx) => ctx.db.query("combatSpotlight").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).first());
  /** Ash's typed-in action roll (`[hope, fear]`, no Difficulty: a success; with Fear when fear > hope). */
  const roll = (values: number[], c = player, characterId = w.characterA) =>
    c.mutation(api.rolls.manualRoll, { characterId, values, roll: agility, idempotencyKey: key() });
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  const handTo = (characterId: Id<"characters">) => gm.mutation(api.combatSpotlight.handTo, { campaignId, characterId, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, spotlight, roll, undo, handTo };
}

const held = (row: Doc<"combatSpotlight"> | null) => (row === null ? null : { holder: row.holder.kind === "pc" ? row.holder.characterId : "gm", reason: row.reason });

describe("CU2: undoing a roll that moved the spotlight to the GM puts it back (dcm-bxp.99.32.10)", () => {
  it("nobody held it: a roll with Fear moves it to the GM; undo hands it back to the whole party", async () => {
    const a = await arena();
    const r = await a.roll([3, 8]);
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear" });
    await a.undo(r.entryId);
    expect(await a.spotlight()).toBeNull();
  });

  it("a PC held it: undo gives it back to that PC, as it stood (the plain roll stays ungrouped)", async () => {
    const a = await arena();
    await a.handTo(a.w.characterA);
    const before = await a.spotlight();
    const r = await a.roll([3, 8]);
    expect((await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))?.groupId).toBeUndefined();
    expect(held(await a.spotlight())?.holder).toBe("gm");
    await a.undo(r.entryId);
    const after = await a.spotlight();
    expect(held(after)).toEqual({ holder: a.w.characterA, reason: "handedBack" });
    expect(after?.since).toBe(before?.since);
  });

  it("a failure with Hope moves it too, and its undo puts it back", async () => {
    const a = await arena();
    await a.handTo(a.w.characterB);
    const r = await a.player.mutation(api.rolls.manualRoll, { characterId: a.w.characterA, values: [5, 2], roll: { ...agility, difficulty: 20 }, idempotencyKey: key() });
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "failedRoll" });
    await a.undo(r.entryId);
    expect(held(await a.spotlight())).toEqual({ holder: a.w.characterB, reason: "handedBack" });
  });

  it("a weapon attack with Fear (a grouped action) puts it back on undo", async () => {
    const a = await arena();
    await a.handTo(a.w.characterA);
    dice(3, 8, 4);
    const r = await a.player.mutation(api.combatActions.attack, {
      campaignId: a.campaignId,
      characterId: a.w.characterA,
      mapId: a.mapId,
      targetTokenIds: [a.bearToken],
      slot: "primary",
      modifier: 0,
      experienceIds: [],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
      idempotencyKey: key(),
    });
    if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
    vi.restoreAllMocks();
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear" });
    await a.undo(r.entryId);
    expect(held(await a.spotlight())).toEqual({ holder: a.w.characterA, reason: "handedBack" });
  });

  it("the GM spotlighted an adversary since: undo leaves the spotlight with the GM", async () => {
    const a = await arena();
    await a.handTo(a.w.characterA);
    const r = await a.roll([3, 8]);
    await a.gm.mutation(api.combatSpotlight.gmTake, { campaignId: a.campaignId, tokenId: a.bearToken, idempotencyKey: key() });
    await a.undo(r.entryId);
    expect(await a.spotlight()).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", adversaryTokenId: a.bearToken });
  });

  it("an adversary acted since (a live GM adversary row after the move): undo leaves the spotlight with the GM", async () => {
    const a = await arena();
    await a.handTo(a.w.characterA);
    const r = await a.roll([3, 8]);
    const gmId = await a.t.run(async (ctx) => (await ctx.db.get("campaigns", a.campaignId))!.ownerId);
    await a.t.run((ctx) =>
      ctx.db.insert("actionLog", { campaignId: a.campaignId, actorId: gmId, kind: "adversary", visibility: "gm", summary: "Bear: Bite", groupId: "gm-act", undoable: true, at: Date.now() + 1 }),
    );
    await a.undo(r.entryId);
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear" });
  });

  it("the GM handed it on since: undoing the older roll moves nothing", async () => {
    const a = await arena();
    const first = await a.roll([3, 8]);
    await a.handTo(a.w.characterB);
    await a.undo(first.entryId);
    expect(held(await a.spotlight())).toEqual({ holder: a.w.characterB, reason: "handedBack" });
  });

  it("a roll while the GM already held it stores nothing, and its undo leaves the GM's hold", async () => {
    const a = await arena();
    const first = await a.roll([3, 8]);
    // The GM's own roll for Ash (S2 lets the GM act while holding it): the hold doesn't move again.
    const second = await a.roll([2, 9], a.gm);
    expect((await a.t.run((ctx) => ctx.db.get("actionLog", second.entryId)))?.spotlightBefore).toBeUndefined();
    await a.undo(second.entryId);
    expect(held(await a.spotlight())).toEqual({ holder: "gm", reason: "rollWithFear" });
    await a.undo(first.entryId);
    expect(await a.spotlight()).toBeNull();
  });

  it("S1 Manual moves nothing and stores nothing", async () => {
    const a = await arena();
    await a.t.run((ctx) => ctx.db.patch("campaigns", a.campaignId, { ruleModes: { spotlightToGm: "manual" } }));
    await a.handTo(a.w.characterA);
    const r = await a.roll([3, 8]);
    expect(held(await a.spotlight())).toEqual({ holder: a.w.characterA, reason: "handedBack" });
    const rows = await a.t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", a.campaignId)).collect());
    expect(rows.some((row) => row.spotlightBefore !== undefined)).toBe(false);
    await a.undo(r.entryId);
    expect(held(await a.spotlight())).toEqual({ holder: a.w.characterA, reason: "handedBack" });
  });
});

/**
 * dcm-iukg: the GM's paid take (`combatSpotlight.gmTake` pay fear on an adversary token) spends 1 Fear and counts as that
 * adversary's spotlight this GM turn. Its undo gives the Fear back and the instance's spotlight count too, so the
 * adversary's first action asks Fear again as it did before the take.
 */
describe("undoing a paid spotlight take (dcm-iukg)", () => {
  /** The arena plus a Wolf already spotlit this GM turn (so another adversary's spotlight costs 1 Fear) and 3 Fear. */
  async function paidArena() {
    const a = await arena();
    await a.t.run(async (ctx) => {
      await ctx.db.patch("campaignState", (await campaignFearState(ctx, a.campaignId))._id, { fear: 3 });
      await ctx.db.insert("encounterAdversaries", {
        campaignId: a.campaignId,
        encounterId: a.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Wolf",
        order: 1,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 1,
        spotlightTurn: 1,
        updatedAt: Date.now(),
      });
      // The Bear's count is from an older GM turn: undo must put exactly this back.
      await ctx.db.patch("encounterAdversaries", a.bear, { spotlights: 2, spotlightTurn: 0 });
    });
    const fear = () => a.t.run(async (ctx) => (await campaignFearState(ctx, a.campaignId)).fear);
    const bearRow = () => a.t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", a.bear))!);
    const take = () => a.gm.mutation(api.combatSpotlight.gmTake, { campaignId: a.campaignId, tokenId: a.bearToken, pay: "fear", idempotencyKey: key() });
    const gmRow = () =>
      a.t.run(async (ctx) =>
        (await ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", a.campaignId)).collect()).find((r) => r.visibility === "gm" && r.fearDelta === -1)!,
      );
    const attack = () => a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.bear, targets: [a.w.characterA], idempotencyKey: key() });
    return { ...a, fear, bearRow, take, gmRow, attack };
  }

  it("undo gives the Fear back and the instance's spotlights / spotlightTurn as before the take", async () => {
    const a = await paidArena();
    // Before the take the Bear would be the turn's second spotlight: its action asks Fear.
    expect(await a.attack()).toMatchObject({ status: "confirmFear" });
    await a.take();
    expect(await a.fear()).toBe(2);
    expect(await a.bearRow()).toMatchObject({ spotlights: 1, spotlightTurn: 1 });
    expect((await a.gmRow()).adversaryBefore).toEqual([expect.objectContaining({ instanceId: a.bear, spotlights: 2, spotlightTurn: 0 })]);

    await a.undo((await a.gmRow())._id);
    expect(await a.fear()).toBe(3);
    expect(await a.bearRow()).toMatchObject({ spotlights: 2, spotlightTurn: 0 });
    // As before the take: its first action asks Fear again.
    expect(await a.attack()).toMatchObject({ status: "confirmFear" });
  });

  it("a row written before the widening (no spotlight fields) undoes as before: the Fear only", async () => {
    const a = await paidArena();
    await a.take();
    const row = await a.gmRow();
    const old = row.adversaryBefore!.map((b) => ({ instanceId: b.instanceId, hp: b.hp, stress: b.stress, defeated: b.defeated }));
    await a.t.run((ctx) => ctx.db.patch("actionLog", row._id, { adversaryBefore: old }));
    await a.undo(row._id);
    expect(await a.fear()).toBe(3);
    expect(await a.bearRow()).toMatchObject({ spotlights: 1, spotlightTurn: 1 });
  });
});
