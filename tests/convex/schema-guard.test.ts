import { authTables } from "@convex-dev/auth/server";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { describe, expect, test } from "vitest";

import schema from "../../convex/schema";
import { modules } from "./setup";

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
  portraitUploads: "deprecated; emptied by migrations/uploads:moveUploadsToFiles",
  mapUploads: "deprecated; emptied by migrations/uploads:moveUploadsToFiles",
  codexImages: "deprecated; emptied by migrations/uploads:moveUploadsToFiles",
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
];
/**
 * Child rows of a combat map (D9): reached through `mapId` and deleted before their map, by the campaign purge
 * and by C3's map delete (`deleteMapChildren` in convex/lib/combatMaps.ts).
 */
const MAP_SCOPED = ["combatMapObjects", "combatMapCells", "combatExplored"];
const BOUNDED = ["settings", "grants", ...Object.keys(authTables)];

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
 * Functions still without a `returns` validator: mutations, and one GM-only
 * query (rule 4 requires one on player-facing queries). Adding one removes the
 * entry; the guard fails while a listed function has one, so the list only
 * shrinks (and it also proves the module scan finds functions at all).
 */
const RETURNS_PENDING = [
  "countdowns:operate",
  "fear:adjust",
  "fear:set",
  "members:access",
  "members:invite",
  "members:revokeInvite",
  "members:removePlayer",
  "members:leave",
  "members:rotateJoinCode",
];

async function publicFunctions(): Promise<{ name: string; fn: Registered }[]> {
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

  test("every public function declares a returns validator, except the listed ones", async () => {
    const missing = (await publicFunctions()).filter(({ fn }) => fn.exportReturns() === "null").map(({ name }) => name);
    expect(missing.filter((name) => !RETURNS_PENDING.includes(name))).toEqual([]);
    expect(RETURNS_PENDING.filter((name) => !missing.includes(name))).toEqual([]);
  });
});
