/**
 * Plan rule-switches RT (docs/tasks/TASK-RULES-RT.md): the optional Spotlight Tracker (CB p.89; user answer Q9 a).
 * With the rule on, each PC on the live Combat Map has N action tokens (`spotlightTrackerTokens`, default 3); each PC
 * action roll spends one; at 0 the roll still goes through and the HUD warns; when every PC on the live map is at 0,
 * all refill; the GM can refill by hand. Off (the default): no rows, no tokens on the HUD, the refill is refused.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

type Modes = { spotlightTracker?: boolean; spotlightTrackerTokens?: number };
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

/** The world with a live map; Ash's token on it, and Bryn's unless `bryn: false`. */
async function table(modes: Modes = {}, options: { bryn?: boolean; live?: boolean } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const other = w.as("otherPlayer");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: modes });
    await ctx.db.patch("combatMaps", mapId, { live: options.live ?? true });
    const pc = (characterId: Id<"characters">, x: number) =>
      ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId }, side: "pc", x, y: 10, face: 0 });
    await pc(w.characterA, 5);
    if (options.bryn !== false) await pc(w.characterB, 7);
  });
  // Values [Hope, Fear]: 8 / 3 with Hope (no Difficulty: a success), so S1 never moves the spotlight here.
  const roll = (who: "ash" | "bryn" = "ash", kind: "action" | "reaction" = "action") =>
    (who === "ash" ? player : other).mutation(api.rolls.manualRoll, {
      characterId: who === "ash" ? w.characterA : w.characterB,
      values: [8, 3],
      roll: { ...agility, kind },
      idempotencyKey: key(),
    });
  const rows = () => t.run((ctx) => ctx.db.query("actionTokens").withIndex("by_campaign_character", (q) => q.eq("campaignId", campaignId)).collect());
  const party = (as: "gm" | "player" = "player") => w.as(as).query(api.combatHud.party, { campaignId, mapId });
  const tokensOf = async (characterId: Id<"characters">, as: "gm" | "player" = "player") => (await party(as)).find((m) => m.characterId === characterId)?.tokens;
  const refill = (as: "gm" | "coGm" | "player" = "gm") => w.as(as).mutation(api.combatSpotlight.refillTokens, { campaignId, idempotencyKey: key() });
  const spend = (characterId: Id<"characters">, as: "gm" | "coGm" | "player" = "gm") =>
    w.as(as).mutation(api.combatSpotlight.spendToken, { campaignId, characterId, idempotencyKey: key() });
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  /** The campaign's spend records (hidden `spotlightTracker` rule rows and the GM's shown ones). */
  const records = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect()).filter((r) => r.ruleId === "spotlightTracker"),
    );
  return { w, t, campaignId, mapId, gm, player, roll, rows, party, tokensOf, refill, spend, undo, records };
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code;
  }
  return undefined;
}

describe("Spotlight Tracker off (the default)", () => {
  it("rolls spend nothing, the HUD shows no tokens, the GM's refill is refused (MECHANIC_DISABLED)", async () => {
    const a = await table();
    await a.roll();
    await a.roll();
    expect(await a.rows()).toEqual([]);
    expect((await a.party()).every((m) => m.tokens === undefined)).toBe(true);
    expect(await code(a.refill())).toBe("MECHANIC_DISABLED");
  });

  it("an explicit off is the same", async () => {
    const a = await table({ spotlightTracker: false, spotlightTrackerTokens: 5 });
    await a.roll();
    expect(await a.rows()).toEqual([]);
    expect(await a.tokensOf(a.w.characterA)).toBeUndefined();
  });
});

describe("Spotlight Tracker on", () => {
  it("each PC starts full with the default 3 (CB p.89: 'start with three')", async () => {
    const a = await table({ spotlightTracker: true });
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 3, of: 3 });
    expect(await a.tokensOf(a.w.characterB, "gm")).toEqual({ left: 3, of: 3 });
  });

  it("each action roll spends one; at 0 the roll still goes through and spends nothing more", async () => {
    const a = await table({ spotlightTracker: true });
    await a.roll();
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 2, of: 3 });
    await a.roll();
    await a.roll();
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 0, of: 3 });
    const r = await a.roll();
    expect(r.entryId).toBeTruthy();
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 0, of: 3 });
    expect((await a.rows()).map((x) => x.used)).toEqual([3]);
    // The other PC is untouched.
    expect(await a.tokensOf(a.w.characterB)).toEqual({ left: 3, of: 3 });
  });

  it("a reaction roll spends nothing (only action rolls, CB p.89)", async () => {
    const a = await table({ spotlightTracker: true });
    await a.roll("ash", "reaction");
    expect(await a.rows()).toEqual([]);
  });

  it("when every PC on the live map is at 0, all refill", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 2 });
    await a.roll("ash");
    await a.roll("ash");
    await a.roll("bryn");
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 0, of: 2 });
    expect(await a.tokensOf(a.w.characterB)).toEqual({ left: 1, of: 2 });
    await a.roll("bryn");
    expect(await a.rows()).toEqual([]);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 2, of: 2 });
    expect(await a.tokensOf(a.w.characterB)).toEqual({ left: 2, of: 2 });
  });

  it("the GM's number sets the tokens (1-6); one token: a single PC on the map refills on each roll", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 1 }, { bryn: false });
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 1, of: 1 });
    await a.roll();
    // Ash was the only PC on the map: out, so everyone (Ash) refilled.
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 1, of: 1 });
    expect(await a.rows()).toEqual([]);
  });

  it("a roll at 0 refills when everyone is out without a spend (a PC with tokens left the map)", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 1 });
    await a.roll("ash");
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 0, of: 1 });
    await a.t.run(async (ctx) => {
      const tokens = await ctx.db.query("combatTokens").withIndex("by_map", (q) => q.eq("mapId", a.mapId)).collect();
      for (const tk of tokens) if (tk.ref.kind === "pc" && tk.ref.characterId === a.w.characterB) await ctx.db.delete("combatTokens", tk._id);
    });
    await a.roll("ash");
    expect(await a.rows()).toEqual([]);
  });

  it("a PC not on the live map spends nothing (no live map, or no token on it)", async () => {
    const noLive = await table({ spotlightTracker: true }, { live: false });
    await noLive.roll();
    expect(await noLive.rows()).toEqual([]);

    const offMap = await table({ spotlightTracker: true }, { bryn: false });
    await offMap.roll("bryn");
    expect(await offMap.rows()).toEqual([]);
  });

  it("the GM refills by hand (keyed gmMutation); co-GM too; a player is refused", async () => {
    const a = await table({ spotlightTracker: true });
    await a.roll("ash");
    await a.roll("bryn");
    expect(await code(a.refill("player"))).toBe("FORBIDDEN");
    expect(await a.refill("gm")).toEqual({ refilled: 2 });
    expect(await a.rows()).toEqual([]);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 3, of: 3 });
    expect(await a.refill("coGm")).toEqual({ refilled: 0 });
  });

  it("a lower number after spending never shows below 0", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 3 });
    await a.roll();
    await a.roll();
    await a.t.run((ctx) => ctx.db.patch("campaigns", a.campaignId, { ruleModes: { spotlightTracker: true, spotlightTrackerTokens: 1 } }));
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 0, of: 1 });
  });
});

// Plan rule-switches RFB (docs/tasks/TASK-RULES-RFB.md): the user's answers of 2026-11-06.
describe("RFB: tokens refill when an encounter starts", () => {
  it("encounters.start refills every PC (on); off, it writes nothing", async () => {
    const a = await table({ spotlightTracker: true });
    await a.roll("ash");
    await a.roll("bryn");
    const { encounterId } = await a.gm.mutation(api.encounters.create, { campaignId: a.campaignId, name: "Ambush", idempotencyKey: key() });
    await a.gm.mutation(api.encounters.start, { campaignId: a.campaignId, encounterId });
    expect(await a.rows()).toEqual([]);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 3, of: 3 });

    // Starting it again while it runs changes nothing (it already started).
    await a.roll("ash");
    await a.gm.mutation(api.encounters.start, { campaignId: a.campaignId, encounterId });
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 2, of: 3 });
  });
});

describe("RFB: a Tag Team spends a token of both PCs", () => {
  async function tagTeam(a: Awaited<ReturnType<typeof table>>) {
    await a.t.run(async (ctx) => saveSheet(ctx, a.w.characterA, { ...readSheet((await ctx.db.get("characters", a.w.characterA))!.sheet), hope: 6 }));
    const side = { trait: "agility" as const, modifier: 0 };
    const before = await a.rows();
    const { rolls, groupId } = await a.player.mutation(api.rolls.tagTeam, {
      characterId: a.w.characterA,
      partnerId: a.w.characterB,
      initiator: side,
      partner: side,
      idempotencyKey: key(),
    });
    // Rolled, not applied yet: nothing spent.
    expect(await a.rows()).toEqual(before);
    await a.player.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: a.w.characterB, idempotencyKey: key() });
    return { entryId: rolls[0]!.entryId, groupId };
  }

  it("both PCs lose one when the roll is applied; undoing the Tag Team gives both back", async () => {
    const a = await table({ spotlightTracker: true });
    const { entryId, groupId } = await tagTeam(a);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 2, of: 3 });
    expect(await a.tokensOf(a.w.characterB)).toEqual({ left: 2, of: 3 });
    const recs = await a.records();
    expect(recs).toHaveLength(2);
    expect(recs.every((r) => r.groupId === groupId && r.removedAt !== undefined && r.characterId === undefined && r.visibility === "gm")).toBe(true);
    await a.undo(entryId);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 3, of: 3 });
    expect(await a.tokensOf(a.w.characterB)).toEqual({ left: 3, of: 3 });
  });

  it("a partner at 0 spends nothing; the initiator still does", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 2 });
    await a.roll("bryn");
    await a.roll("bryn");
    await tagTeam(a);
    // Ash spent one; Bryn was out already. Not everyone is out (Ash has one), so no refill.
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 1, of: 2 });
    expect(await a.tokensOf(a.w.characterB)).toEqual({ left: 0, of: 2 });
    expect(await a.records()).toHaveLength(3);
  });
});

describe("RFB: undoing a roll gives its token back", () => {
  it("a plain roll's spend is recorded (hidden from the feed) and its undo refunds it", async () => {
    const a = await table({ spotlightTracker: true });
    await a.roll();
    const { entryId } = await a.roll();
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 1, of: 3 });
    const feed = await a.gm.query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 20, cursor: null } });
    expect(feed.page.some((r) => r.ruleId === "spotlightTracker")).toBe(false);
    await a.undo(entryId);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 2, of: 3 });
  });

  it("a roll at 0 spent nothing, so its undo gives nothing", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 1 });
    await a.roll("ash");
    const { entryId } = await a.roll("ash");
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 0, of: 1 });
    await a.undo(entryId);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 0, of: 1 });
  });

  it("after a refill, undoing an older roll gives nothing (the refill stands)", async () => {
    const a = await table({ spotlightTracker: true });
    const { entryId } = await a.roll("ash");
    await a.refill();
    await a.undo(entryId);
    expect(await a.rows()).toEqual([]);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 3, of: 3 });
  });

  it("the roll that emptied everyone (and refilled them) gives nothing back on undo", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 1 }, { bryn: false });
    const { entryId } = await a.roll("ash");
    await a.undo(entryId);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 1, of: 1 });
    expect(await a.rows()).toEqual([]);
  });

  it("the tracker off: a roll gets no record and no group", async () => {
    const a = await table();
    const { entryId } = await a.roll();
    expect(await a.records()).toEqual([]);
    expect((await a.t.run((ctx) => ctx.db.get("actionLog", entryId)))?.groupId).toBeUndefined();
  });
});

describe("RFB: the GM spends a PC's token without a roll (combatSpotlight.spendToken)", () => {
  it("GM and co-GM spend; a player is refused (FORBIDDEN); off: MECHANIC_DISABLED", async () => {
    const a = await table({ spotlightTracker: true });
    expect(await a.spend(a.w.characterA)).toEqual({ spent: true, refilled: false });
    expect(await a.spend(a.w.characterA, "coGm")).toEqual({ spent: true, refilled: false });
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 1, of: 3 });
    expect(await code(a.spend(a.w.characterA, "player"))).toBe("FORBIDDEN");

    const off = await table();
    expect(await code(off.spend(off.w.characterA))).toBe("MECHANIC_DISABLED");
    expect(await off.rows()).toEqual([]);
  });

  it("at 0 or off the live map nothing is spent; a character that is gone is NOT_FOUND", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 1 }, { bryn: false });
    await a.t.run(async (ctx) => {
      await ctx.db.insert("actionTokens", { campaignId: a.campaignId, characterId: a.w.characterA, used: 1, updatedAt: Date.now() });
    });
    // Bryn has no token on the map: no spend, no record.
    expect(await a.spend(a.w.characterB)).toEqual({ spent: false, refilled: false });
    expect(await a.records()).toEqual([]);
    await a.t.run((ctx) => ctx.db.delete("characters", a.w.characterB));
    expect(await code(a.spend(a.w.characterB))).toBe("NOT_FOUND");
  });

  it("the spend is a GM-only feed line whose Undo gives the token back; the last token refills everyone", async () => {
    const a = await table({ spotlightTracker: true, spotlightTrackerTokens: 1 });
    await a.spend(a.w.characterA);
    const feed = await a.gm.query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 20, cursor: null } });
    const line = feed.page.find((r) => r.ruleId === "spotlightTracker");
    expect(line).toMatchObject({ visibility: "gm", canUndo: true });
    const playerFeed = await a.player.query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 20, cursor: null } });
    expect(playerFeed.page.some((r) => r.ruleId === "spotlightTracker")).toBe(false);
    await a.undo(line!._id);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 1, of: 1 });

    await a.spend(a.w.characterA);
    expect(await a.spend(a.w.characterB)).toEqual({ spent: true, refilled: true });
    expect(await a.rows()).toEqual([]);
  });

  it("the GM's spend does not block undoing the PC's earlier roll (no row on the character)", async () => {
    const a = await table({ spotlightTracker: true });
    const { entryId } = await a.roll("ash");
    await a.spend(a.w.characterA);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 1, of: 3 });
    await a.undo(entryId);
    expect(await a.tokensOf(a.w.characterA)).toEqual({ left: 2, of: 3 });
  });
});
