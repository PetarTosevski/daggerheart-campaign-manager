/**
 * The unauthenticated sweep (plan d12-hardening, tracer H15; analysis section 3; rule 14). For every public Convex
 * function the runtime inventory finds (`publicFunctions()`, no hand-written list, so a function added tomorrow is swept
 * the day it lands, whether or not the authz matrix lists it yet), with arguments synthesized from its own validator:
 *
 * - signed out, the call must throw `ConvexError` code UNAUTHENTICATED (the two `maybeUserQuery` reads return null);
 * - as a signed-in stranger (a verified account that is in no campaign), it must show nothing: NOT_FOUND,
 *   FORBIDDEN, null or an empty list/object. Only the functions on the caller's own rows (`STRANGER_OWN`) are skipped.
 *
 * The world is the matrix world (tests/convex/authz/world.ts): a real campaign with a GM, players and characters. Every
 * area's `setup` from tests/convex/authz/*.entries.ts runs on it when it can (best effort), so as areas grow the sweep
 * aims at more real rows; an id for a table that still has no row is a well-formed id of a missing document (the
 * stranger must then answer NOT_FOUND or null like for any id it may not see). Errors are asserted on
 * `ConvexError.data.code`, never on message text (TE1). How it was proven: docs/tasks/TASK-D12-H15.md.
 */
import { getFunctionName, makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import type { TableNames } from "../../convex/_generated/dataModel";
import type { Area, Entry } from "./authz/harness";
import { publicFunctions, wrapperOf, type PublicFunction } from "./authz/inventory";
import { NAME_HINTS, synthArgs } from "./authz/synth";
import { buildWorld, type Client, type World } from "./authz/world";

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { eager: true; import: "default" }): Record<string, unknown>;
  }
}

/** Public functions no wrapper defines, so the sweep does not call them: Convex Auth's own entry points. */
export const EXEMPT: Record<string, string> = {
  "auth:signIn": "Convex Auth: signing in is what a signed-out caller does",
  "auth:signOut": "Convex Auth: signs out the current session, if any",
  "auth:isAuthenticated": "Convex Auth: answers false to a signed-out caller by design",
};

/**
 * The `user` class (analysis 2.3): functions on the caller's own rows, which a stranger may call like anyone signed in.
 * `users:viewer` (maybeUserQuery) returns the caller's own account. Everything else must show a stranger nothing.
 */
export const STRANGER_OWN: Record<string, string> = {
  "campaigns:list": "the caller's own campaigns (a stranger's is empty)",
  "campaigns:create": "starts a campaign the caller owns",
  "settings:get": "the caller's own settings",
  "settings:update": "the caller's own settings",
  "members:joinByCode": "joins with a code the caller was given (a wrong code is NOT_FOUND)",
  "users:viewer": "the caller's own account",
};

const AREAS = Object.values(import.meta.glob("./authz/*.entries.ts", { eager: true, import: "default" }) as Record<string, Area>);

/** The matrix area and entry that list a function: reused, never required. */
function listing(name: string): { area: Area; entry: Entry } | null {
  for (const area of AREAS) {
    const entry = area.entries.find((e) => getFunctionName(e.fn) === name);
    if (entry !== undefined) return { area, entry };
  }
  return null;
}

const INVENTORY = await publicFunctions();
const SWEPT = INVENTORY.filter((f) => !(f.name in EXEMPT));
/** maybeUserQuery reads answer a signed-out caller with null instead of throwing. */
const MAYBE = new Set((await Promise.all(SWEPT.map(async (f) => ((await wrapperOf(f.name))?.wrapper === "maybeUserQuery" ? f.name : null)))).filter((n) => n !== null));

/** A well-formed convex-test id (digits, then the table name) of a document that does not exist. */
function missingId(table: string): string {
  return "9".repeat(Math.max(4, 32 - table.length)) + table;
}

/** The world with `idOf` falling back to a missing document's id for tables that have no row. */
function sweepWorld(w: World): World {
  return {
    ...w,
    idOf: async (table: TableNames) => {
      try {
        return await w.idOf(table);
      } catch {
        return missingId(table);
      }
    },
  };
}

/**
 * GM calls that put one row in the tables most functions take an id of (combat map, tokens, objects, encounter and its
 * adversary, session, notes page, sprite pack, custom adversary), with synthesized arguments, so the stranger is
 * refused a real row of another campaign rather than a missing one.
 */
const SEEDS = [
  "combatMaps:create",
  "combatTokens:addParty",
  "combatTokens:addCustom",
  "combatMapEdit:addObject",
  "customAdversaries:create",
  "encounters:create",
  "encounters:addAdversary",
  "sessionRecords:create",
  "notes:createPage",
  "spritePacks:createPack",
];

let current: Promise<World> | null = null;
/** The shared world; a call that may have written (a mutation that resolved, any action) retires it. */
function world(): Promise<World> {
  current ??= (async () => {
    const w = sweepWorld(await buildWorld());
    for (const area of AREAS) {
      try {
        await area.setup?.(w);
      } catch {
        // Best effort: an area's setup may need its own frame or world options; its tables then use missing ids.
      }
    }
    for (const name of SEEDS) {
      const f = INVENTORY.find((g) => g.name === name);
      if (f === undefined) continue;
      try {
        await call(w.as("gm"), f, await synthArgs(f.fn.exportArgs(), w), { keepWorld: true });
      } catch {
        // Best effort, like the area setups: a seed that needs more than synthesized arguments leaves its table empty.
      }
    }
    return w;
  })();
  return current;
}

type Observed = { value: unknown } | { code: string };

async function call(client: Client, f: PublicFunction, args: Record<string, unknown>, { keepWorld = false } = {}): Promise<Observed> {
  const ref = makeFunctionReference<typeof f.kind>(f.name);
  const run = (f.kind === "query" ? client.query : f.kind === "mutation" ? client.mutation : client.action) as unknown as (
    ref: unknown,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  try {
    const value = await run(ref, args);
    if (f.kind !== "query" && !keepWorld) current = null;
    return { value };
  } catch (error) {
    if (f.kind === "action" && !keepWorld) current = null;
    const data = error !== null && typeof error === "object" && "data" in error ? (error as { data: unknown }).data : undefined;
    // Rule 9 / TE1: an expected refusal is ConvexError<{ code }>. Anything else (a validator error, a TypeError, a string
    // payload) fails the row with the original error.
    if (data === null || typeof data !== "object" || typeof (data as { code?: unknown }).code !== "string") throw error;
    return { code: (data as { code: string }).code };
  }
}

function describeObserved(o: Observed): string {
  return "code" in o ? `ConvexError ${o.code}` : `value ${JSON.stringify(o.value)?.slice(0, 300)}`;
}

function isNothing(o: Observed): boolean {
  if ("code" in o) return o.code === "NOT_FOUND" || o.code === "FORBIDDEN";
  const v = o.value;
  if (v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return typeof v === "object" && Object.keys(v as object).length === 0;
}

function holdsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some(holdsUndefined);
}

/**
 * Arguments from the function's validator, with its matrix area's name hints and its matrix entry's `args` when it has
 * them (they pass validation that runs before the access check, such as a non-zero delta; TASK-D12-H0 pitfalls).
 */
async function argsFor(f: PublicFunction): Promise<{ w: World; args: Record<string, unknown> }> {
  const w = await world();
  const listed = listing(f.name);
  // An area hint or entry arg reading an id its own setup registers finds nothing here (undefined): the synthesized
  // value stands, as for any field without a hint.
  const areaHints = Object.entries(listed?.area.nameHints ?? {}).map(([name, hint]) => [
    name,
    typeof hint === "function" ? (hw: World) => hint(hw) ?? "x" : hint,
  ]);
  const synthesized = await synthArgs(f.fn.exportArgs(), w, { ...NAME_HINTS, ...Object.fromEntries(areaHints) });
  let overrides: Record<string, unknown> = {};
  try {
    overrides = (await listed?.entry.args?.(w)) ?? {};
  } catch {
    overrides = {};
  }
  const defined = Object.entries(overrides).filter(([, value]) => !holdsUndefined(value));
  return { w, args: { ...synthesized, ...Object.fromEntries(defined) } };
}

describe("unauthenticated sweep", () => {
  it("finds the public functions at runtime and lists only real exemptions", () => {
    const names = INVENTORY.map((f) => f.name);
    expect(names.length).toBeGreaterThan(300);
    expect(Object.keys(EXEMPT).filter((n) => !names.includes(n))).toEqual([]);
    expect(Object.keys(STRANGER_OWN).filter((n) => !names.includes(n))).toEqual([]);
    expect([...MAYBE].sort()).toEqual(["campaigns:get", "users:viewer"]);
  });

  describe("signed out: refused", () => {
    for (const f of SWEPT) {
      const expected = MAYBE.has(f.name) ? "null" : "UNAUTHENTICATED";
      it(`${f.name} -> ${expected}`, async () => {
        const { w, args } = await argsFor(f);
        const observed = await call(w.as("anon"), f, args);
        if (expected === "null") expect(observed, `${f.name} signed out: ${describeObserved(observed)}`).toEqual({ value: null });
        else expect(observed, `${f.name} signed out: ${describeObserved(observed)}`).toEqual({ code: "UNAUTHENTICATED" });
      }, 30_000);
    }
  });

  describe("signed-in stranger: shows nothing", () => {
    for (const f of SWEPT.filter((f) => !(f.name in STRANGER_OWN))) {
      it(`${f.name} -> NOT_FOUND | FORBIDDEN | null | empty`, async () => {
        const { w, args } = await argsFor(f);
        const observed = await call(w.as("outsider"), f, args);
        expect(isNothing(observed), `${f.name} as a stranger: ${describeObserved(observed)}`).toBe(true);
      }, 30_000);
    }
  });
});
