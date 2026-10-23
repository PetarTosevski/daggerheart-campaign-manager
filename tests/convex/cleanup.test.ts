import type { GenericValidator } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id, TableNames } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { ACTION_LOG_STRIP_BATCH, BATCH } from "../../convex/cleanup";
import { deleteSessionRows } from "../../convex/lib/sessions";
import { errorCode, GM_EMAIL, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-18T12:00:00Z").getTime();

type Test = ReturnType<typeof makeTest>;
type NewDoc<T extends TableNames> = Doc<T> extends infer D ? (D extends unknown ? Omit<D, "_id" | "_creationTime"> : never) : never;

/** Whether a table's validator (an object, or a union of objects) has the field. */
function hasField(validator: GenericValidator, field: string): boolean {
  if (validator.kind === "object") return field in validator.fields;
  if (validator.kind === "union") return validator.members.some((m) => hasField(m, field));
  return false;
}

const tables = Object.entries(schema.tables) as [TableNames, { validator: GenericValidator }][];
/** Every table whose rows belong to a campaign through a `campaignId` field. */
const campaignTables = tables.filter(([, t]) => hasField(t.validator, "campaignId")).map(([name]) => name);

async function blob(ctx: { storage: { store(blob: Blob): Promise<Id<"_storage">> } }): Promise<Id<"_storage">> {
  return ctx.storage.store(new Blob(["x"], { type: "image/png" }));
}

/**
 * A campaign with a row in every campaign-scoped table (plus grants and a
 * combat map's children, which reach it only through ids), `extraHistory` more
 * history rows, and its blobs. Returns the tables it wrote and the blobs.
 */
async function seedCampaign(t: Test, userId: Id<"users">, deletedAt: number | undefined, extraHistory = 0) {
  return t.run(async (ctx) => {
    const touched = new Set<TableNames>();
    const ins = <T extends TableNames>(table: T, doc: NewDoc<T>) => {
      touched.add(table);
      return ctx.db.insert(table, doc as never) as Promise<Id<T>>;
    };
    const now = Date.now();
    const campaignId = await ins("campaigns", {
      ownerId: userId,
      frameId: "witherwild",
      name: `C${now}${Math.random()}`,
      nameKey: `c${now}${Math.random()}`,
      tier: 1,
      level: 1,
      createdAt: now,
      lastOpenedAt: now,
      deletedAt,
    });
    const c = campaignId;
    const blobs = {
      file: await blob(ctx),
      codexImage: await blob(ctx),
      portrait: await blob(ctx),
      combatImage: await blob(ctx),
      sprite: await blob(ctx),
    };
    const characterId = await ins("characters", { campaignId: c, ownerId: userId, createdBy: userId, status: "active", sheet: {}, createdAt: now, updatedAt: now });
    const entryId = await ins("codexEntries", { campaignId: c, kind: "character", data: {}, createdAt: now, updatedAt: now });
    await ins("campaignOpens", { userId, campaignId: c, lastOpenedAt: now });
    await ins("campaignMembers", { campaignId: c, userId, joinedAt: now, lastOpenedAt: now });
    await ins("campaignInvites", { campaignId: c, email: "p@example.com", invitedBy: userId, createdAt: now });
    await ins("campaignState", { campaignId: c, fear: 0 });
    const countdownId = await ins("countdowns", {
      campaignId: c,
      name: "Doom",
      description: "",
      category: "threat",
      startingValue: 4,
      currentValue: 4,
      status: "active",
      consequence: "",
      createdAt: now,
    });
    await ins("campaignTime", { campaignId: c, week: 1, cycle: "DAY", cycleDay: 1 });
    for (let i = 0; i <= extraHistory; i++) {
      await ins("history", { campaignId: c, action: "adjust", by: null, at: now + i, kind: "fear", before: 0, after: 1 });
    }
    await ins("history", {
      campaignId: c,
      action: "create",
      by: userId,
      at: now,
      kind: "countdown",
      countdownId,
      before: null,
      after: { currentValue: 4, status: "active" },
    });
    const rollId = await ins("actionLog", { campaignId: c, characterId, actorId: userId, kind: "roll", visibility: "public", summary: "rolled", undoable: true, at: now });
    const tickState = { currentValue: 4, startingValue: 4, status: "active" as const, triggerCount: 0 };
    await ins("countdownTicks", { campaignId: c, countdownId, entryId: rollId, source: "roll", amount: 1, before: tickState, after: { ...tickState, currentValue: 3 }, at: now });
    const restId = await ins("rests", { campaignId: c, kind: "short", status: "open", startedBy: userId, startedAt: now });
    await ins("restChoices", { campaignId: c, restId, characterId, moves: [{ move: "clearStress" }], updatedBy: userId, updatedAt: now });
    await ins("frameTrackers", { campaignId: c, key: "doom", data: {}, updatedAt: now });
    await ins("characterExtras", {
      campaignId: c,
      characterId,
      schemaVersion: 1,
      updatedAt: now,
      extra: "castleHigh",
      data: { skyshard: { name: "S", description: "" } },
    });
    await ins("maps", { campaignId: c, data: {}, updatedAt: now });
    await ins("mapTokens", { campaignId: c, tokenId: 1, type: "pin", x: 0, y: 0, name: "", notes: "", hidden: false, location: false });
    await ins("mapHexes", { campaignId: c, q: 0, r: 0, explored: true });
    await ins("mapTerrain", { campaignId: c, tile: 0, cells: "" });
    await ins("codexEntryText", { campaignId: c, entryId, pdesc: "", gmn: "" });
    await ins("codexCounters", { campaignId: c, entries: 1, seeded: true });
    const customId = await ins("customAdversaries", {
      campaignId: c,
      name: "Bog Hag",
      tier: 1,
      type: "Solo",
      description: "",
      motives: "",
      difficulty: 12,
      thresholds: { major: 7, severe: 12 },
      hp: 6,
      stress: 3,
      attack: { modifier: 2, name: "Claws", range: "Melee", damage: "1d8+2 phy" },
      experiences: [],
      features: [{ name: "Curse", kind: "action", text: "", fearCost: 1 }],
      createdAt: now,
      updatedAt: now,
    });
    const encounterId = await ins("encounters", { campaignId: c, name: "Ambush", status: "running", pcs: 4, adjustments: ["hard"], gmTurn: 1, createdAt: now, updatedAt: now });
    const instance = { campaignId: c, encounterId, order: 0, summoned: false, hp: 0, stress: 0, defeated: false, conditions: [], tags: [], spotlights: 0, spotlightTurn: 1, updatedAt: now };
    const stats = { difficulty: 12, major: 7, severe: 12, hpMax: 6, stressMax: 3 };
    const instanceId = await ins("encounterAdversaries", { ...instance, source: { kind: "custom", customId }, label: "Bog Hag", stats });
    await ins("encounterAdversaries", {
      ...instance,
      order: 1,
      source: { kind: "srd", adversaryId: "jagged-knife-lackey" },
      label: "Jagged Knife Lackey",
      minionCount: 4,
      stats: { difficulty: 9, major: null, severe: null, hpMax: 1, stressMax: 1 },
      conditions: ["hidden"],
    });
    // A combat map with one of each child row and its image (D9).
    const combatMapId = await ins("combatMaps", {
      campaignId: c,
      name: "Bandit camp",
      live: true,
      source: "image",
      w: 30,
      h: 20,
      base: "grass",
      areas: [{ terrain: "water", shape: "ellipse", x: 5, y: 5, rx: 2, ry: 1.5 }],
      seed: 7,
      schemaVersion: 1,
      updatedAt: now,
    });
    await ins("combatMapObjects", { mapId: combatMapId, kind: "campfire", x: 4, y: 4, r: 1, rot: 0, lit: false });
    await ins("combatMapCells", { mapId: combatMapId, layer: "block", tile: 0, cells: "#" });
    await ins("combatTokens", {
      campaignId: c,
      mapId: combatMapId,
      ref: { kind: "pc", characterId },
      side: "pc",
      x: 1,
      y: 1,
      size: 1,
      face: 0,
      light: "torch",
      revealedTo: [],
    });
    await ins("combatExplored", { mapId: combatMapId, characterId, bits: "", updatedAt: now });
    // A reaction window still open on the map (combat-actions AA0).
    await ins("combatRequests", combatRequest(c, userId, characterId, instanceId, { encounterId, mapId: combatMapId, at: now }));
    // A session with its prep (linking the encounter), a log line and a spotlight count (D10).
    const sessionId = await ins("sessions", { campaignId: c, n: 1, title: "The Bridge at Dawn", status: "live", startedAt: now, createdAt: now, updatedAt: now });
    await ins("sessionPrep", { campaignId: c, sessionId, scenes: [{ id: "s1", type: "combat", text: "Ambush" }], hooks: "", encounterId, updatedAt: now });
    await ins("sessionLog", { campaignId: c, sessionId, at: now, text: "Session started.", by: userId, auto: true });
    await ins("sessionSpotlights", { campaignId: c, sessionId, characterId, count: 2 });
    await ins("files", { storageId: blobs.combatImage, campaignId: c, uploadedBy: userId, kind: "combatMap", refId: combatMapId, createdAt: now });
    // A GM sprite pack with one uploaded sprite and its image (sprite packs P0); the map uses it.
    const packId = await ins("spritePacks", { campaignId: c, name: "Standing stones", extends: "forest", createdBy: userId, createdAt: now, updatedAt: now });
    const spriteFileId = await ins("files", { storageId: blobs.sprite, campaignId: c, uploadedBy: userId, kind: "sprite", refId: "pending", createdAt: now });
    const spriteId = await ins("spritePackSprites", {
      campaignId: c,
      packId,
      fileId: spriteFileId,
      name: "Standing stone",
      slug: "standing-stone",
      category: "object",
      w: 1,
      h: 1,
      sight: "block",
      light: "none",
      height: "tall",
      footprint: "circle",
      classicKind: "statue",
      px: { w: 160, h: 160 },
      order: 0,
      createdAt: now,
    });
    await ctx.db.patch("files", spriteFileId, { refId: spriteId });
    await ctx.db.patch("combatMaps", combatMapId, { style: "sprites", setting: { pack: packId }, settingPicked: true, texturePalette: [{ uploaded: spriteId }] });
    await ins("combatMapObjects", { mapId: combatMapId, kind: "statue", x: 6, y: 6, r: 0.5, rot: 0, sprite: { uploaded: spriteId } });
    // A journal with a shared page, its chosen reader and an entry, plus a torn-out page (D11).
    const journalId = await ins("journals", { campaignId: c, userId, characterId, pageCount: 1, entryCount: 1, openCount: 1, createdAt: now, updatedAt: now });
    const page = { campaignId: c, journalId, ownerId: userId, kind: "log" as const, title: "Session 1", tape: 0, entryCount: 1, openCount: 1, createdAt: now, updatedAt: now };
    const pageId = await ins("journalPages", { ...page, visibility: "chosen", sessionId });
    await ins("journalPages", { ...page, title: "Torn", visibility: "gm", binnedAt: now, binnedBy: userId, entryCount: 0, openCount: 0 });
    await ins("journalPageRecipients", { campaignId: c, pageId, userId, addedAt: now });
    await ins("journalEntries", { campaignId: c, journalId, pageId, authorId: userId, kind: "task", state: "open", star: false, text: "Find the well", order: 0, open: true, createdAt: now, updatedAt: now });
    // A Lorekeeper conversation with a question and its answer, a ruling pinned from it, an Ask-the-GM, a book
    // switch and the campaign's usage counter (D13). The book itself is per deployment and stays.
    const bookId = await ins("lorekeeperBooks", { key: `core-${now}-${Math.random()}`, title: "Mini Manual", subtitle: "Rules", cover: "core", pages: 12, chunkCount: 0, ingestedAt: now, schemaVersion: 1 });
    await ins("lorekeeperLibrary", { campaignId: c, bookId, enabled: false, updatedAt: now });
    const conversationId = await ins("lorekeeperConversations", { campaignId: c, userId, title: "Critical hits?", visibility: "campaign", webSearch: true, messageCount: 2, lastAt: now, createdAt: now });
    const message = { conversationId, campaignId: c, userId, createdAt: now, updatedAt: now };
    await ins("lorekeeperMessages", { ...message, role: "question", status: "done", text: "Critical hits?" });
    const answerId = await ins("lorekeeperMessages", {
      ...message,
      role: "answer",
      status: "done",
      text: "They always succeed.",
      parts: { verdict: "rules", quotes: [{ kind: "book", text: "A critical hit always succeeds.", bookId, page: 3, section: "Core Mechanics" }] },
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, webSearches: 0, costMicros: 10 },
      model: "claude-sonnet-5-5",
      reserved: { micros: 80_000, day: "2026-10-18", month: "2026-10" },
    });
    const rulingId = await ins("lorekeeperRulings", { campaignId: c, title: "Crits", text: "Max damage plus a roll.", sessionId, fromMessageId: answerId, pinnedBy: userId, pinnedAt: now, updatedAt: now });
    await ins("lorekeeperAsks", { campaignId: c, messageId: answerId, askedBy: userId, askedAt: now, resolvedAt: now, resolution: "pinned", rulingId });
    await ins("lorekeeperUsage", { kind: "campaign", campaignId: c, period: "2026-10", questions: 1, costMicros: 10, updatedAt: now });
    await ins("files", { storageId: blobs.file, campaignId: c, uploadedBy: userId, kind: "map", refId: c, createdAt: now });
    await ins("files", { storageId: blobs.codexImage, campaignId: c, uploadedBy: userId, kind: "codexImage", refId: entryId, createdAt: now });
    await ins("files", { storageId: blobs.portrait, campaignId: c, uploadedBy: userId, kind: "portrait", refId: characterId, createdAt: now });
    await ins("operations", {
      scopeKey: `campaign:${c}`,
      idempotencyKey: "k",
      kind: "fear_set",
      requestHash: "h",
      result: null,
      campaignId: c,
      createdBy: userId,
      createdAt: now,
    });
    const grant = { principalKind: "user" as const, principalId: userId, permission: "view" as const, createdBy: userId, createdAt: now };
    await ins("grants", { ...grant, resourceType: "campaign", resourceId: c });
    await ins("grants", { ...grant, resourceType: "map", resourceId: c });
    await ins("grants", { ...grant, resourceType: "codexEntry", resourceId: entryId });
    await ins("grants", { ...grant, resourceType: "character", resourceId: characterId });
    await ins("grants", { ...grant, resourceType: "campaign", resourceId: "elsewhere", principalKind: "campaign", principalId: c });
    return { campaignId, characterId, entryId, combatMapId, sessionId, encounterId, instanceId, blobs: Object.values(blobs), touched: [...touched] };
  });
}

/** An `incomingHit` combat request (plan combat-actions AA0), open unless `status` says otherwise. */
function combatRequest(
  campaignId: Id<"campaigns">,
  userId: Id<"users">,
  characterId: Id<"characters">,
  instanceId: Id<"encounterAdversaries">,
  o: {
    at: number;
    status?: "open" | "resolved" | "declined";
    resolvedAt?: number;
    encounterId?: Id<"encounters">;
    mapId?: Id<"combatMaps">;
  },
): NewDoc<"combatRequests"> {
  return {
    campaignId,
    encounterId: o.encounterId,
    mapId: o.mapId,
    kind: "incomingHit",
    status: o.status ?? "open",
    createdBy: userId,
    createdAt: o.at,
    payload: {
      schemaVersion: 1,
      kind: "incomingHit",
      attacker: { instanceId, label: "Bog Hag" },
      targetCharacterId: characterId,
      damage: 9,
      damageType: "physical",
      direct: false,
      critical: false,
      groupId: `g${o.at}`,
      responders: [{ characterId, role: "target", cardIds: [] }],
    },
    responses: [],
    resolvedAt: o.resolvedAt,
  };
}

type Seeded = Awaited<ReturnType<typeof seedCampaign>>;

/** Everything left that belongs to the seeded campaign: rows per table and blobs still stored. */
async function leftovers(t: Test, s: Seeded) {
  return t.run(async (ctx) => {
    const rows: Record<string, number> = {};
    const ids = new Set<string>([s.campaignId, s.characterId, s.entryId]);
    for (const [name] of tables) {
      // Test-only full scan: the point is to look at every row of every table.
      const all = (await ctx.db.query(name).collect()) as Record<string, unknown>[];
      const mine = all.filter(
        (row) =>
          row.campaignId === s.campaignId ||
          (name === "campaigns" && row._id === s.campaignId) ||
          (name === "grants" && (ids.has(row.resourceId as string) || row.principalId === s.campaignId)) ||
          // Combat map children have no campaignId; they belong to the campaign through their map.
          row.mapId === s.combatMapId,
      );
      if (mine.length > 0) rows[name] = mine.length;
    }
    const blobs = [];
    for (const id of s.blobs) if ((await ctx.db.system.get("_storage", id)) !== null) blobs.push(id);
    return { rows, blobs };
  });
}

describe("cleanup crons", () => {
  useAllowlist();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function user(t: Test) {
    return t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL, emailVerificationTime: 1 }));
  }

  it("expires operations older than 7 days, in batches, and keeps newer ones", async () => {
    const t = makeTest();
    const userId = await user(t);
    const gm = t.withIdentity({ subject: `${userId}|s` });
    // A real keyed mutation records an operation now; it is 8 days old after the jump.
    await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Old", idempotencyKey: key() });
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 20; i++) {
        await ctx.db.insert("operations", {
          scopeKey: `owner:${userId}`,
          idempotencyKey: `old-${i}`,
          kind: "x",
          requestHash: "h",
          result: null,
          createdBy: userId,
          createdAt: NOW - 8 * DAY,
        });
      }
    });
    vi.setSystemTime(NOW + 8 * DAY);
    const recentKey = key();
    await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "New", idempotencyKey: recentKey });
    await t.run(async (ctx) => {
      await ctx.db.insert("operations", {
        scopeKey: `owner:${userId}`,
        idempotencyKey: "six-days",
        kind: "x",
        requestHash: "h",
        result: null,
        createdBy: userId,
        createdAt: NOW + 2 * DAY,
      });
    });

    await t.mutation(internal.cleanup.expireOperations, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const left = await t.run((ctx) => ctx.db.query("operations").collect());
    expect(left.map((o) => o.idempotencyKey).sort()).toEqual([recentKey, "six-days"].sort());
  });

  it("covers every campaign-scoped table in the schema", async () => {
    const t = makeTest();
    const s = await seedCampaign(t, await user(t), undefined);
    // A table added with a campaignId field must be seeded here and purged by convex/cleanup.ts.
    expect(campaignTables.filter((name) => !s.touched.includes(name))).toEqual([]);
    expect(campaignTables.length).toBeGreaterThan(20);
  });

  it("purges campaigns deleted over 30 days ago: no table keeps their rows and their blobs are gone", async () => {
    const t = makeTest();
    const userId = await user(t);
    const due = await seedCampaign(t, userId, NOW - 31 * DAY, BATCH + 100);
    const alsoDue = await seedCampaign(t, userId, NOW - 45 * DAY);
    const inUndoWindow = await seedCampaign(t, userId, NOW - 29 * DAY);
    const live = await seedCampaign(t, userId, undefined);
    const keptBefore = [await leftovers(t, inUndoWindow), await leftovers(t, live)];

    await t.mutation(internal.cleanup.purgeDeletedCampaigns, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await leftovers(t, due)).toEqual({ rows: {}, blobs: [] });
    expect(await leftovers(t, alsoDue)).toEqual({ rows: {}, blobs: [] });
    expect([await leftovers(t, inUndoWindow), await leftovers(t, live)]).toEqual(keptBefore);
    expect(keptBefore[0]!.rows.history).toBe(2);
  });

  it("purges a combat map with more children than one batch over several runs (D9)", async () => {
    const t = makeTest();
    const userId = await user(t);
    const due = await seedCampaign(t, userId, NOW - 31 * DAY);
    const live = await seedCampaign(t, userId, undefined);
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 50; i++) {
        await ctx.db.insert("combatMapObjects", { mapId: due.combatMapId, kind: "tree", x: i % 30, y: 3, r: 1.2, rot: 0 });
      }
    });
    const liveBefore = await leftovers(t, live);

    await t.mutation(internal.cleanup.purgeDeletedCampaigns, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await leftovers(t, due)).toEqual({ rows: {}, blobs: [] });
    expect(await leftovers(t, live)).toEqual(liveBefore);
    expect(liveBefore.rows).toMatchObject({ combatMaps: 1, combatTokens: 1, combatMapObjects: 2, combatMapCells: 1, combatExplored: 1 });
    expect(liveBefore.rows).toMatchObject({ sessions: 1, sessionPrep: 1, sessionLog: 1, sessionSpotlights: 1 });
  });

  it("purges a campaign's journals, pages (torn-out ones too), recipients and entries in batches (D11)", async () => {
    const t = makeTest();
    const userId = await user(t);
    const due = await seedCampaign(t, userId, NOW - 31 * DAY);
    const live = await seedCampaign(t, userId, undefined);
    await t.run(async (ctx) => {
      const page = await ctx.db.query("journalPages").withIndex("by_campaign_visibility_binned", (q) => q.eq("campaignId", due.campaignId).eq("visibility", "chosen")).first();
      for (let i = 0; i < BATCH + 30; i++) {
        await ctx.db.insert("journalEntries", { campaignId: due.campaignId, journalId: page!.journalId, pageId: page!._id, authorId: userId, kind: "note", state: "open", star: false, text: `Line ${i}`, order: i + 1, open: false, createdAt: NOW, updatedAt: NOW });
      }
    });
    const liveBefore = await leftovers(t, live);
    expect(liveBefore.rows).toMatchObject({ journals: 1, journalPages: 2, journalPageRecipients: 1, journalEntries: 1 });

    await t.mutation(internal.cleanup.purgeDeletedCampaigns, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await leftovers(t, due)).toEqual({ rows: {}, blobs: [] });
    expect(await leftovers(t, live)).toEqual(liveBefore);
  });

  it("purges a campaign's sprite packs, uploaded sprites and their sprite files with blobs (sprite packs P0)", async () => {
    const t = makeTest();
    const userId = await user(t);
    const due = await seedCampaign(t, userId, NOW - 31 * DAY);
    const live = await seedCampaign(t, userId, undefined);
    const liveBefore = await leftovers(t, live);
    expect(liveBefore.rows).toMatchObject({ spritePacks: 1, spritePackSprites: 1, files: 5 });

    await t.mutation(internal.cleanup.purgeDeletedCampaigns, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await leftovers(t, due)).toEqual({ rows: {}, blobs: [] });
    const spriteFiles = await t.run((ctx) => ctx.db.query("files").withIndex("by_campaign_kind", (q) => q.eq("campaignId", due.campaignId).eq("kind", "sprite")).collect());
    expect(spriteFiles).toEqual([]);
    expect(await leftovers(t, live)).toEqual(liveBefore);
  });

  it("deletes one session's prep, log and spotlight rows and leaves the linked encounter and other sessions (D10)", async () => {
    const t = makeTest();
    const userId = await user(t);
    const s = await seedCampaign(t, userId, undefined);
    const other = await t.run(async (ctx) => {
      const now = Date.now();
      const otherId = await ctx.db.insert("sessions", { campaignId: s.campaignId, n: 2, status: "planned", createdAt: now, updatedAt: now });
      await ctx.db.insert("sessionLog", { campaignId: s.campaignId, sessionId: otherId, at: now, text: "Keep me", by: userId, auto: false });
      for (let i = 0; i < 30; i++) {
        await ctx.db.insert("sessionLog", { campaignId: s.campaignId, sessionId: s.sessionId, at: now + i, text: `Line ${i}`, by: userId, auto: false });
      }
      return otherId;
    });

    const deleted = await t.run((ctx) => deleteSessionRows(ctx, s.sessionId));

    // One prep row, 31 log lines and one spotlight row.
    expect(deleted).toBe(33);
    const left = await leftovers(t, s);
    expect(left.rows).toMatchObject({ sessions: 2, sessionLog: 1, encounters: 1 });
    expect(left.rows.sessionPrep).toBeUndefined();
    expect(left.rows.sessionSpotlights).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get("encounters", s.encounterId))).not.toBeNull();
    const kept = await t.run((ctx) => ctx.db.query("sessionLog").withIndex("by_session_at", (q) => q.eq("sessionId", other)).collect());
    expect(kept.map((row) => row.text)).toEqual(["Keep me"]);
  });

  it("purges a campaign's Lorekeeper rows in batches and keeps books, other campaigns and per-user counters (D13)", async () => {
    const t = makeTest();
    const userId = await user(t);
    const due = await seedCampaign(t, userId, NOW - 31 * DAY);
    const live = await seedCampaign(t, userId, undefined);
    await t.run(async (ctx) => {
      const conversation = await ctx.db
        .query("lorekeeperConversations")
        .withIndex("by_campaign_user_last", (q) => q.eq("campaignId", due.campaignId))
        .first();
      for (let i = 0; i < BATCH + 40; i++) {
        await ctx.db.insert("lorekeeperMessages", { conversationId: conversation!._id, campaignId: due.campaignId, userId, role: "question", status: "done", text: `Q${i}`, createdAt: NOW, updatedAt: NOW });
      }
      await ctx.db.insert("lorekeeperUsage", { kind: "user", userId, period: "2026-10-18", questions: 3, costMicros: 30, updatedAt: NOW });
      await ctx.db.insert("lorekeeperUsage", { kind: "deployment", period: "2026-10", questions: 3, costMicros: 30, updatedAt: NOW });
    });
    const liveBefore = await leftovers(t, live);
    expect(liveBefore.rows).toMatchObject({ lorekeeperLibrary: 1, lorekeeperConversations: 1, lorekeeperMessages: 2, lorekeeperRulings: 1, lorekeeperAsks: 1, lorekeeperUsage: 1 });

    await t.mutation(internal.cleanup.purgeDeletedCampaigns, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await leftovers(t, due)).toEqual({ rows: {}, blobs: [] });
    expect(await leftovers(t, live)).toEqual(liveBefore);
    const kept = await t.run(async (ctx) => ({
      books: (await ctx.db.query("lorekeeperBooks").collect()).length,
      kinds: (await ctx.db.query("lorekeeperUsage").collect()).map((row) => row.kind).sort(),
    }));
    expect(kept).toEqual({ books: 2, kinds: ["campaign", "deployment", "user"] });
  });

  it("expires resolved and declined combat requests a day after resolvedAt, in batches, and keeps open or recent ones (AA0)", async () => {
    const t = makeTest();
    const userId = await user(t);
    const s = await seedCampaign(t, userId, undefined);
    const req = (o: Parameters<typeof combatRequest>[4]) => combatRequest(s.campaignId, userId, s.characterId, s.instanceId, o);
    const kept = await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 30; i++) {
        const status = i % 2 === 0 ? "resolved" : "declined";
        await ctx.db.insert("combatRequests", req({ at: NOW - 3 * DAY, status, resolvedAt: NOW - 2 * DAY + i }));
      }
      return [
        // Resolved 23 hours ago: still inside its day.
        await ctx.db.insert("combatRequests", req({ at: NOW - DAY, status: "resolved", resolvedAt: NOW - 23 * HOUR })),
        // Open for three days: an open row waits for its answer or the campaign purge.
        await ctx.db.insert("combatRequests", req({ at: NOW - 3 * DAY })),
      ];
    });

    await t.mutation(internal.cleanup.expireCombatRequests, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const left = await t.run((ctx) => ctx.db.query("combatRequests").collect());
    // The two kept rows plus the seeded campaign's own open request.
    expect(left).toHaveLength(3);
    expect(left.map((r) => r._id)).toEqual(expect.arrayContaining(kept));
    expect(left.filter((r) => r.status !== "open").map((r) => r._id)).toEqual([kept[0]]);
  });

  it("runs the combat-request expiry hourly (AA0)", async () => {
    const crons = (await import("../../convex/crons")).default as unknown as { crons: Record<string, { schedule: { type: string; cron?: string } }> };
    expect(crons.crons["expire combat requests"]?.schedule).toEqual({ type: "cron", cron: "11 * * * *" });
  });

  it("a purge not started by the sweep (the GM's Delete permanently) purges only its own campaign (F7)", async () => {
    const t = makeTest();
    const userId = await user(t);
    const chosen = await seedCampaign(t, userId, 1);
    const old = await seedCampaign(t, userId, NOW - 40 * DAY);
    const oldBefore = await leftovers(t, old);

    await t.mutation(internal.cleanup.purgeCampaign, { campaignId: chosen.campaignId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await leftovers(t, chosen)).toEqual({ rows: {}, blobs: [] });
    expect(await leftovers(t, old)).toEqual(oldBefore);
  });

  it("stops purging a campaign the GM restored", async () => {
    const t = makeTest();
    const userId = await user(t);
    const s = await seedCampaign(t, userId, NOW - 31 * DAY);
    const before = await leftovers(t, s);
    await t.run((ctx) => ctx.db.patch("campaigns", s.campaignId, { deletedAt: undefined }));

    await t.mutation(internal.cleanup.purgeCampaign, { campaignId: s.campaignId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await leftovers(t, s)).toEqual(before);
  });

  it("deletes unclaimed uploads older than 2 hours and keeps claimed or recent ones", async () => {
    const t = makeTest();
    const userId = await user(t);
    const s = await seedCampaign(t, userId, undefined);
    const old = await t.run(async (ctx) => ({ orphan: await blob(ctx) }));
    vi.setSystemTime(NOW + 3 * HOUR);
    const recent = await t.run(blob);

    await t.mutation(internal.cleanup.sweepOrphanUploads, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const exists = (id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
    expect(await exists(old.orphan)).toBe(false);
    expect(await exists(recent)).toBe(true);
    // Claimed by `files` rows, all older than 2 hours.
    for (const id of s.blobs) expect(await exists(id)).toBe(true);
  });

  it("runs the photo-import expiry hourly", async () => {
    const crons = (await import("../../convex/crons")).default as unknown as { crons: Record<string, { schedule: { type: string; cron?: string } }> };
    const job = crons.crons["expire photo imports"];
    expect(job?.schedule).toEqual({ type: "cron", cron: "41 * * * *" });
  });

  it("expires photo-import files older than 1 hour, rows and blobs", async () => {
    const t = makeTest();
    const userId = await user(t);
    const s = await seedCampaign(t, userId, undefined);
    const photo = (createdAt: number) =>
      t.run(async (ctx) => {
        const storageId = await blob(ctx);
        await ctx.db.insert("files", { storageId, campaignId: s.campaignId, uploadedBy: userId, kind: "photoImport", refId: s.campaignId, createdAt });
        return storageId;
      });
    const stale = await photo(NOW - 61 * 60 * 1000);
    const fresh = await photo(NOW - 30 * 60 * 1000);

    await t.mutation(internal.cleanup.expirePhotoImports, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const exists = (id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("files")
        .withIndex("by_ref", (q) => q.eq("kind", "photoImport"))
        .collect(),
    );
    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(rows.map((r) => r.storageId)).toEqual([fresh]);
    // Other kinds are untouched.
    for (const id of s.blobs) expect(await exists(id)).toBe(true);
  });

  it("expires the oldest photo-import files first, whatever their campaign, and continues past a full batch", async () => {
    const t = makeTest();
    const userId = await user(t);
    const s = await seedCampaign(t, userId, undefined);
    // `refId` "a…" sorts before "z…": reading by campaign would take the BATCH newer rows first.
    const oldest = await t.run(async (ctx) => {
      const storageId = await blob(ctx);
      await ctx.db.insert("files", { storageId, campaignId: s.campaignId, uploadedBy: userId, kind: "photoImport", refId: "zzz", createdAt: NOW - 10 * HOUR });
      return storageId;
    });
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH; i++) {
        const storageId = await blob(ctx);
        await ctx.db.insert("files", { storageId, campaignId: s.campaignId, uploadedBy: userId, kind: "photoImport", refId: "aaa", createdAt: NOW - 2 * HOUR + i });
      }
    });
    const count = () =>
      t.run(async (ctx) => (await ctx.db
        .query("files")
        .withIndex("by_kind_created", (q) => q.eq("kind", "photoImport"))
        .collect()).length);
    const exists = (id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);

    await t.mutation(internal.cleanup.expirePhotoImports, {});
    expect(await exists(oldest)).toBe(false);
    expect(await count()).toBe(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await count()).toBe(0);
  });

  describe("action log snapshots (dcm-c26)", () => {
    /** A GM's campaign and a logger of undoable rows at the current (fake) time. */
    async function campaignWithLog(t: Test) {
      const userId = await user(t);
      const gm = t.withIdentity({ subject: `${userId}|s` });
      const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Log", idempotencyKey: key() });
      const log = (count: number, extra: Partial<NewDoc<"actionLog">> = {}) =>
        t.run(async (ctx) => {
          const ids: Id<"actionLog">[] = [];
          for (let i = 0; i < count; i++) {
            ids.push(
              await ctx.db.insert("actionLog", {
                campaignId,
                actorId: userId,
                kind: "feature",
                visibility: "public",
                summary: `row ${i}`,
                before: "{}",
                undoable: true,
                at: Date.now(),
                ...extra,
              }),
            );
          }
          return ids;
        });
      return { gm, campaignId, log };
    }
    const rowsOf = (t: Test, ids: Id<"actionLog">[]) => t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get("actionLog", id))));

    it("strips before-snapshots older than 30 days in batches; the rows stay, no longer undoable", async () => {
      const t = makeTest();
      const { gm, campaignId, log } = await campaignWithLog(t);
      const old = await log(ACTION_LOG_STRIP_BATCH + 5);
      const [combat] = await log(1, { kind: "combat", before: undefined, adversaryBefore: [] });
      const [plain] = await log(1, { kind: "levelUp", before: undefined, undoable: false });
      vi.setSystemTime(NOW + 25 * DAY);
      const recent = await log(1);
      vi.setSystemTime(NOW + 31 * DAY);

      await t.mutation(internal.cleanup.stripActionLogSnapshots, {});
      // One batch per run, then it reschedules itself.
      expect((await rowsOf(t, old)).filter((r) => r!.before === undefined)).toHaveLength(ACTION_LOG_STRIP_BATCH);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      for (const row of await rowsOf(t, [...old, combat!])) {
        expect(row).not.toBeNull();
        expect(row).not.toHaveProperty("before");
        expect(row).not.toHaveProperty("adversaryBefore");
        expect(row!.undoable).toBe(false);
      }
      expect((await rowsOf(t, [plain!]))[0]).toMatchObject({ summary: "row 0", undoable: false });
      expect((await rowsOf(t, recent))[0]).toMatchObject({ before: "{}", undoable: true });

      // The feed shows no Undo for a stripped row, and undo refuses it.
      const page = await gm.query(api.feed.list, { campaignId, paginationOpts: { numItems: 500, cursor: null } });
      const shown = new Map(page.page.map((r) => [r._id, r.canUndo]));
      expect(shown.get(old[0]!)).toBe(false);
      expect(shown.get(recent[0]!)).toBe(true);
      expect(errorCode(await gm.mutation(api.actionLog.undo, { entryId: old[0]!, idempotencyKey: key() }).catch((e: unknown) => e))).toBe("UNDO_STALE");
    });

    it("reads the undoable rows by age (by_undoable_at): every older row in one pass, undone rows too, no backfill", async () => {
      const t = makeTest();
      const { log } = await campaignWithLog(t);
      const ancient = await log(1);
      const [undone] = await log(1, { undoneAt: Date.now() });
      vi.setSystemTime(NOW + 60 * DAY);
      const older = await log(1);
      vi.setSystemTime(NOW + 85 * DAY);
      const recent = await log(1);
      vi.setSystemTime(NOW + 100 * DAY);

      await t.mutation(internal.cleanup.stripActionLogSnapshots, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      for (const row of await rowsOf(t, [...ancient, undone!, ...older])) {
        expect(row).toMatchObject({ undoable: false });
        expect(row).not.toHaveProperty("before");
      }
      expect((await rowsOf(t, recent))[0]).toMatchObject({ before: "{}", undoable: true });
      // Nothing undoable is left before the cutoff, so a rerun reads nothing and schedules nothing.
      await t.mutation(internal.cleanup.stripActionLogSnapshots, {});
      expect(await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.state.kind === "pending"))).toEqual([]);
    });
  });
});
