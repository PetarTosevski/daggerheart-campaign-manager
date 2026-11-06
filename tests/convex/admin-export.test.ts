import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EXCLUDED_TABLES, EXPORTED_TABLES, EXPORT_SCHEMA_VERSION, PAGE_ROWS, REDACTED_FIELDS } from "../../convex/adminExport";
import { EXPORT_TTL_MS } from "../../convex/adminRetention";
import schema from "../../convex/schema";
import { errorCode } from "./helpers";
import { makeTest } from "./setup";

/**
 * Config AD11 (Q30 a): the owner exports everything as one JSON file, built in pages by an internal action and
 * downloaded only through the owner-checked HTTP route; secrets, book text and idempotency results are never in it.
 * docs/tasks/TASK-CONFIG-AD11.md.
 */

const NOW = new Date("2026-11-04T12:00:00Z").getTime();
const OWNER = "owner@example.com";
const OTHER = "other@example.com";

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: OWNER, emailVerificationTime: 1 });
    const other = await ctx.db.insert("users", { email: OTHER, emailVerificationTime: 1 });
    await ctx.db.insert("appConfig", { key: "app", ownerId: owner, updatedAt: NOW });
    return { owner, other };
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, owner: as(ids.owner), other: as(ids.other) };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Starts an export as the owner and runs the build to the end. */
async function runExport({ t, owner }: Setup) {
  const exportId = await owner.mutation(api.adminExport.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return exportId;
}

const download = (who: Setup["owner"] | Setup["t"], exportId: string) => who.fetch(`/admin/export?id=${encodeURIComponent(exportId)}`, { method: "GET" });

describe("the table lists", () => {
  it("puts every schema table in exactly one of EXPORTED_TABLES and EXCLUDED_TABLES", () => {
    const all = Object.keys(schema.tables).sort();
    const exported: string[] = [...EXPORTED_TABLES];
    const excluded = Object.keys(EXCLUDED_TABLES);
    expect(exported.filter((name) => excluded.includes(name))).toEqual([]);
    expect([...exported, ...excluded].sort()).toEqual(all);
    expect(new Set(exported).size).toBe(exported.length);
  });

  it("excludes every auth table, book text, operations, the exports and the e2e codes", () => {
    const auth = Object.keys(schema.tables).filter((name) => name.startsWith("auth"));
    expect(auth.length).toBeGreaterThanOrEqual(6);
    for (const name of [...auth, "lorekeeperChunks", "operations", "adminExports", "e2eCodes"]) {
      expect(Object.keys(EXCLUDED_TABLES)).toContain(name);
    }
  });

  it("redacts the campaign join code", () => {
    expect(REDACTED_FIELDS.campaigns).toContain("joinCode");
  });
});

describe("adminExport.start / status (owner only)", () => {
  it("refuses everyone but the owner on the server", async () => {
    const { t, other } = await setup();
    expect(errorCode(await fail(t.mutation(api.adminExport.start, {})))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(other.mutation(api.adminExport.start, {})))).toBe("FORBIDDEN");
    expect(errorCode(await fail(other.query(api.adminExport.status, {})))).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("adminExports").collect())).toEqual([]);
  });

  it("creates a pending row, audits it, and answers the same export while it is still building", async () => {
    const { t, ids, owner } = await setup();
    expect(await owner.query(api.adminExport.status, {})).toBeNull();
    const first = await owner.mutation(api.adminExport.start, {});
    expect(await owner.mutation(api.adminExport.start, {})).toBe(first);
    expect(await owner.query(api.adminExport.status, {})).toEqual({ exportId: first, status: "pending", createdAt: NOW, expiresAt: NOW + EXPORT_TTL_MS });
    const audit = await t.run((ctx) => ctx.db.query("adminAudit").collect());
    expect(audit).toMatchObject([{ action: "export.request", actorId: ids.owner, target: first }]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const done = await owner.query(api.adminExport.status, {});
    expect(done?.status).toBe("ready");
    // Once ready, another click starts a new export.
    expect(await owner.mutation(api.adminExport.start, {})).not.toBe(first);
  });

  it("answers null once the newest export is older than the TTL", async () => {
    const s = await setup();
    await runExport(s);
    vi.setSystemTime(NOW + EXPORT_TTL_MS + 1);
    expect(await s.owner.query(api.adminExport.status, {})).toBeNull();
  });
});

describe("the build", () => {
  it("writes one JSON file with every exported table, paged, and none of the excluded data", async () => {
    const s = await setup();
    const { t, ids } = s;
    const campaignId = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", {
        ownerId: ids.owner,
        frameId: "witherwild",
        name: "Export Me",
        nameKey: "export me",
        tier: 1,
        level: 1,
        createdAt: NOW,
        lastOpenedAt: NOW,
        joinCode: "SECRETJOIN",
      });
      // More rows than one page, so the build has to follow the cursor.
      for (let i = 0; i < PAGE_ROWS + 15; i++) {
        await ctx.db.insert("adminAudit", { at: NOW - i, actorId: ids.owner, action: "cap.set", field: "campaignsApp", from: i, to: i + 1 });
      }
      await ctx.db.insert("authAccounts", { userId: ids.owner, provider: "password", providerAccountId: OWNER, secret: "PASSWORD-HASH-XYZ" });
      const book = await ctx.db.insert("lorekeeperBooks", { key: "core", title: "Core", subtitle: "", cover: "c", pages: 1, chunkCount: 1, ingestedAt: NOW, schemaVersion: 1 });
      await ctx.db.insert("lorekeeperChunks", { bookId: book, page: 1, section: "S", text: "BOOK-TEXT-SECRET", ord: 0 });
      return campaignId;
    });
    const exportId = await runExport(s);
    const row = await t.run((ctx) => ctx.db.get("adminExports", exportId));
    expect(row?.status).toBe("ready");
    expect(row?.fileId).toBeDefined();
    const text = await t.run(async (ctx) => (await ctx.storage.get(row!.fileId!))!.text());
    const file = JSON.parse(text) as { format: string; schemaVersion: number; tables: Record<string, Record<string, unknown>[]>; excludedTables: string[] };
    expect(file.format).toBe("dualityheart-export");
    expect(file.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(Object.keys(file.tables)).toEqual([...EXPORTED_TABLES]);
    expect(file.excludedTables).toEqual(Object.keys(EXCLUDED_TABLES));
    expect(file.tables.users.map((u) => u.email).sort()).toEqual([OTHER, OWNER]);
    expect(file.tables.adminAudit.filter((a) => a.action === "cap.set")).toHaveLength(PAGE_ROWS + 15);
    for (const name of Object.keys(EXCLUDED_TABLES)) expect(file.tables[name]).toBeUndefined();
    expect(text).not.toContain("PASSWORD-HASH-XYZ");
    expect(text).not.toContain("BOOK-TEXT-SECRET");
    expect(file.tables.campaigns.map((c) => c._id)).toEqual([campaignId]);
    expect(file.tables.campaigns[0]).toMatchObject({ name: "Export Me" });
    expect(file.tables.campaigns[0]).not.toHaveProperty("joinCode");
    expect(text).not.toContain("SECRETJOIN");
  });

  it("marks the export failed when the build throws", async () => {
    const { t, ids } = await setup();
    const exportId = await t.run((ctx) => ctx.db.insert("adminExports", { requestedBy: ids.owner, status: "pending", createdAt: NOW }));
    await t.mutation(internal.adminExport.fail, { exportId });
    expect((await t.run((ctx) => ctx.db.get("adminExports", exportId)))?.status).toBe("failed");
  });

  it("deletes the file when the row expired while the build ran", async () => {
    const { t, ids } = await setup();
    const { exportId, fileId } = await t.run(async (ctx) => {
      const exportId = await ctx.db.insert("adminExports", { requestedBy: ids.owner, status: "pending", createdAt: NOW });
      const fileId = await ctx.storage.store(new Blob(["{}"]));
      await ctx.db.delete("adminExports", exportId);
      return { exportId, fileId };
    });
    await t.mutation(internal.adminExport.finish, { exportId, fileId });
    expect(await t.run((ctx) => ctx.db.system.get("_storage", fileId))).toBeNull();
  });
});

describe("GET /admin/export (authenticated download)", () => {
  it("gives the owner the file as an uncached attachment", async () => {
    const s = await setup();
    const exportId = await runExport(s);
    const res = await download(s.owner, exportId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="dualityheart-export-2026-11-04.json"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const file = (await res.json()) as { tables: Record<string, unknown[]> };
    expect(Object.keys(file.tables)).toEqual([...EXPORTED_TABLES]);
  });

  it("refuses signed out (401) and anyone but the owner (403), with no file bytes", async () => {
    const s = await setup();
    const exportId = await runExport(s);
    const anon = await download(s.t, exportId);
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ code: "UNAUTHENTICATED" });
    const other = await download(s.other, exportId);
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ code: "FORBIDDEN" });
  });

  it("answers 404 for a malformed id, a pending export and an expired one", async () => {
    const s = await setup();
    expect((await download(s.owner, "not-an-id")).status).toBe(404);
    const pending = await s.owner.mutation(api.adminExport.start, {});
    expect((await download(s.owner, pending)).status).toBe(404);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await download(s.owner, pending)).status).toBe(200);
    // Older than the TTL: refused even before the hourly cron deletes it.
    vi.setSystemTime(NOW + EXPORT_TTL_MS + 1);
    expect((await download(s.owner, pending)).status).toBe(404);
  });

  it("stops working for a former owner at once", async () => {
    const s = await setup();
    const exportId = await runExport(s);
    await s.t.run(async (ctx) => {
      const row = await ctx.db.query("appConfig").withIndex("by_key", (q) => q.eq("key", "app")).unique();
      await ctx.db.patch("appConfig", row!._id, { ownerId: s.ids.other });
    });
    expect((await download(s.owner, exportId)).status).toBe(403);
    expect((await download(s.other, exportId)).status).toBe(200);
  });
});
