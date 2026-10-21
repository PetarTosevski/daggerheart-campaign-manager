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

/** The generic runner (`migrations/run:run`), driven through `migrations/codex:countEntries` on campaigns without a counter. */
describe("migrations/run:run", () => {
  useAllowlist(GM);
  const name = "migrations/codex:countEntries";

  async function setup() {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|s` });
    for (const campaignName of ["One", "Two"]) {
      await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: campaignName, idempotencyKey: key() });
    }
    // Campaigns from before the counter: no `codexCounters` row.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("codexCounters").collect()) await ctx.db.delete(row._id);
    });
    return t;
  }

  function counters(t: Awaited<ReturnType<typeof setup>>) {
    return t.run(async (ctx) => (await ctx.db.query("codexCounters").collect()).length);
  }

  it("a dry run processes a batch and commits nothing", async () => {
    const t = await setup();
    const status = await t.mutation(internal.migrations.run.run, { fn: name, batchSize: 1, dryRun: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(status).toMatchObject({ processed: 1 });
    expect(await counters(t)).toBe(0);
  });

  it("resumes from its cursor instead of starting over", async () => {
    const t = await setup();
    // One batch only, then stop: the migration is left part-way.
    await t.mutation(internal.migrations.run.run, { fn: name, batchSize: 1, oneBatchOnly: true });
    expect(await counters(t)).toBe(1);
    const [partway] = await t.query(components.migrations.lib.getStatus, { names: [name] });
    expect(partway).toMatchObject({ processed: 1, isDone: false });
    // Running it again continues from the stored cursor: only the second row is processed.
    await t.mutation(internal.migrations.run.run, { fn: name, batchSize: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [done] = await t.query(components.migrations.lib.getStatus, { names: [name] });
    expect(done).toMatchObject({ processed: 2, isDone: true, state: "success" });
    expect(await counters(t)).toBe(2);
  });
});
