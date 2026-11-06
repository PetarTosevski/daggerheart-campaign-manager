/**
 * The authz matrix guard (rule 14, TE2; analysis 2.5). Every public Convex function appears here: this file loads every
 * area's `authz/<area>.entries.ts` and fails when the runtime inventory of public functions differs from the union of
 * the areas' entries and exemptions, when a name is listed twice, when an entry's access class contradicts the wrapper
 * that defines the function, or when a knownBug is not a bead id. A new public function fails here until it has an
 * entry. The rows themselves run in `authz/<area>.test.ts` (one vitest file per area, so they run in parallel). How to write an entry: docs/tasks/TASK-D12-H0.md.
 */
import { getFunctionName, makeFunctionReference } from "convex/server";
import { beforeAll, describe, expect, test } from "vitest";

import { APP_OWNER_QUERY_ROWS, CAMPAIGN_CLASSES, COGM_KNOWN_GAPS, entryProblems, expectations, NON_OWNER_ROLES, type Access, type Area, type Entry } from "./authz/harness";
import { publicFunctions, wrapperOf, type FunctionKind, type WrapperInfo } from "./authz/inventory";

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { eager: true; import: "default" }): Record<string, unknown>;
  }
}

const areaFiles = import.meta.glob("./authz/*.entries.ts", { eager: true, import: "default" }) as Record<string, Area>;
const testFiles = Object.keys(import.meta.glob("./authz/*.test.ts"));
const AREAS = Object.values(areaFiles);

/** Every name an area lists, with where. */
function listings(areas: Area[]): { name: string; area: string; as: "entry" | "exempt" }[] {
  return areas.flatMap((a) => [
    ...a.entries.map((e) => ({ name: getFunctionName(e.fn), area: a.area, as: "entry" as const })),
    ...Object.keys(a.exempt ?? {}).map((name) => ({ name, area: a.area, as: "exempt" as const })),
  ]);
}

/** Inventory versus listings: names to add, names to remove, names listed more than once. */
export function coverageProblems(inventory: string[], areas: Area[]) {
  const listed = listings(areas);
  const names = listed.map((l) => l.name);
  return {
    missing: inventory.filter((name) => !names.includes(name)),
    stale: [...new Set(names.filter((name) => !inventory.includes(name)))],
    duplicates: [...new Set(names.filter((name, i) => names.indexOf(name) !== i))].map(
      (name) => `${name} (${listed.filter((l) => l.name === name).map((l) => `${l.area} ${l.as}`).join(", ")})`,
    ),
  };
}

/** A knownBug must name a bead (`dcm-<id>`), so the failing entry points at open work. */
export const BEAD_ID = /^dcm-[a-z0-9]+(\.[0-9]+)*$/;

export function knownBugProblems(areas: Area[]): string[] {
  return areas.flatMap((a) =>
    a.entries
      .filter((e) => e.knownBug !== undefined && !BEAD_ID.test(e.knownBug))
      .map((e) => `${getFunctionName(e.fn)}: knownBug "${e.knownBug}" is not a bead id`),
  );
}

/** The access classes a wrapper allows (a function can't be filed under a friendlier class than its wrapper). */
export function allowedClasses(info: WrapperInfo | null): Access[] {
  if (info === null) return [];
  switch (info.wrapper) {
    case "gmQuery":
    case "gmMutation":
    case "keyedGmMutation":
      return ["gm"];
    // Config G1: the creator-only rank (a co-GM is FORBIDDEN).
    case "creatorQuery":
    case "creatorMutation":
    case "keyedCreatorMutation":
      return ["creator"];
    case "campaignQuery":
    case "campaignMutation":
    case "keyedCampaignMutation":
      return info.need === "view"
        ? ["view"]
        : info.need === "edit"
          ? ["edit"]
          : info.need === "owner"
            ? ["gm"]
            : info.need === "creator"
              ? ["creator"]
              : [];
    case "userQuery":
    case "userMutation":
    case "keyedUserMutation":
    case "userAction":
      return ["own", "scoped", "user"];
    case "maybeUserQuery":
      return ["maybe"];
    // Config AD0: the app owner's builders, and only them, are the `appOwner` class (owner-only, never friendlier).
    case "appOwnerQuery":
    case "appOwnerMutation":
    case "appOwnerAction":
      return ["appOwner"];
  }
}

/** Entries whose access class contradicts their wrapper, and exemptions of functions a wrapper defines. */
export async function classProblems(areas: Area[], wrapperOfName: (name: string) => Promise<WrapperInfo | null>): Promise<string[]> {
  const problems: string[] = [];
  for (const area of areas) {
    for (const entry of area.entries) {
      const name = getFunctionName(entry.fn);
      const info = await wrapperOfName(name);
      const allowed = allowedClasses(info);
      if (!allowed.includes(entry.access)) {
        problems.push(`${name}: filed as ${entry.access}, but ${info === null ? "no known wrapper" : info.wrapper + (info.need ? ` need ${info.need}` : "")} allows ${allowed.join("/") || "nothing"}`);
      }
      problems.push(...entryProblems(entry));
    }
    for (const name of Object.keys(area.exempt ?? {})) {
      const info = await wrapperOfName(name);
      if (info !== null) problems.push(`${name}: exempt, but defined by ${info.wrapper}; give it an entry`);
    }
  }
  return problems;
}

/**
 * Config AD13: the owner's read-only view is query-only. For every write (mutation or action) that is not an owner
 * function, the app owner's row must equal the outsider's and no entry may state one; on a campaign class it must be a
 * refusal (NOT_FOUND / FORBIDDEN). So no write row can flip to ok for the owner without changing this guard.
 */
export function ownerWriteProblems(areas: Area[], kindOf: (name: string) => FunctionKind | undefined): string[] {
  const problems: string[] = [];
  for (const entry of areas.flatMap((a) => a.entries) as Entry[]) {
    const name = getFunctionName(entry.fn);
    const kind = kindOf(name);
    if (kind === undefined || kind === "query" || entry.access === "appOwner") continue;
    const rows = Object.fromEntries(expectations(entry, kind));
    if (entry.expect?.appOwner !== undefined) problems.push(`${name}: a write may not state an appOwner row`);
    if (rows.appOwner !== rows.outsider) problems.push(`${name}: appOwner ${rows.appOwner}, outsider ${rows.outsider}`);
    if (CAMPAIGN_CLASSES.includes(entry.access) && rows.appOwner !== "NOT_FOUND" && rows.appOwner !== "FORBIDDEN") {
      problems.push(`${name}: the app owner's write on a ${entry.access} function expects ${rows.appOwner}`);
    }
  }
  return problems;
}

describe("authz matrix guard", () => {
  let inventory: string[] = [];
  let kinds = new Map<string, FunctionKind>();
  // Loading every convex module takes a few seconds on a busy machine.
  beforeAll(async () => {
    const functions = await publicFunctions();
    inventory = functions.map((f) => f.name);
    kinds = new Map(functions.map((f) => [f.name, f.kind]));
  }, 120_000);

  test("the app owner is refused on every campaign write and is an outsider on every other write (config AD13)", () => {
    expect(ownerWriteProblems(AREAS, (name) => kinds.get(name))).toEqual([]);
    // The guard covers something: every campaign class has writes in the matrix.
    const writes = AREAS.flatMap((a) => a.entries).filter((e) => kinds.get(getFunctionName(e.fn)) !== "query" && CAMPAIGN_CLASSES.includes(e.access));
    expect(writes.length).toBeGreaterThan(100);
  });

  test("every APP_OWNER_QUERY_ROWS name is a listed query (config AD13)", () => {
    const listed = listings(AREAS).map((l) => l.name);
    const bad = Object.keys(APP_OWNER_QUERY_ROWS).filter((name) => !listed.includes(name) || kinds.get(name) !== "query");
    expect(bad).toEqual([]);
  });

  test("every public function is listed (entry or exempt) and nothing else is", () => {
    const { missing, stale } = coverageProblems(inventory, AREAS);
    // A new public function fails here: add it to its area's entries (see docs/tasks/TASK-D12-H0.md).
    expect(missing, "public functions with no matrix entry").toEqual([]);
    expect(stale, "listed names that are not public functions").toEqual([]);
  });

  test("every knownBug names a bead", () => {
    expect(knownBugProblems(AREAS)).toEqual([]);
  });

  test("every known co-GM gap names a bead and a listed function", () => {
    const listed = listings(AREAS).map((l) => l.name);
    const bad = Object.entries(COGM_KNOWN_GAPS).filter(([name, bead]) => !BEAD_ID.test(bead) || !listed.includes(name));
    expect(bad).toEqual([]);
  });

  test("no name is listed twice across the areas", () => {
    expect(coverageProblems([], AREAS).duplicates).toEqual([]);
  });

  test("every entry's access class agrees with its wrapper; scoped entries state every role; okCodes hold no access code", async () => {
    expect(await classProblems(AREAS, wrapperOf)).toEqual([]);
  });

  test("every exemption has a reason", () => {
    const blank = AREAS.flatMap((a) => Object.entries(a.exempt ?? {}).filter(([, reason]) => reason.trim() === "").map(([name]) => name));
    expect(blank).toEqual([]);
  });

  test("every area file has its runner and a unique area name", () => {
    const missingRunner = Object.keys(areaFiles)
      .map((path) => path.replace(".entries.ts", ".test.ts"))
      .filter((path) => !testFiles.includes(path));
    expect(missingRunner).toEqual([]);
    const names = AREAS.map((a) => a.area);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  test("the inventory finds every wrapped function and the Convex Auth exports", async () => {
    const unwrapped = [];
    for (const name of inventory) if ((await wrapperOf(name)) === null) unwrapped.push(name);
    expect(unwrapped.sort()).toEqual(["auth:isAuthenticated", "auth:signIn", "auth:signOut"]);
  });
});

describe("the guard's checks catch what they should", () => {
  const fakeRef = (name: string) => makeFunctionReference<"mutation">(name);
  const area = (patch: Partial<Area>): Area => ({ area: "fake", entries: [], ...patch });

  test("a missing name, a stale name and a duplicate", () => {
    const one = { fn: fakeRef("a:one"), access: "gm" as const };
    const result = coverageProblems(["a:one", "a:two"], [area({ entries: [one], exempt: { "a:gone": "why" } }), area({ area: "other", entries: [one] })]);
    expect(result).toEqual({ missing: ["a:two"], stale: ["a:gone"], duplicates: ["a:one (fake entry, other entry)"] });
  });

  test("a public function with no entry fails, even when its area exists", () => {
    expect(coverageProblems(["a:one"], [area({})]).missing).toEqual(["a:one"]);
  });

  test("a knownBug that is not a bead id", () => {
    const entries = [
      { fn: fakeRef("m:a"), access: "gm" as const, knownBug: "dcm-bxp.101" },
      { fn: fakeRef("m:b"), access: "gm" as const, knownBug: "dcm-t30" },
      { fn: fakeRef("m:c"), access: "gm" as const, knownBug: "players may read it" },
    ];
    expect(knownBugProblems([area({ entries })])).toEqual(['m:c: knownBug "players may read it" is not a bead id']);
  });

  test("a gm function filed as view, a view function as gm, a user function as maybe", async () => {
    const wrappers: Record<string, WrapperInfo> = {
      "m:gm": { wrapper: "keyedGmMutation" },
      "m:view": { wrapper: "campaignQuery", need: "view" },
      "m:edit": { wrapper: "keyedCampaignMutation", need: "edit" },
      "m:user": { wrapper: "userMutation" },
    };
    const problems = await classProblems(
      [
        area({
          entries: [
            { fn: fakeRef("m:gm"), access: "view" },
            { fn: fakeRef("m:view"), access: "gm" },
            { fn: fakeRef("m:edit"), access: "edit" },
            { fn: fakeRef("m:user"), access: "maybe" },
          ],
        }),
      ],
      async (name) => wrappers[name] ?? null,
    );
    expect(problems).toEqual([
      "m:gm: filed as view, but keyedGmMutation allows gm",
      "m:view: filed as gm, but campaignQuery need view allows view",
      "m:user: filed as maybe, but userMutation allows own/scoped/user",
    ]);
  });

  test("a creator function filed as gm, a gm function filed as creator (config G1)", async () => {
    const wrappers: Record<string, WrapperInfo> = {
      "m:creator": { wrapper: "creatorMutation" },
      "m:needCreator": { wrapper: "campaignMutation", need: "creator" },
      "m:gm": { wrapper: "gmMutation" },
      "m:ok": { wrapper: "keyedCreatorMutation" },
    };
    const problems = await classProblems(
      [
        area({
          entries: [
            { fn: fakeRef("m:creator"), access: "gm" },
            { fn: fakeRef("m:needCreator"), access: "gm" },
            { fn: fakeRef("m:gm"), access: "creator" },
            { fn: fakeRef("m:ok"), access: "creator" },
          ],
        }),
      ],
      async (name) => wrappers[name] ?? null,
    );
    expect(problems).toEqual([
      "m:creator: filed as gm, but creatorMutation allows creator",
      "m:needCreator: filed as gm, but campaignMutation need creator allows creator",
      "m:gm: filed as creator, but gmMutation allows gm",
    ]);
  });

  test("an appOwner function filed as user, a user function filed as appOwner, a loosened appOwner row (config AD0)", async () => {
    const wrappers: Record<string, WrapperInfo> = {
      "m:ownerAsUser": { wrapper: "appOwnerMutation" },
      "m:userAsOwner": { wrapper: "userQuery" },
      "m:ok": { wrapper: "appOwnerQuery" },
      "m:loosened": { wrapper: "appOwnerAction" },
    };
    const problems = await classProblems(
      [
        area({
          entries: [
            { fn: fakeRef("m:ownerAsUser"), access: "user" },
            { fn: fakeRef("m:userAsOwner"), access: "appOwner" },
            { fn: fakeRef("m:ok"), access: "appOwner" },
            { fn: fakeRef("m:loosened"), access: "appOwner", expect: { gm: "ok", appOwner: "ok" } },
          ],
        }),
      ],
      async (name) => wrappers[name] ?? null,
    );
    expect(problems).toEqual([
      "m:ownerAsUser: filed as user, but appOwnerMutation allows appOwner",
      "m:userAsOwner: filed as appOwner, but userQuery allows own/scoped/user",
      "m:loosened: appOwner entries keep every non-owner row (overrides gm)",
    ]);
  });

  test("an owner write that would flip to ok, and a stated appOwner row on a write (config AD13)", () => {
    const entries: Entry[] = [
      { fn: fakeRef("m:gmWrite"), access: "gm" },
      { fn: fakeRef("m:loosenedOutsider"), access: "view", expect: { outsider: "ok" } },
      { fn: fakeRef("m:statedOwner"), access: "edit", expect: { appOwner: "ok" } },
      { fn: fakeRef("m:userWrite"), access: "user" },
      { fn: fakeRef("m:read"), access: "gm", expect: { appOwner: "NOT_FOUND" } },
    ];
    const kinds: Record<string, FunctionKind> = {
      "m:gmWrite": "mutation",
      "m:loosenedOutsider": "action",
      "m:statedOwner": "mutation",
      "m:userWrite": "mutation",
      "m:read": "query",
    };
    expect(ownerWriteProblems([area({ entries })], (name) => kinds[name])).toEqual([
      "m:loosenedOutsider: the app owner's write on a view function expects ok",
      "m:statedOwner: a write may not state an appOwner row",
    ]);
    // A stated appOwner row never reaches a write; on a query it does, and the view's classes follow the GM.
    expect(Object.fromEntries(expectations(entries[2], "mutation")).appOwner).toBe("NOT_FOUND");
    expect(Object.fromEntries(expectations(entries[0], "query")).appOwner).toBe("ok");
    expect(Object.fromEntries(expectations({ fn: fakeRef("m:c"), access: "creator" }, "query")).appOwner).toBe("NOT_FOUND");
    expect(Object.fromEntries(expectations(entries[3], "mutation")).appOwner).toBe("ok");
  });

  test("the appOwner class refuses every non-owner role (config AD0)", () => {
    const rows = Object.fromEntries(expectations({ fn: fakeRef("m:owner"), access: "appOwner" }, "mutation"));
    expect(rows).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "FORBIDDEN",
      otherPlayer: "FORBIDDEN",
      player: "FORBIDDEN",
      grantee: "FORBIDDEN",
      coGm: "FORBIDDEN",
      gm: "FORBIDDEN",
      appOwner: "ok",
    });
    expect(NON_OWNER_ROLES.every((role) => rows[role] !== "ok")).toBe(true);
  });

  test("a scoped entry missing roles, an access code in okCodes, an exempted wrapped function", async () => {
    const problems = await classProblems(
      [
        area({
          entries: [{ fn: fakeRef("m:scoped"), access: "scoped", expect: { anon: "UNAUTHENTICATED", gm: "ok" }, okCodes: ["FORBIDDEN", "INVALID"] }],
          exempt: { "m:wrapped": "because" },
        }),
      ],
      async () => ({ wrapper: "userMutation" }),
    );
    expect(problems).toEqual([
      "m:scoped: scoped entries state every role (missing outsider, player)",
      "m:scoped: okCodes may not contain access codes (FORBIDDEN)",
      "m:wrapped: exempt, but defined by userMutation; give it an entry",
    ]);
  });
});
