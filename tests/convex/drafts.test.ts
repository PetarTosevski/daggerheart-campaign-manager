import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import crons from "../../convex/crons";
import { BATCH, DRAFT_TTL_MS } from "../../convex/draftsRetention";
import { DRAFT_MAX_BYTES, DRAFT_SCHEMA_VERSION } from "../../src/lib/config/preferences";
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
