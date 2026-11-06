import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import crons from "../../convex/crons";
import { BATCH, DRAFT_TTL_MS } from "../../convex/draftsRetention";
import { DRAFT_MAX_BYTES, DRAFT_SCHEMA_VERSION } from "../../src/lib/config/preferences";
import { buildWorld } from "./authz/world";
import { errorCode, setupWithCampaign } from "./helpers";

/** Config P2: unsent drafts on the account (Q15 b) and their 90-day expiry (rule 8). */
describe("drafts (P2)", () => {
  async function withPlayer() {
    const setup = await setupWithCampaign();
    const { t, campaignId } = setup;
    const playerId = await t.run((ctx) => ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }));
    await t.run((ctx) => ctx.db.insert("campaignMembers", { campaignId, userId: playerId, joinedAt: 0, lastOpenedAt: 0 }));
    return { ...setup, playerId, player: t.withIdentity({ subject: `${playerId}|session` }) };
  }

  const wizard = (campaignId: Id<"campaigns">, data = '{"step":2}') =>
    ({ kind: "characterWizard", campaignId, schemaVersion: 1, data }) as const;

  it("saves, reads, replaces and clears a wizard draft per campaign, and the custom-frame draft", async () => {
    const { player, campaignId } = await withPlayer();
    expect(await player.query(api.drafts.get, { kind: "characterWizard", campaignId })).toBeNull();
    await player.mutation(api.drafts.save, wizard(campaignId));
    expect(await player.query(api.drafts.get, { kind: "characterWizard", campaignId })).toMatchObject({
      schemaVersion: 1,
      data: '{"step":2}',
    });
    await player.mutation(api.drafts.save, wizard(campaignId, '{"step":3}'));
    expect((await player.query(api.drafts.get, { kind: "characterWizard", campaignId }))?.data).toBe('{"step":3}');

    await player.mutation(api.drafts.save, { kind: "customFrame", schemaVersion: 1, data: '{"name":"Mine"}' });
    expect((await player.query(api.drafts.get, { kind: "customFrame" }))?.data).toBe('{"name":"Mine"}');

    await player.mutation(api.drafts.clear, { kind: "characterWizard", campaignId });
    expect(await player.query(api.drafts.get, { kind: "characterWizard", campaignId })).toBeNull();
    expect(await player.query(api.drafts.get, { kind: "customFrame" })).not.toBeNull();
    await player.mutation(api.drafts.clear, { kind: "customFrame" });
    await player.mutation(api.drafts.clear, { kind: "customFrame" });
    expect(await player.query(api.drafts.get, { kind: "customFrame" })).toBeNull();
  });

  it("never shows or clears another user's draft", async () => {
    const { gm, player, campaignId } = await withPlayer();
    await player.mutation(api.drafts.save, wizard(campaignId));
    await player.mutation(api.drafts.save, { kind: "customFrame", schemaVersion: 1, data: "{}" });
    expect(await gm.query(api.drafts.get, { kind: "characterWizard", campaignId })).toBeNull();
    expect(await gm.query(api.drafts.get, { kind: "customFrame" })).toBeNull();
    await gm.mutation(api.drafts.clear, { kind: "characterWizard", campaignId });
    await gm.mutation(api.drafts.clear, { kind: "customFrame" });
    expect(await player.query(api.drafts.get, { kind: "characterWizard", campaignId })).not.toBeNull();
    expect(await player.query(api.drafts.get, { kind: "customFrame" })).not.toBeNull();
  });

  it("a wizard draft needs view on its campaign: an outsider and a deleted campaign are NOT_FOUND", async () => {
    const { t, other, player, campaignId } = await withPlayer();
    await expect(other.query(api.drafts.get, { kind: "characterWizard", campaignId })).rejects.toSatisfy(
      (e) => errorCode(e) === "NOT_FOUND",
    );
    await expect(other.mutation(api.drafts.save, wizard(campaignId))).rejects.toSatisfy((e) => errorCode(e) === "NOT_FOUND");
    await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { deletedAt: Date.now() }));
    await expect(player.query(api.drafts.get, { kind: "characterWizard", campaignId })).rejects.toSatisfy(
      (e) => errorCode(e) === "NOT_FOUND",
    );
  });

  it("refuses bad drafts with INVALID", async () => {
    const { player, campaignId } = await withPlayer();
    const big = JSON.stringify({ text: "x".repeat(DRAFT_MAX_BYTES) });
    const bad = [
      wizard(campaignId, big),
      wizard(campaignId, "not json"),
      wizard(campaignId, "[1,2]"),
      { ...wizard(campaignId), schemaVersion: 0 },
      { ...wizard(campaignId), schemaVersion: 1.5 },
      { kind: "characterWizard" as const, schemaVersion: 1, data: "{}" },
      { kind: "customFrame" as const, campaignId, schemaVersion: 1, data: "{}" },
    ];
    for (const args of bad) {
      await expect(player.mutation(api.drafts.save, args)).rejects.toSatisfy((e) => errorCode(e) === "INVALID");
    }
    await expect(player.query(api.drafts.get, { kind: "characterWizard" })).rejects.toSatisfy((e) => errorCode(e) === "INVALID");
  });

  it("importLegacy saves only missing drafts, skips what the caller can't see or the server can't keep, and is idempotent", async () => {
    const { t, player, campaignId } = await withPlayer();
    const hidden = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { email: "stranger@example.com", emailVerificationTime: 1 });
      return ctx.db.insert("campaigns", {
        ownerId,
        frameId: "witherwild",
        name: "Theirs",
        nameKey: "theirs",
        tier: 1,
        level: 1,
        createdAt: 0,
        lastOpenedAt: 0,
      });
    });
    await player.mutation(api.drafts.save, { kind: "customFrame", schemaVersion: 1, data: '{"kept":true}' });
    const drafts = [
      { kind: "characterWizard" as const, campaignId, data: '{"step":1}' },
      { kind: "characterWizard" as const, campaignId: hidden, data: '{"step":1}' },
      { kind: "characterWizard" as const, campaignId: "not-an-id", data: '{"step":1}' },
      { kind: "characterWizard" as const, data: '{"step":1}' },
      { kind: "customFrame" as const, data: '{"kept":false}' },
      { kind: "characterWizard" as const, campaignId, data: "nope" },
    ];
    await player.mutation(api.drafts.importLegacy, { drafts });
    expect(await player.query(api.drafts.get, { kind: "characterWizard", campaignId })).toMatchObject({
      schemaVersion: DRAFT_SCHEMA_VERSION,
      data: '{"step":1}',
    });
    expect((await player.query(api.drafts.get, { kind: "customFrame" }))?.data).toBe('{"kept":true}');
    await player.mutation(api.drafts.importLegacy, { drafts });
    const rows = await t.run((ctx) => ctx.db.query("userDrafts").collect());
    expect(rows).toHaveLength(2);
  });
});

/** Config N4 b: a guided level-up's unconfirmed picks are a `levelUp` draft per character on the account. */
describe("level-up drafts (N4 b)", () => {
  const levelUp = (characterId: Id<"characters">, data = '{"level":1}') =>
    ({ kind: "levelUp", characterId, schemaVersion: 1, data }) as const;

  it("saves, reads, replaces and clears a draft per character, stored with the character's campaign", async () => {
    const w = await buildWorld();
    const player = w.as("player");
    expect(await player.query(api.drafts.get, { kind: "levelUp", characterId: w.characterA })).toBeNull();
    await player.mutation(api.drafts.save, levelUp(w.characterA));
    await player.mutation(api.drafts.save, levelUp(w.characterA, '{"level":2}'));
    expect(await player.query(api.drafts.get, { kind: "levelUp", characterId: w.characterA })).toMatchObject({ schemaVersion: 1, data: '{"level":2}' });
    const rows = await w.t.run((ctx) => ctx.db.query("userDrafts").collect());
    expect(rows).toEqual([expect.objectContaining({ userId: w.users.player, kind: "levelUp", characterId: w.characterA, campaignId: w.campaignId })]);

    // The GM's drafts are their own, one per character, and apart from a wizard draft in the same campaign.
    const gm = w.as("gm");
    await gm.mutation(api.drafts.save, levelUp(w.characterA, '{"gm":"a"}'));
    await gm.mutation(api.drafts.save, levelUp(w.characterB, '{"gm":"b"}'));
    await gm.mutation(api.drafts.save, { kind: "characterWizard", campaignId: w.campaignId, schemaVersion: 1, data: '{"step":1}' });
    expect((await gm.query(api.drafts.get, { kind: "levelUp", characterId: w.characterA }))?.data).toBe('{"gm":"a"}');
    expect((await gm.query(api.drafts.get, { kind: "levelUp", characterId: w.characterB }))?.data).toBe('{"gm":"b"}');
    expect((await player.query(api.drafts.get, { kind: "levelUp", characterId: w.characterA }))?.data).toBe('{"level":2}');

    await gm.mutation(api.drafts.clear, { kind: "levelUp", characterId: w.characterA });
    expect(await gm.query(api.drafts.get, { kind: "levelUp", characterId: w.characterA })).toBeNull();
    expect(await gm.query(api.drafts.get, { kind: "levelUp", characterId: w.characterB })).not.toBeNull();
    expect(await gm.query(api.drafts.get, { kind: "characterWizard", campaignId: w.campaignId })).not.toBeNull();
    expect(await player.query(api.drafts.get, { kind: "levelUp", characterId: w.characterA })).not.toBeNull();
    await player.mutation(api.drafts.clear, { kind: "levelUp", characterId: w.characterA });
    expect(await player.query(api.drafts.get, { kind: "levelUp", characterId: w.characterA })).toBeNull();
  });

  it("only the character's owner and the GM (or co-GM) read or write it: another player is FORBIDDEN, an outsider NOT_FOUND", async () => {
    const w = await buildWorld();
    const expected = { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "ok", grantee: "ok", coGm: "ok", gm: "ok" } as const;
    for (const [role, outcome] of Object.entries(expected) as [keyof typeof expected, string][]) {
      const caller = w.as(role);
      const results = await Promise.all([
        caller.query(api.drafts.get, { kind: "levelUp", characterId: w.characterA }).then(
          () => "ok",
          (e: unknown) => errorCode(e),
        ),
        caller.mutation(api.drafts.save, levelUp(w.characterA)).then(
          () => "ok",
          (e: unknown) => errorCode(e),
        ),
      ]);
      expect({ role, results }).toEqual({ role, results: [outcome, outcome] });
    }
  });

  it("a wizard draft keeps its campaign-view rule for every role (the matrix runs drafts.get/save with the level-up scope)", async () => {
    const w = await buildWorld();
    const expected = { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "ok", player: "ok", grantee: "ok", coGm: "ok", gm: "ok" } as const;
    const wizardArgs = { kind: "characterWizard" as const, campaignId: w.campaignId };
    for (const [role, outcome] of Object.entries(expected) as [keyof typeof expected, string][]) {
      const caller = w.as(role);
      const results = await Promise.all([
        caller.query(api.drafts.get, wizardArgs).then(
          () => "ok",
          (e: unknown) => errorCode(e),
        ),
        caller.mutation(api.drafts.save, { ...wizardArgs, schemaVersion: 1, data: "{}" }).then(
          () => "ok",
          (e: unknown) => errorCode(e),
        ),
      ]);
      expect({ role, results }).toEqual({ role, results: [outcome, outcome] });
    }
  });

  it("clear only touches the caller's own row (no character check), so it never reveals or removes another's draft", async () => {
    const w = await buildWorld();
    await w.as("player").mutation(api.drafts.save, levelUp(w.characterA));
    await w.as("otherPlayer").mutation(api.drafts.clear, { kind: "levelUp", characterId: w.characterA });
    await w.as("outsider").mutation(api.drafts.clear, { kind: "levelUp", characterId: w.characterA });
    await w.as("gm").mutation(api.drafts.clear, { kind: "levelUp", characterId: w.characterA });
    expect(await w.as("player").query(api.drafts.get, { kind: "levelUp", characterId: w.characterA })).not.toBeNull();
    await w.as("player").mutation(api.drafts.clear, { kind: "levelUp" });
    expect(await w.as("player").query(api.drafts.get, { kind: "levelUp", characterId: w.characterA })).not.toBeNull();
  });

  it("a level-up draft names its character only (INVALID otherwise), and the other kinds refuse a character", async () => {
    const w = await buildWorld();
    const player = w.as("player");
    const bad = [
      { kind: "levelUp" as const, schemaVersion: 1, data: "{}" },
      { ...levelUp(w.characterA), campaignId: w.campaignId },
      { ...levelUp(w.characterA), data: "[1]" },
      { kind: "characterWizard" as const, campaignId: w.campaignId, characterId: w.characterA, schemaVersion: 1, data: "{}" },
      { kind: "customFrame" as const, characterId: w.characterA, schemaVersion: 1, data: "{}" },
    ];
    for (const args of bad) {
      await expect(player.mutation(api.drafts.save, args)).rejects.toSatisfy((e) => errorCode(e) === "INVALID");
    }
    await expect(player.query(api.drafts.get, { kind: "levelUp" })).rejects.toSatisfy((e) => errorCode(e) === "INVALID");
  });

  it("goes with its campaign's purge path (by_campaign) and a deleted campaign hides it", async () => {
    const w = await buildWorld();
    await w.as("player").mutation(api.drafts.save, levelUp(w.characterA));
    const byCampaign = await w.t.run((ctx) => ctx.db.query("userDrafts").withIndex("by_campaign", (q) => q.eq("campaignId", w.campaignId)).collect());
    expect(byCampaign).toHaveLength(1);
    await w.t.run((ctx) => ctx.db.patch("campaigns", w.campaignId, { deletedAt: Date.now() }));
    await expect(w.as("player").query(api.drafts.get, { kind: "levelUp", characterId: w.characterA })).rejects.toSatisfy(
      (e) => errorCode(e) === "NOT_FOUND",
    );
  });
});

describe("drafts retention (P2, rule 8)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs daily at an odd minute", () => {
    const jobs = (crons as unknown as { crons: Record<string, { schedule: { type: string; cron?: string } }> }).crons;
    expect(jobs["expire old drafts"]?.schedule).toEqual({ type: "cron", cron: "31 4 * * *" });
  });

  it("deletes drafts not saved for 90 days in batches, rescheduling itself, and keeps newer ones", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-11-04T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const { t, campaignId } = await setupWithCampaign();
    const userId = await t.run(async (ctx) => (await ctx.db.query("users").first())!._id);
    const old = now - DRAFT_TTL_MS - 1;
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 5; i++) {
        await ctx.db.insert("userDrafts", { userId, kind: "characterWizard", campaignId, schemaVersion: 1, data: "{}", updatedAt: old - i });
      }
      await ctx.db.insert("userDrafts", { userId, kind: "customFrame", schemaVersion: 1, data: "{}", updatedAt: old });
      await ctx.db.insert("userDrafts", { userId, kind: "customFrame", schemaVersion: 1, data: '{"fresh":1}', updatedAt: now - DRAFT_TTL_MS + 60_000 });
    });

    await t.mutation(internal.draftsRetention.expire, {});
    expect(await t.run(async (ctx) => (await ctx.db.query("userDrafts").collect()).length)).toBe(BATCH + 7 - BATCH);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run((ctx) => ctx.db.query("userDrafts").collect());
    expect(left.map((r) => r.data)).toEqual(['{"fresh":1}']);
  });

  it("does not reschedule after a partial batch", async () => {
    vi.useFakeTimers();
    const { t } = await setupWithCampaign();
    await t.mutation(internal.draftsRetention.expire, {});
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(0);
  });
});
