import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { logAction, newGroupId } from "../../convex/lib/actionLog";
import { postRuleNote } from "../../convex/lib/ruleModes";
import { errorCode, key, setupWithCampaign } from "./helpers";

/** Plan rule-switches RS0: `postRuleNote` writes a GM-only `rule` row that undo takes back with its action. */

async function withMembers() {
  const setup = await setupWithCampaign();
  const { t, campaignId } = setup;
  const gmId = await t.run(async (ctx) => (await ctx.db.get("campaigns", campaignId))!.ownerId);
  const playerId = await t.run((ctx) => ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }));
  const coGmId = await t.run((ctx) => ctx.db.insert("users", { email: "cogm@example.com", emailVerificationTime: 1 }));
  await t.run(async (ctx) => {
    await ctx.db.insert("campaignMembers", { campaignId, userId: playerId, joinedAt: 0, lastOpenedAt: 0 });
    await ctx.db.insert("campaignMembers", { campaignId, userId: coGmId, joinedAt: 0, lastOpenedAt: 0, role: "coGm" });
  });
  return {
    ...setup,
    gmId,
    player: t.withIdentity({ subject: `${playerId}|session` }),
    coGm: t.withIdentity({ subject: `${coGmId}|session` }),
  };
}

const page = { paginationOpts: { numItems: 20, cursor: null } };

describe("postRuleNote", () => {
  it("writes a GM-only rule row the GM and co-GM see in the feed and players never receive", async () => {
    const { t, gm, coGm, player, campaignId, gmId } = await withMembers();
    const id = await t.run((ctx) => postRuleNote(ctx, { _id: campaignId }, { ruleId: "hopeFearFromRolls", summary: "Mira rolled with Fear: gain 1 Fear?", actorId: gmId }));
    const row = await t.run((ctx) => ctx.db.get("actionLog", id));
    expect(row).toMatchObject({ kind: "rule", visibility: "gm", ruleId: "hopeFearFromRolls", undoable: false, summary: "Mira rolled with Fear: gain 1 Fear?" });
    for (const who of [gm, coGm]) {
      const feed = await who.query(api.feed.list, { campaignId, ...page });
      expect(feed.page.map((r) => [r._id, r.kind, r.visibility])).toEqual([[id, "rule", "gm"]]);
    }
    expect((await player.query(api.feed.list, { campaignId, ...page })).page).toEqual([]);
  });

  it("cuts the summary at 300 characters", async () => {
    const { t, campaignId, gmId } = await withMembers();
    const id = await t.run((ctx) => postRuleNote(ctx, { _id: campaignId }, { ruleId: "countdownTicks", summary: "x".repeat(400), actorId: gmId }));
    expect((await t.run((ctx) => ctx.db.get("actionLog", id)))?.summary).toHaveLength(300);
  });

  it("is undone with its action when it shares the action's groupId", async () => {
    const { t, gm, campaignId, gmId } = await withMembers();
    const groupId = newGroupId();
    const [actionId, noteId] = await t.run(async (ctx) => [
      await logAction(ctx, { campaignId, actorId: gmId, kind: "session", visibility: "public", summary: "An action", groupId, undoable: true }),
      await postRuleNote(ctx, { _id: campaignId }, { ruleId: "spotlightToGm", summary: "Mira failed: take the spotlight?", groupId, actorId: gmId }),
    ]);
    await gm.mutation(api.actionLog.undo, { entryId: actionId, idempotencyKey: key() });
    const rows = await t.run(async (ctx) => [await ctx.db.get("actionLog", actionId), await ctx.db.get("actionLog", noteId)]);
    expect(rows.map((r) => r?.undoneAt !== undefined)).toEqual([true, true]);
  });

  it("a note without a group can't be undone; a player can't even see it to undo", async () => {
    const { t, gm, player, campaignId, gmId } = await withMembers();
    const id = await t.run((ctx) => postRuleNote(ctx, { _id: campaignId }, { ruleId: "resistance", summary: "Target resists: halve?", actorId: gmId }));
    expect(errorCode(await gm.mutation(api.actionLog.undo, { entryId: id, idempotencyKey: key() }).catch((e: unknown) => e))).toBe("UNDO_STALE");
    expect(errorCode(await player.mutation(api.actionLog.undo, { entryId: id, idempotencyKey: key() }).catch((e: unknown) => e))).toBe("NOT_FOUND");
  });

  it("refuses a note about a character without its action's groupId (it would block undoing that character's actions)", async () => {
    const { t, campaignId, gmId } = await withMembers();
    // The check runs before any write, so any id will do.
    const characterId = "not-a-character" as never;
    await expect(
      t.run((ctx) => postRuleNote(ctx, { _id: campaignId }, { ruleId: "deathMovePrompt", summary: "Kael marked their last HP", characterId, actorId: gmId })),
    ).rejects.toThrow(/groupId/);
    expect(await t.run((ctx) => ctx.db.query("actionLog").take(1))).toEqual([]);
  });
});
