/**
 * The authz matrix guard (rule 14, TE2; analysis 2.5). Every public Convex function appears here: this file loads every
 * area's `authz/<area>.entries.ts` and fails when the runtime inventory of public functions differs from the union of
 * the areas' entries and exemptions, when a name is listed twice, when an entry's access class contradicts the wrapper
 * that defines the function, when an area still lists a pending name, or when a knownBug is not a bead id. There is no
 * pending list any more (D12 H24): a new public function fails here until it has an entry. The rows themselves run in `authz/<area>.test.ts` (one vitest file
 * per area, so they run in parallel). How to write an entry: docs/tasks/TASK-D12-H0.md.
 */
import { getFunctionName, makeFunctionReference } from "convex/server";
import { beforeAll, describe, expect, test } from "vitest";

import { entryProblems, type Access, type Area } from "./authz/harness";
import { publicFunctions, wrapperOf, type WrapperInfo } from "./authz/inventory";

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

/** Names still in an area's pending list: pending support is gone, so each one is a failure. */
export function pendingProblems(areas: Area[]): string[] {
  return areas.flatMap((a) => a.pending.map((name) => `${name}: pending in ${a.area}; give it an entry`));
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
    case "campaignQuery":
    case "campaignMutation":
    case "keyedCampaignMutation":
      return info.need === "view" ? ["view"] : info.need === "edit" ? ["edit"] : info.need === "owner" ? ["gm"] : [];
    case "userQuery":
    case "userMutation":
    case "keyedUserMutation":
    case "userAction":
      return ["own", "scoped", "user"];
    case "maybeUserQuery":
      return ["maybe"];
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

describe("authz matrix guard", () => {
  let inventory: string[] = [];
  // Loading every convex module takes a few seconds on a busy machine.
  beforeAll(async () => {
    inventory = (await publicFunctions()).map((f) => f.name);
  }, 120_000);

  test("every public function is listed (entry or exempt) and nothing else is", () => {
    const { missing, stale } = coverageProblems(inventory, AREAS);
    // A new public function fails here: add it to its area's entries (see docs/tasks/TASK-D12-H0.md).
    expect(missing, "public functions with no matrix entry").toEqual([]);
    expect(stale, "listed names that are not public functions").toEqual([]);
  });

  test("no area lists a pending name", () => {
    expect(pendingProblems(AREAS)).toEqual([]);
  });

  test("every knownBug names a bead", () => {
    expect(knownBugProblems(AREAS)).toEqual([]);
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
  const area = (patch: Partial<Area>): Area => ({ area: "fake", entries: [], pending: [], ...patch });

  test("a missing name, a stale name and a duplicate", () => {
    const one = { fn: fakeRef("a:one"), access: "gm" as const };
    const result = coverageProblems(["a:one", "a:two"], [area({ entries: [one], exempt: { "a:gone": "why" } }), area({ area: "other", entries: [one] })]);
    expect(result).toEqual({ missing: ["a:two"], stale: ["a:gone"], duplicates: ["a:one (fake entry, other entry)"] });
  });

  test("a pending name no longer counts as listed and fails on its own", () => {
    const areas = [area({ pending: ["a:one"] })];
    expect(coverageProblems(["a:one"], areas).missing).toEqual(["a:one"]);
    expect(pendingProblems(areas)).toEqual(["a:one: pending in fake; give it an entry"]);
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
