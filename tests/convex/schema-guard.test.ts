import { authTables } from "@convex-dev/auth/server";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { describe, expect, test } from "vitest";

import schema from "../../convex/schema";
import { makeTest, modules } from "./setup";

/**
 * Locks in the schema and function rules a reviewer would otherwise have to
 * re-check by hand: no `v.any()` (CD1, CF5), no prefix-duplicate indexes
 * (CD15), a retention decision for every table (CD17), and validators on
 * every public function (CF5, rule 4).
 */

type Index = { indexDescriptor: string; fields: string[] };
type Table = { validator: { json: unknown }; " indexes"(): Index[] };

const tables = schema.tables as unknown as Record<string, Table>;

/** The paths (`a.b[]`) of every `v.any()` inside a validator's JSON. */
function anyPaths(json: unknown, path = ""): string[] {
  if (json === null || typeof json !== "object") return [];
  const node = json as { type?: string; value?: unknown; values?: { fieldType: unknown } };
  if (node.type === "any") return [path || "(root)"];
  if (node.type === "object") {
    const fields = node.value as Record<string, { fieldType: unknown }>;
    return Object.entries(fields).flatMap(([key, field]) => anyPaths(field.fieldType, path ? `${path}.${key}` : key));
  }
  if (node.type === "array") return anyPaths(node.value, `${path}[]`);
  if (node.type === "union") return (node.value as unknown[]).flatMap((member) => anyPaths(member, path));
  if (node.type === "record") return anyPaths(node.values?.fieldType, `${path}{}`);
  return [];
}

/** `table.index` pairs where the first index's fields are a prefix of the second's. */
function prefixDuplicates(table: string, indexes: Index[]): string[] {
  return indexes.flatMap((short) =>
    indexes
      .filter(
        (long) =>
          long !== short &&
          short.fields.length <= long.fields.length &&
          short.fields.every((field, i) => long.fields[i] === field),
      )
      .map((long) => `${table}.${short.indexDescriptor} (prefix of ${long.indexDescriptor})`),
  );
}

function storedAnyFields(): string[] {
  return Object.entries(tables).flatMap(([name, table]) =>
    anyPaths(table.validator.json).map((path) => `${name}.${path}`),
  );
}

/** Our tables only: Convex Auth's indexes are the library's to change. */
function allPrefixDuplicates(): string[] {
  return Object.entries(tables)
    .filter(([name]) => !(name in authTables))
    .flatMap(([name, table]) => prefixDuplicates(name, table[" indexes"]()));
}

/** The only stored `v.any()` the rules allow (CD1). */
const ANY_ALLOWED = ["operations.result"];

/**
 * Blobs still `v.any()` while their widen → migrate → narrow runs (CD2).
 * Narrowing one removes it here; the guard fails while a listed field is no
 * longer `v.any()`, so the list only shrinks.
 */
const ANY_PENDING_NARROW = ["characters.sheet", "codexEntries.data", "frameTrackers.data", "maps.data"];

/**
 * Prefix-duplicate indexes whose table file this tracer does not own. Each
 * has no readers left and is dropped at merge; the guard fails once it is
 * gone and the entry is stale.
 */
const DUPLICATE_INDEX_PENDING_DROP: string[] = [];

/**
 * Every table, by how it stays bounded (CD17, CD18). A new table fails the
 * guard until it is listed here.
 * - `retention`: only grows; a cron in convex/crons.ts deletes old rows.
 * - `campaignScoped`: rows belong to one campaign and go with its purge.
 * - `mapScoped`: rows belong to one combat map and go before it.
 * - `bounded`: at most a few rows per user, or rows owned by a library.
 */
const RETENTION: Record<string, string> = {
  operations: "idempotency records expire after 7 days",
  campaigns: "soft-deleted campaigns are purged after 30 days",
  files: "unclaimed storage blobs are swept; a campaign's files go with its purge",
};
const CAMPAIGN_SCOPED = [
  "campaignOpens",
  "campaignMembers",
  "campaignInvites",
  "campaignState",
  "countdowns",
  "campaignTime",
  "frameTrackers",
  "characters",
  "characterExtras",
  "maps",
  "mapTokens",
  "mapHexes",
  "mapTerrain",
  "codexEntries",
  "codexEntryText",
  "codexCounters",
  "history",
  "actionLog",
  "countdownTicks",
  "rests",
  "restChoices",
  "encounters",
  "encounterAdversaries",
  "customAdversaries",
  "combatMaps",
  "combatTokens",
  "sessions",
  "sessionPrep",
  "sessionLog",
  "sessionSpotlights",
  "spritePacks",
  "spritePackSprites",
  "journals",
  "journalPages",
  "journalPageRecipients",
  "journalEntries",
  "lorekeeperLibrary",
  "lorekeeperConversations",
  "lorekeeperMessages",
  "lorekeeperRulings",
  "lorekeeperAsks",
  "lorekeeperUsage",
  "combatRequests",
];
/**
 * Campaign-scoped tables that also have a retention job of their own (listed once above, so this is a second note,
 * not a second classification). The guard only checks that each is campaign-scoped; the job lands with its tracer.
 */
const ALSO_RETENTION: Record<string, string> = {
  journalPages: "torn-out pages are purged 30 days after binnedAt, with their entries and recipients (D11 N7 cron)",
  lorekeeperUsage:
    "usage counters expire 13 months after their last update (D13 L0 cron); per-user and deployment rows have no campaign",
  combatRequests: "resolved and declined requests are swept a day after resolvedAt (combat-actions AA0 cron)",
};
/**
 * Child rows of a combat map (D9): reached through `mapId` and deleted before their map, by the campaign purge
 * and by C3's map delete (`deleteMapChildren` in convex/lib/combatMaps.ts).
 */
const MAP_SCOPED = ["combatMapObjects", "combatMapCells", "combatExplored"];
/** Lorekeeper books and their chunks (D13): one set per deployment (about 20 books), replaced on re-ingest. */
const BOUNDED = ["settings", "grants", "lorekeeperBooks", "lorekeeperChunks", ...Object.keys(authTables)];

describe("stored fields", () => {
  test("no v.any() outside the allowlist", () => {
    const unexpected = storedAnyFields().filter((f) => !ANY_ALLOWED.includes(f) && !ANY_PENDING_NARROW.includes(f));
    expect(unexpected).toEqual([]);
  });

  test("the pending-narrow list holds only fields that are still v.any()", () => {
    const stored = storedAnyFields();
    expect(ANY_PENDING_NARROW.filter((f) => !stored.includes(f))).toEqual([]);
  });

  test("the detector finds v.any() at any depth", () => {
    const table = defineTable({
      ok: v.string(),
      top: v.any(),
      nested: v.object({ deep: v.array(v.union(v.null(), v.any())) }),
      map: v.optional(v.record(v.string(), v.any())),
    });
    expect(anyPaths((table as unknown as Table).validator.json)).toEqual(["top", "nested.deep[]", "map{}"]);
  });
});

describe("indexes", () => {
  test("no index is a field-prefix of another index on its table", () => {
    const unexpected = allPrefixDuplicates().filter((d) => !DUPLICATE_INDEX_PENDING_DROP.includes(d));
    expect(unexpected).toEqual([]);
  });

  test("the pending-drop list holds only indexes that still exist", () => {
    const found = allPrefixDuplicates();
    expect(DUPLICATE_INDEX_PENDING_DROP.filter((d) => !found.includes(d))).toEqual([]);
  });

  test("no index lists _creationTime", () => {
    const listed = Object.entries(tables).flatMap(([name, table]) =>
      table[" indexes"]()
        .filter((index) => index.fields.includes("_creationTime"))
        .map((index) => `${name}.${index.indexDescriptor}`),
    );
    expect(listed).toEqual([]);
  });

  test("the detector finds a prefix duplicate", () => {
    const table = defineTable({ a: v.string(), b: v.string() })
      .index("by_a", ["a"])
      .index("by_a_b", ["a", "b"])
      .index("by_b", ["b"]);
    expect(prefixDuplicates("t", (table as unknown as Table)[" indexes"]())).toEqual(["t.by_a (prefix of by_a_b)"]);
  });
});

describe("retention", () => {
  const classified = [...Object.keys(RETENTION), ...CAMPAIGN_SCOPED, ...MAP_SCOPED, ...BOUNDED];

  test("every table has a retention decision", () => {
    expect(Object.keys(tables).filter((name) => !classified.includes(name))).toEqual([]);
  });

  test("no table is classified twice, and none is missing from the schema", () => {
    expect(classified.filter((name, i) => classified.indexOf(name) !== i)).toEqual([]);
    expect(classified.filter((name) => !(name in tables))).toEqual([]);
  });

  test("campaign-scoped tables have a campaignId the purge can find", () => {
    const missing = CAMPAIGN_SCOPED.filter((name) => {
      const json = tables[name].validator.json as { type: string; value: unknown };
      const objects = json.type === "union" ? (json.value as { value: object }[]) : [json as { value: object }];
      return !objects.every((member) => "campaignId" in member.value);
    });
    expect(missing).toEqual([]);
  });

  test("tables with an extra retention job are campaign-scoped tables of the schema", () => {
    expect(Object.keys(ALSO_RETENTION).filter((name) => !CAMPAIGN_SCOPED.includes(name) || !(name in tables))).toEqual([]);
  });

  test("map-scoped tables have a mapId the purge can find", () => {
    const missing = MAP_SCOPED.filter((name) => {
      const json = tables[name].validator.json as { value: object };
      return !("mapId" in json.value);
    });
    expect(missing).toEqual([]);
  });
});

type Registered = ((...args: never[]) => unknown) & {
  isPublic?: boolean;
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  exportArgs(): string;
  exportReturns(): string;
};

/** Convex Auth's own endpoints (signIn, store, ...); their validators are the library's. */
const VALIDATOR_EXEMPT_MODULES = ["auth"];
/** Config modules that register no functions (convex.config pulls in component code). */
const CONFIG_MODULES = ["convex.config", "auth.config", "schema"];

/**
 * Every public function, loaded once per file (importing every convex module is the slow part; bead dcm-lm0) and
 * shared by the tests below.
 */
let loaded: Promise<{ name: string; fn: Registered }[]> | undefined;
function publicFunctions(): Promise<{ name: string; fn: Registered }[]> {
  loaded ??= loadPublicFunctions();
  return loaded;
}

async function loadPublicFunctions(): Promise<{ name: string; fn: Registered }[]> {
  const found: { name: string; fn: Registered }[] = [];
  for (const [path, load] of Object.entries(modules)) {
    const file = path.replace(/^.*\/convex\//, "").replace(/\.ts$/, "");
    if (file.startsWith("_generated/") || VALIDATOR_EXEMPT_MODULES.includes(file) || CONFIG_MODULES.includes(file)) continue;
    const exports = (await load()) as Record<string, unknown>;
    for (const [exportName, value] of Object.entries(exports)) {
      const fn = value as Registered | null;
      if (typeof fn !== "function" || !fn.isPublic) continue;
      if (!fn.isQuery && !fn.isMutation && !fn.isAction) continue;
      found.push({ name: `${file}:${exportName}`, fn });
    }
  }
  return found;
}

describe("public functions", () => {
  test("every public function has an args validator with no v.any()", async () => {
    const bad = (await publicFunctions()).flatMap(({ name, fn }) =>
      anyPaths(JSON.parse(fn.exportArgs())).map((path) => `${name} ${path}`),
    );
    expect(bad).toEqual([]);
  });

  test("every public function declares a returns validator", async () => {
    const functions = await publicFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.filter(({ fn }) => fn.exportReturns() === "null").map(({ name }) => name)).toEqual([]);
  });
});

/**
 * Plan combat-actions, CA0: the widened fields (rule 7, widen only). Rows stored before the widening still validate
 * and read back unchanged; rows with the new fields validate; a value outside the new unions is refused.
 */
describe("combat-actions widening (CA0)", () => {
  async function seed() {
    const t = makeTest();
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "ca0@example.com", emailVerificationTime: 1 });
      const campaignId = await ctx.db.insert("campaigns", {
        ownerId: userId,
        frameId: "witherwild",
        name: "CA0",
        nameKey: "ca0",
        tier: 1,
        level: 1,
        createdAt: 1,
        lastOpenedAt: 1,
      });
      const encounterId = await ctx.db.insert("encounters", {
        campaignId,
        name: "Ambush",
        status: "running",
        pcs: 4,
        adjustments: [],
        gmTurn: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { userId, campaignId, encounterId };
    });
    return { t, ...ids };
  }

  const stats = { difficulty: 12, major: 7, severe: 12, hpMax: 6, stressMax: 3 };
  const block = {
    name: "Bog Hag",
    tier: 1,
    type: "Solo" as const,
    description: "",
    motives: "",
    difficulty: 12,
    thresholds: { major: 7, severe: 12 },
    hp: 6,
    stress: 3,
    attack: { modifier: 2, name: "Claws", range: "Melee", damage: "1d8+2 phy" },
    experiences: [],
    features: [],
    createdAt: 1,
    updatedAt: 1,
  };

  test("old actionLog, instance and custom adversary rows read back unchanged", async () => {
    const { t, userId, campaignId, encounterId } = await seed();
    await t.run(async (ctx) => {
      const log = { campaignId, actorId: userId, kind: "roll" as const, visibility: "public" as const, summary: "rolled", undoable: true, at: 1 };
      const logId = await ctx.db.insert("actionLog", log);
      const instance = {
        campaignId,
        encounterId,
        source: { kind: "srd" as const, adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats,
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 1,
        updatedAt: 1,
      };
      const instanceId = await ctx.db.insert("encounterAdversaries", instance);
      const customId = await ctx.db.insert("customAdversaries", { campaignId, ...block });
      expect(await ctx.db.get("actionLog", logId)).toMatchObject(log);
      expect(await ctx.db.get("actionLog", logId)).not.toHaveProperty("adversaryBefore");
      expect(await ctx.db.get("encounterAdversaries", instanceId)).toMatchObject(instance);
      expect(await ctx.db.get("encounterAdversaries", instanceId)).not.toHaveProperty("resistance");
      expect(await ctx.db.get("customAdversaries", customId)).not.toHaveProperty("resistance");
    });
  });

  test("new fields validate: adversaryBefore, combat kinds, resistance, the conditional toggle, instance effects", async () => {
    const { t, userId, campaignId, encounterId } = await seed();
    await t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "sand-wyrm" },
        label: "Wyrm",
        order: 0,
        summoned: false,
        stats,
        hp: 2,
        stress: 1,
        defeated: false,
        conditions: ["vulnerable"],
        tags: ["Enraptured"],
        spotlights: 0,
        spotlightTurn: 1,
        updatedAt: 1,
        resistance: { physical: "resistant", magic: "none", conditional: "While underground" },
        resistanceActive: true,
        effects: [{ id: "e1", source: "Glyph of Nightfall", label: "Difficulty -2", difficulty: -2, until: "temporary" }],
      });
      await ctx.db.insert("customAdversaries", { campaignId, ...block, resistance: { physical: "immune", magic: "resistant" } });
      const before = [{ instanceId, hp: 0, stress: 0, defeated: false, minionCount: 3, conditions: [], tags: [] }];
      for (const kind of ["combat", "adversary"] as const) {
        const logId = await ctx.db.insert("actionLog", {
          campaignId,
          actorId: userId,
          kind,
          visibility: "gm",
          summary: "Mira hits the Wyrm: 14 phy, Major, 2 HP",
          groupId: "g1",
          adversaryBefore: before,
          undoable: true,
          at: 1,
        });
        expect((await ctx.db.get("actionLog", logId))?.adversaryBefore).toEqual(before);
      }
    });
  });

  test("a resistance level outside none | resistant | immune is refused", async () => {
    const { t, campaignId } = await seed();
    const bad = { campaignId, ...block, resistance: { physical: "weak", magic: "none" } };
    await expect(t.run((ctx) => ctx.db.insert("customAdversaries", bad as never))).rejects.toThrow();
  });
});

/**
 * Plan combat-actions, AA0: the new `combatRequests` table. Its payload is a typed union keyed by `kind` with
 * `schemaVersion` (rule 7); both kinds store and read back; an unknown kind or a missing schemaVersion is refused.
 */
describe("combat requests (AA0)", () => {
  async function seed() {
    const t = makeTest();
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "aa0@example.com", emailVerificationTime: 1 });
      const campaignId = await ctx.db.insert("campaigns", {
        ownerId: userId,
        frameId: "witherwild",
        name: "AA0",
        nameKey: "aa0",
        tier: 1,
        level: 1,
        createdAt: 1,
        lastOpenedAt: 1,
      });
      const characterId = await ctx.db.insert("characters", {
        campaignId,
        ownerId: userId,
        createdBy: userId,
        status: "active",
        sheet: {},
        createdAt: 1,
        updatedAt: 1,
      });
      const encounterId = await ctx.db.insert("encounters", {
        campaignId,
        name: "Ambush",
        status: "running",
        pcs: 4,
        adjustments: [],
        gmTurn: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 1,
        updatedAt: 1,
      });
      const mapId = await ctx.db.insert("combatMaps", {
        campaignId,
        name: "Camp",
        live: true,
        source: "image",
        w: 10,
        h: 10,
        base: "grass",
        areas: [],
        seed: 1,
        schemaVersion: 1,
        updatedAt: 1,
      });
      const tokenId = await ctx.db.insert("combatTokens", {
        campaignId,
        mapId,
        ref: { kind: "pc", characterId },
        side: "pc",
        x: 1,
        y: 1,
        size: 1,
        face: 0,
        light: "torch",
        revealedTo: [],
      });
      return { userId, campaignId, characterId, encounterId, instanceId, mapId, tokenId };
    });
    return { t, ...ids };
  }

  test("a sanction and an incoming hit store and read back, with responses", async () => {
    const { t, userId, campaignId, characterId, encounterId, instanceId, mapId, tokenId } = await seed();
    await t.run(async (ctx) => {
      const sanction = {
        campaignId,
        encounterId,
        mapId,
        kind: "sanction" as const,
        status: "open" as const,
        createdBy: userId,
        createdAt: 1,
        payload: {
          schemaVersion: 1 as const,
          kind: "sanction" as const,
          characterId,
          action: {
            kind: "card" as const,
            cardId: "chain-lightning",
            useId: "main",
            targetTokenIds: [tokenId],
            choices: [{ id: "hope", value: 2 }],
          },
          outOfRange: [{ tokenId, band: "far" as const }],
        },
        responses: [],
      };
      const hit = {
        campaignId,
        encounterId,
        kind: "incomingHit" as const,
        status: "resolved" as const,
        createdBy: userId,
        createdAt: 1,
        payload: {
          schemaVersion: 1 as const,
          kind: "incomingHit" as const,
          attacker: { instanceId, label: "Bear" },
          targetCharacterId: characterId,
          damage: 14,
          damageType: "physical" as const,
          direct: false,
          critical: false,
          groupId: "g1",
          responders: [{ characterId, role: "target" as const, cardIds: [] }],
        },
        responses: [{ characterId, choice: { kind: "armor" as const, slots: 1 }, by: userId, at: 2 }],
        resolvedAt: 2,
        resolvedBy: userId,
      };
      const sanctionId = await ctx.db.insert("combatRequests", sanction);
      const hitId = await ctx.db.insert("combatRequests", hit);
      expect(await ctx.db.get("combatRequests", sanctionId)).toMatchObject(sanction);
      expect(await ctx.db.get("combatRequests", hitId)).toMatchObject(hit);
      const open = await ctx.db
        .query("combatRequests")
        .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaignId).eq("status", "open"))
        .take(10);
      expect(open.map((r) => r._id)).toEqual([sanctionId]);
    });
  });

  test("an unknown kind, a missing schemaVersion or an untyped payload is refused", async () => {
    const { t, userId, campaignId, characterId } = await seed();
    const row = { campaignId, kind: "sanction", status: "open", createdBy: userId, createdAt: 1, responses: [] };
    const payload = { schemaVersion: 1, kind: "sanction", characterId, action: { kind: "attack", slot: "primary", targetTokenIds: [], roll: {} }, outOfRange: [] };
    await t.run((ctx) => ctx.db.insert("combatRequests", { ...row, payload } as never));
    const bad = [
      { ...row, kind: "ambush", payload },
      { ...row, payload: { ...payload, schemaVersion: undefined } },
      { ...row, payload: { ...payload, anything: 1 } },
      { ...row, payload: { ...payload, kind: "duel" } },
    ];
    for (const doc of bad) await expect(t.run((ctx) => ctx.db.insert("combatRequests", doc as never))).rejects.toThrow();
  });
});
