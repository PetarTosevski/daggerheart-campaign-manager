import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { MAX_CODEX_ENTRIES, MAX_CODEX_IMAGES, MAX_NAME, MAX_ROLE, MAX_TEXT } from "../../src/lib/codex/schema";
import { MAX_TOKENS } from "../../src/lib/world/map-state";
import { key, useAllowlist } from "./helpers";
import { modules } from "./setup";

// TE6: `codex.list` is a hot list query (every codex edit re-runs it for
// everyone on the page). With a campaign at the entry cap, every entry at its
// largest (longest name and role, 8 images, 8,000-character texts) and a map
// at the marker cap, it must stay under this budget.
// Measured at H15: about 1.9 MiB, 5,000 documents and 6-9 index ranges (500
// entries, 4,000 image file rows, 500 marker rows); the long text alone
// would add 500 x 16 KB = 8 MB.
const BUDGET = { bytesRead: 2.5 * 1024 * 1024, documentsRead: 5_500, databaseQueries: 16 };

// The rate limiter's test helper references vite/client types (see setup.ts).
type ComponentTestHelper = { default: { register: (t: unknown, name?: string) => void } };
const RATE_LIMITER_TEST = "@convex-dev/rate-limiter/test";
const rateLimiter = ((await import(/* @vite-ignore */ RATE_LIMITER_TEST)) as ComponentTestHelper).default;

/** convex-test that counts reads per transaction (`ctx.meta.getTransactionMetrics`). */
function budgetTest() {
  const t = convexTest({ schema, modules });
  rateLimiter.register(t);
  return t;
}

type T = ReturnType<typeof budgetTest>;

const long = (n: number, c = "x") => c.repeat(n);

/** A campaign with MAX_CODEX_ENTRIES max-size entries and MAX_TOKENS markers, written directly (no limits apply to t.run setup). */
async function fullCampaign(t: T) {
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    player: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const player = t.withIdentity({ subject: `${ids.player}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Full", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code });

  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("codexEntries").collect()) await ctx.db.delete(row._id);
    for (let tokenId = 1; tokenId <= MAX_TOKENS; tokenId++) {
      await ctx.db.insert("mapTokens", { campaignId, tokenId, type: "landmark", x: 50, y: 50, name: long(80), notes: long(500), hidden: false, location: true });
    }
  });
  for (let batch = 0; batch < MAX_CODEX_ENTRIES / 50; batch++) {
    await t.run(async (ctx) => {
      for (let i = 0; i < 50; i++) {
        const n = batch * 50 + i;
        const storageIds: Id<"_storage">[] = [];
        for (let g = 0; g < MAX_CODEX_IMAGES; g++) storageIds.push(await ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
        const entryId = await ctx.db.insert("codexEntries", {
          campaignId,
          kind: n % 2 ? "location" : "character",
          data: {
            schemaVersion: 2,
            name: long(MAX_NAME),
            role: long(MAX_ROLE),
            known: true,
            images: storageIds.map((storageId) => ({ storageId, shown: true })),
            cover: storageIds[0],
            allegiance: "Fanewick",
            allegianceShown: "Haven",
            region: "Haven",
            tokenId: (n % MAX_TOKENS) + 1,
          },
          createdAt: n,
          updatedAt: n,
        });
        await ctx.db.insert("codexEntryText", { campaignId, entryId, pdesc: long(MAX_TEXT, "p"), gmn: long(MAX_TEXT, "g") });
        for (const storageId of storageIds) {
          await ctx.db.insert("files", { storageId, campaignId, uploadedBy: ids.gm, kind: "codexImage", refId: entryId, createdAt: 0 });
        }
      }
    });
  }
  return { ids, campaignId };
}

describe("codex.list read budget", () => {
  useAllowlist("gm@example.com,p1@example.com");

  it(`stays under ${BUDGET.bytesRead} bytes and ${BUDGET.documentsRead} documents with ${MAX_CODEX_ENTRIES} max-size entries`, { timeout: 120_000 }, async () => {
    const t = budgetTest();
    const { ids, campaignId } = await fullCampaign(t);
    const measure = async (userId: Id<"users">) =>
      t.withIdentity({ subject: `${userId}|s` }).run(async (ctx) => {
        const before = await ctx.meta.getTransactionMetrics();
        const view = await ctx.runQuery(api.codex.list, { campaignId });
        const after = await ctx.meta.getTransactionMetrics();
        return {
          entries: view.entries.length,
          bytesRead: after.bytesRead.used - before.bytesRead.used,
          documentsRead: after.documentsRead.used - before.documentsRead.used,
          databaseQueries: after.databaseQueries.used - before.databaseQueries.used,
        };
      });
    for (const userId of [ids.gm, ids.player]) {
      const used = await measure(userId);
      expect(used.entries).toBe(MAX_CODEX_ENTRIES);
      expect(used.bytesRead).toBeLessThan(BUDGET.bytesRead);
      expect(used.documentsRead).toBeLessThan(BUDGET.documentsRead);
      expect(used.databaseQueries).toBeLessThan(BUDGET.databaseQueries);
    }
  });
});
