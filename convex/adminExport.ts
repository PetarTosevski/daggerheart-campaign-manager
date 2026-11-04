import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { env, httpAction, internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { EXPORT_TTL_MS } from "./adminRetention";
import { recordAdminChange } from "./lib/adminAudit";
import { isAppOwner } from "./lib/appOwner";
import { getUser } from "./lib/auth";
import { appOwnerMutation, appOwnerQuery } from "./lib/functions";
import { adminExportStatusValidator } from "./lib/validators/admin";

/**
 * App admin, "Export everything as JSON" (config AD11, Q30 a; docs/tasks/TASK-CONFIG-AD11.md). Owner only.
 *
 * - `start` (appOwnerMutation) writes a pending `adminExports` row and schedules `build`, an internal action that
 *   pages every table in `EXPORTED_TABLES` through `page` (an internal query, `PAGE_ROWS` rows and at most
 *   `PAGE_BYTES` read per call, so no function reads a whole growing table), writes one JSON file to storage and
 *   records its `fileId`. Audited (`export.request`).
 * - `status` (appOwnerQuery) answers the newest export that has not expired, or null.
 * - The file is downloaded only through `GET /admin/export?id=...` (`download`, routed in `http.ts`): the request's
 *   bearer token must be the app owner's, checked again on every download. Never a `getUrl` link (CF18).
 * - The row and the file expire after `ADMIN_EXPORT_TTL_MINUTES` (`adminRetention.expireExports`, hourly); the
 *   download refuses an older export even before the cron deletes it.
 *
 * Never exported (`EXCLUDED_TABLES`): every Convex Auth table (password hashes, sessions, refresh tokens, codes),
 * book text (`lorekeeperChunks`), idempotency records with their stored results (`operations`), the exports
 * themselves and the e2e codes. Rate-limiter state lives in its component and is not reachable from here. Storage
 * files are referenced by id only: the export holds no file bytes. `REDACTED_FIELDS` drops credentials that sit on
 * otherwise exported rows (a campaign's join code).
 */

/** Rows per `page` call, and the bytes one call may read (well under the 16 MiB transaction read limit). */
export const PAGE_ROWS = 200;
export const PAGE_BYTES = 4 * 1024 * 1024;

/** The export file's format marker and version (rule 7: a JSON blob carries its schema version). */
export const EXPORT_FORMAT = "dualityheart-export";
export const EXPORT_SCHEMA_VERSION = 1;

/**
 * Tables never exported, with the reason. Every table in the schema is in exactly one of `EXCLUDED_TABLES` and
 * `EXPORTED_TABLES` (tests/convex/admin-export.test.ts), so a new table needs a decision before it ships.
 */
export const EXCLUDED_TABLES = {
  authAccounts: "auth secrets: password hashes and provider account ids",
  authSessions: "auth sessions",
  authRefreshTokens: "auth refresh tokens",
  authVerificationCodes: "auth sign-in and reset codes",
  authVerifiers: "auth PKCE verifiers",
  authRateLimits: "auth rate-limit state",
  lorekeeperChunks: "book text",
  operations: "idempotency records and their stored results",
  adminExports: "the temporary export files themselves",
  e2eCodes: "e2e sign-in codes (local test backend only)",
} as const satisfies Partial<Record<TableNames, string>>;

/** Every table the export holds, in file order. */
export const EXPORTED_TABLES = [
  "users",
  "appConfig",
  "appStatus",
  "featureSwitches",
  "appTesters",
  "adminAudit",
  "lorekeeperCampaignLimits",
  "lorekeeperLimitRequests",
  "campaigns",
  "campaignOpens",
  "campaignMembers",
  "campaignInvites",
  "campaignState",
  "settings",
  "userPreferences",
  "userUiState",
  "userDrafts",
  "handFolds",
  "campaignTime",
  "characters",
  "characterExtras",
  "frameTrackers",
  "countdowns",
  "countdownTicks",
  "encounters",
  "encounterAdversaries",
  "customAdversaries",
  "combatAreas",
  "combatRequests",
  "combatSpotlight",
  "combatSeen",
  "combatMaps",
  "combatMapObjects",
  "combatMapCells",
  "combatTokens",
  "combatExplored",
  "codexEntries",
  "codexEntryText",
  "codexCounters",
  "maps",
  "mapTokens",
  "mapHexes",
  "mapTerrain",
  "history",
  "sessions",
  "sessionPrep",
  "sessionLog",
  "sessionSpotlights",
  "sessionLogOverrides",
  "sessionCharacterStats",
  "journals",
  "journalPages",
  "journalPageRecipients",
  "journalEntries",
  "rests",
  "restChoices",
  "actionLog",
  "files",
  "uploadNotices",
  "grants",
  "playFor",
  "spritePacks",
  "spritePackSprites",
  "lorekeeperBooks",
  "lorekeeperLibrary",
  "lorekeeperConversations",
  "lorekeeperMessages",
  "lorekeeperRulings",
  "lorekeeperAsks",
  "lorekeeperUsage",
] as const satisfies readonly TableNames[];

export type ExportedTable = (typeof EXPORTED_TABLES)[number];

/** Credentials on exported rows, dropped from every row of that table. */
export const REDACTED_FIELDS: Partial<Record<ExportedTable, readonly string[]>> = {
  campaigns: ["joinCode"],
};

const exportedTableValidator = v.union(...EXPORTED_TABLES.map((t) => v.literal(t)));

/** A stored row without its redacted fields. */
function redact(table: ExportedTable, row: Record<string, unknown>): Record<string, unknown> {
  const drop = REDACTED_FIELDS[table];
  if (drop === undefined) return row;
  return Object.fromEntries(Object.entries(row).filter(([field]) => !drop.includes(field)));
}

/** The newest export younger than the TTL, or null. */
async function latestLive(ctx: QueryCtx): Promise<Doc<"adminExports"> | null> {
  return ctx.db
    .query("adminExports")
    .withIndex("by_createdAt", (q) => q.gte("createdAt", Date.now() - EXPORT_TTL_MS))
    .order("desc")
    .first();
}

// ---------------------------------------------------------------- public (owner only)

/**
 * Starts an export. While one is still being built, answers that one instead of starting another (so repeated clicks
 * cost nothing). Audited as `export.request` with the export's id.
 */
export const start = appOwnerMutation({
  args: {},
  returns: v.id("adminExports"),
  handler: async (ctx) => {
    const latest = await latestLive(ctx);
    if (latest !== null && latest.status === "pending") return latest._id;
    const exportId = await ctx.db.insert("adminExports", { requestedBy: ctx.user._id, status: "pending", createdAt: Date.now() });
    await recordAdminChange(ctx, ctx.user._id, { action: "export.request", target: exportId });
    await ctx.scheduler.runAfter(0, internal.adminExport.build, { exportId });
    return exportId;
  },
});

/** The newest export that has not expired: its id, status and times; null when there is none. */
export const status = appOwnerQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      exportId: v.id("adminExports"),
      status: adminExportStatusValidator,
      createdAt: v.number(),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const latest = await latestLive(ctx);
    if (latest === null) return null;
    return { exportId: latest._id, status: latest.status, createdAt: latest.createdAt, expiresAt: latest.createdAt + EXPORT_TTL_MS };
  },
});

// ---------------------------------------------------------------- the build (internal)

/** One page of one exported table, redacted. Reads at most `PAGE_ROWS` rows and `PAGE_BYTES` bytes. */
export const page = internalQuery({
  args: { table: exportedTableValidator, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    const result = await ctx.db
      .query(table)
      .paginate({ cursor, numItems: PAGE_ROWS, maximumBytesRead: PAGE_BYTES });
    return {
      rows: result.page.map((row) => redact(table, row as unknown as Record<string, unknown>)),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/** Marks an export ready with its file. When the row is gone (expired meanwhile), the file is deleted instead. */
export const finish = internalMutation({
  args: { exportId: v.id("adminExports"), fileId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { exportId, fileId }) => {
    const row = await ctx.db.get("adminExports", exportId);
    if (row === null) {
      await ctx.storage.delete(fileId);
      return null;
    }
    await ctx.db.patch("adminExports", exportId, { status: "ready", fileId });
    return null;
  },
});

/** Marks an export failed (the row stays until it expires, so the owner sees the failure). */
export const fail = internalMutation({
  args: { exportId: v.id("adminExports") },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    const row = await ctx.db.get("adminExports", exportId);
    if (row !== null && row.status === "pending") await ctx.db.patch("adminExports", exportId, { status: "failed" });
    return null;
  },
});

/** Pages every exported table into one JSON file in storage, then records it. Any error marks the export failed. */
export const build = internalAction({
  args: { exportId: v.id("adminExports") },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    try {
      const parts: string[] = [
        `{"format":${JSON.stringify(EXPORT_FORMAT)},"schemaVersion":${EXPORT_SCHEMA_VERSION},`,
        `"exportedAt":${JSON.stringify(new Date().toISOString())},`,
        `"excludedTables":${JSON.stringify(Object.keys(EXCLUDED_TABLES))},`,
        `"redactedFields":${JSON.stringify(REDACTED_FIELDS)},"tables":{`,
      ];
      for (const [index, table] of EXPORTED_TABLES.entries()) {
        parts.push(`${index === 0 ? "" : ","}${JSON.stringify(table)}:[`);
        let cursor: string | null = null;
        let first = true;
        for (;;) {
          const result: { rows: Record<string, unknown>[]; continueCursor: string; isDone: boolean } = await ctx.runQuery(
            internal.adminExport.page,
            { table, cursor },
          );
          for (const row of result.rows) {
            parts.push(`${first ? "" : ","}${JSON.stringify(row)}`);
            first = false;
          }
          if (result.isDone) break;
          cursor = result.continueCursor;
        }
        parts.push("]");
      }
      parts.push("}}");
      const fileId = await ctx.storage.store(new Blob(parts, { type: "application/json" }));
      await ctx.runMutation(internal.adminExport.finish, { exportId, fileId });
    } catch (error) {
      await ctx.runMutation(internal.adminExport.fail, { exportId });
      throw error;
    }
    return null;
  },
});

// ---------------------------------------------------------------- the download (http)

type Downloadable =
  | { ok: true; fileId: Id<"_storage">; createdAt: number }
  | { ok: false; status: 401 | 403 | 404; code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" };

/**
 * Whether the caller (the bearer token the HTTP action carries) may download this export: the app owner
 * (`isAppOwner`), the export ready and younger than the TTL. A malformed id is NOT_FOUND.
 */
export const downloadable = internalQuery({
  args: { exportId: v.string() },
  handler: async (ctx, { exportId }): Promise<Downloadable> => {
    const user = await getUser(ctx).catch(() => "deleted" as const);
    if (user === null) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
    if (user === "deleted" || !(await isAppOwner(ctx, user))) return { ok: false, status: 403, code: "FORBIDDEN" };
    const id = ctx.db.normalizeId("adminExports", exportId);
    const row = id === null ? null : await ctx.db.get("adminExports", id);
    if (row === null || row.status !== "ready" || row.fileId === undefined || row.createdAt < Date.now() - EXPORT_TTL_MS) {
      return { ok: false, status: 404, code: "NOT_FOUND" };
    }
    return { ok: true, fileId: row.fileId, createdAt: row.createdAt };
  },
});

/** CORS for the app's own origin (`SITE_URL`) only; no header at all when it is unset. */
function corsHeaders(): Record<string, string> {
  const origin = env.SITE_URL?.trim().replace(/\/+$/, "");
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Expose-Headers": "Content-Disposition",
    Vary: "Origin",
  };
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** `GET /admin/export?id=<exportId>` with `Authorization: Bearer <Convex Auth token>`: the owner's file, as an attachment. */
export const download = httpAction(async (ctx, request) => {
  const exportId = new URL(request.url).searchParams.get("id") ?? "";
  const found = await ctx.runQuery(internal.adminExport.downloadable, { exportId });
  const headers = { ...corsHeaders(), ...NO_STORE };
  if (!found.ok) {
    return new Response(JSON.stringify({ code: found.code }), { status: found.status, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const blob = await ctx.storage.get(found.fileId);
  if (blob === null) {
    return new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404, headers: { ...headers, "Content-Type": "application/json" } });
  }
  const day = new Date(found.createdAt).toISOString().slice(0, 10);
  return new Response(blob, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="dualityheart-export-${day}.json"`,
    },
  });
});

/** The CORS preflight for `download` (the browser sends one because of the Authorization header). */
export const downloadPreflight = httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() }));
