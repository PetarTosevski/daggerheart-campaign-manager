import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, components, internal } from "../../convex/_generated/api";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("migrations/uploads:moveUploadsToFiles", () => {
  useAllowlist(GM);

  async function setup() {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Old", idempotencyKey: key() });
    const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
    const ids = await t.run(async (ctx) => {
      const store = () => ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      const characterId = await ctx.db.insert("characters", { campaignId, ownerId: gmId, createdBy: gmId, status: "active", sheet: {}, createdAt: 0, updatedAt: 0 });
      const goneId = await ctx.db.insert("characters", { campaignId, ownerId: gmId, createdBy: gmId, status: "active", sheet: {}, createdAt: 0, updatedAt: 0 });
      await ctx.db.delete(goneId);
      const map = await store();
      const image = await store();
      const portrait = await store();
      const orphan = await store();
      await ctx.db.insert("mapUploads", { storageId: map, campaignId, uploadedBy: gmId, createdAt: 1 });
      await ctx.db.insert("codexImages", { storageId: image, campaignId, entryId, uploadedBy: gmId, createdAt: 2 });
      await ctx.db.insert("portraitUploads", { storageId: portrait, userId: gmId, characterId, createdAt: 3 });
      await ctx.db.insert("portraitUploads", { storageId: orphan, userId: gmId, characterId: goneId, createdAt: 4 });
      return { characterId, map, image, portrait };
    });
    const expected = [
      { storageId: ids.map, c: campaignId, uploadedBy: gmId, kind: "map", refId: campaignId, createdAt: 1 },
      { storageId: ids.image, c: campaignId, uploadedBy: gmId, kind: "codexImage", refId: entryId, createdAt: 2 },
      { storageId: ids.portrait, c: campaignId, uploadedBy: gmId, kind: "portrait", refId: ids.characterId, createdAt: 3 },
    ];
    return { t, expected };
  }

  async function files(t: Awaited<ReturnType<typeof setup>>["t"]) {
    const rows = await t.run((ctx) => ctx.db.query("files").collect());
    return rows.map(({ storageId, campaignId: c, uploadedBy, kind, refId, createdAt }) => ({ storageId, c, uploadedBy, kind, refId, createdAt }));
  }

  it("copies the old upload tables into files in batches, skipping orphaned portraits", async () => {
    const { t, expected } = await setup();
    await t.mutation(internal.migrations.uploads.moveUploadsToFiles, { batchSize: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await files(t)).toEqual(expected);
  });

  it("is idempotent: a reset run copies nothing twice", async () => {
    const { t, expected } = await setup();
    await t.mutation(internal.migrations.uploads.moveUploadsToFiles, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(internal.migrations.uploads.moveUploadsToFiles, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await files(t)).toEqual(expected);
  });

  it("a dry run through the runner processes a batch and commits nothing", async () => {
    const { t } = await setup();
    const status = await t.mutation(internal.migrations.run.run, { fn: "migrations/uploads:moveMapUploads", dryRun: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(status).toMatchObject({ processed: 1 });
    expect(await files(t)).toEqual([]);
  });

  it("resumes from its cursor instead of starting over", async () => {
    const { t, expected } = await setup();
    const name = "migrations/uploads:movePortraitUploads";
    // One batch only, then stop: the migration is left part-way.
    await t.mutation(internal.migrations.run.run, { fn: name, batchSize: 1, oneBatchOnly: true });
    expect(await files(t)).toEqual([expected[2]]);
    const [partway] = await t.query(components.migrations.lib.getStatus, { names: [name] });
    expect(partway).toMatchObject({ processed: 1, isDone: false });
    // Running it again continues from the stored cursor: only the second row is processed.
    await t.mutation(internal.migrations.run.run, { fn: name, batchSize: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [done] = await t.query(components.migrations.lib.getStatus, { names: [name] });
    expect(done).toMatchObject({ processed: 2, isDone: true, state: "success" });
    expect(await files(t)).toEqual([expected[2]]);
  });
});
