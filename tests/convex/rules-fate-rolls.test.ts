import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { fateLine } from "../../convex/fateRolls";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key, setupWithCampaign } from "./helpers";

/** Plan rule-switches OFT: Fate rolls (CB p.168), optional, off by default; a player's dice box rolls them (Q13 c). */

async function world() {
  const setup = await setupWithCampaign();
  const { t, gm, other, campaignId } = setup;
  const playerId = await t.run((ctx) => ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }));
  const otherPlayerId = await t.run((ctx) => ctx.db.insert("users", { email: "player2@example.com", emailVerificationTime: 1 }));
  await t.run(async (ctx) => {
    await ctx.db.insert("campaignMembers", { campaignId, userId: playerId, joinedAt: 0, lastOpenedAt: 0 });
    await ctx.db.insert("campaignMembers", { campaignId, userId: otherPlayerId, joinedAt: 0, lastOpenedAt: 0 });
  });
  const player = t.withIdentity({ subject: `${playerId}|session` });
  const otherPlayer = t.withIdentity({ subject: `${otherPlayerId}|session` });
  const { characterId: mira } = await player.mutation(api.characters.create, { campaignId, draft: characterDraft("Mira"), idempotencyKey: key() });
  const { characterId: ash } = await otherPlayer.mutation(api.characters.create, { campaignId, draft: characterDraft("Ash"), idempotencyKey: key() });
  const turnOn = () => gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "fateRolls", value: true } });
  return { ...setup, other, player, otherPlayer, mira, ash, turnOn };
}

const failure = (p: Promise<unknown>) => p.then(() => null, errorCode);

/** Everything a Fate roll must leave alone. */
async function snapshot(w: Awaited<ReturnType<typeof world>>) {
  return w.t.run(async (ctx) => ({
    mira: (await ctx.db.get("characters", w.mira))?.sheet,
    state: await ctx.db
      .query("campaignState")
      .withIndex("by_campaign", (q) => q.eq("campaignId", w.campaignId))
      .unique(),
  }));
}

describe("fateRolls (off by default)", () => {
  it("refuses a roll with MECHANIC_DISABLED and the dice box shows no button", async () => {
    const w = await world();
    expect(await failure(w.player.mutation(api.fateRolls.roll, { characterId: w.mira, die: "hope", idempotencyKey: key() }))).toBe("MECHANIC_DISABLED");
    expect(await w.player.query(api.fateRolls.status, { campaignId: w.campaignId })).toEqual({ enabled: false, characters: [] });
    expect(await w.gm.query(api.fateRolls.status, { campaignId: w.campaignId })).toEqual({ enabled: false, characters: [] });
  });
});

describe("fateRolls (on)", () => {
  it("lists a player's own PCs, and every PC for the GM", async () => {
    const w = await world();
    await w.turnOn();
    expect(await w.player.query(api.fateRolls.status, { campaignId: w.campaignId })).toEqual({ enabled: true, characters: [{ _id: w.mira, name: "Mira" }] });
    const gmView = await w.gm.query(api.fateRolls.status, { campaignId: w.campaignId });
    expect(gmView.enabled).toBe(true);
    expect(gmView.characters.map((c) => c.name).sort()).toEqual(["Ash", "Mira"]);
  });

  it("rolls the Fear Die alone, posts a public feed row of the PC, and changes no Hope, Stress, Fear or countdown", async () => {
    const w = await world();
    await w.turnOn();
    const before = await snapshot(w);
    const { entryId, roll } = await w.player.mutation(api.fateRolls.roll, { characterId: w.mira, die: "fear", note: "On a 4 or lower, the fire spreads", idempotencyKey: key() });
    expect(roll).toMatchObject({ kind: "free", modifier: 0, outcome: "none", manual: false });
    expect(roll.dice).toHaveLength(1);
    expect(roll.dice[0]).toMatchObject({ sides: 12, role: "fear" });
    expect(roll.total).toBe(roll.dice[0]!.value);
    expect(roll.total).toBeGreaterThanOrEqual(1);
    expect(roll.total).toBeLessThanOrEqual(12);
    const row = await w.t.run((ctx) => ctx.db.get("actionLog", entryId));
    expect(row).toMatchObject({
      kind: "roll",
      visibility: "public",
      characterId: w.mira,
      summary: `Fate roll for Mira (Fear Die): ${roll.total} · On a 4 or lower, the fire spreads`,
      undoable: true,
    });
    expect(row?.fearDelta).toBeUndefined();
    expect(row?.before).toBeUndefined();
    expect(await snapshot(w)).toEqual(before);
    // Everyone in the campaign sees it in the feed.
    const feed = await w.otherPlayer.query(api.feed.list, { campaignId: w.campaignId, paginationOpts: { numItems: 5, cursor: null } });
    expect(feed.page.some((r: { _id: string }) => r._id === entryId)).toBe(true);
  });

  it("rolls the Hope Die for any PC as the GM", async () => {
    const w = await world();
    await w.turnOn();
    const { roll } = await w.gm.mutation(api.fateRolls.roll, { characterId: w.ash, die: "hope", idempotencyKey: key() });
    expect(roll.dice[0]).toMatchObject({ sides: 12, role: "hope" });
  });

  it("refuses another player's PC with FORBIDDEN and an outsider with NOT_FOUND", async () => {
    const w = await world();
    await w.turnOn();
    expect(await failure(w.player.mutation(api.fateRolls.roll, { characterId: w.ash, die: "hope", idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(w.other.mutation(api.fateRolls.roll, { characterId: w.mira, die: "hope", idempotencyKey: key() }))).toBe("NOT_FOUND");
  });

  it("replays the same roll for the same idempotency key", async () => {
    const w = await world();
    await w.turnOn();
    const k = key();
    const first = await w.player.mutation(api.fateRolls.roll, { characterId: w.mira, die: "hope", idempotencyKey: k });
    const again = await w.player.mutation(api.fateRolls.roll, { characterId: w.mira, die: "hope", idempotencyKey: k });
    expect(again).toEqual(first);
  });
});

describe("fateLine", () => {
  it("names the PC and the die; the note is optional and trimmed", () => {
    expect(fateLine("Mira", "hope", 9, undefined)).toBe("Fate roll for Mira (Hope Die): 9");
    expect(fateLine("Mira", "fear", 4, "  ")).toBe("Fate roll for Mira (Fear Die): 4");
    expect(fateLine("Mira", "fear", 4, " the fire spreads ")).toBe("Fate roll for Mira (Fear Die): 4 · the fire spreads");
  });
});
