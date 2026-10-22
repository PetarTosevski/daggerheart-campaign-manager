/**
 * The authz matrix runner (rule 14, TE2; analysis section 2). Each area file (`<area>.entries.ts`) lists its functions
 * as entries; `<area>.test.ts` calls `runMatrix(area)`, which runs every entry for the roles of its access class on
 * worlds no earlier row changed and asserts each outcome on `ConvexError.data.code`. The guard in tests/convex/authz-matrix.test.ts
 * checks that the areas together list every public function exactly once. The API is documented in
 * docs/tasks/TASK-D12-H0.md.
 */
import { getFunctionName, type FunctionReference } from "convex/server";
import { beforeAll, describe, expect, it } from "vitest";

import { publicFunction, publicFunctions, type FunctionKind } from "./inventory";
import { NAME_HINTS, synthArgs, type NameHints } from "./synth";
import { buildWorld, ROLES, allowWorldEmails, type Role, type World, type WorldOptions } from "./world";

export type { Role, World } from "./world";

/** What a role's call must do. */
export type Outcome =
  /** Refused: signed out. */
  | "UNAUTHENTICATED"
  /** Refused without revealing that the resource exists. */
  | "NOT_FOUND"
  /** Refused: the caller can see the resource but lacks the permission. */
  | "FORBIDDEN"
  /** Allowed: resolves (any value), or throws a ConvexError whose code is in `okCodes`. */
  | "ok"
  /** Resolves to null (a query hiding what the caller may not see). */
  | "null"
  /** Resolves to [] or {} (a list filtered to nothing for the caller). */
  | "empty";

/**
 * The access class, which must agree with the wrapper (the guard checks it):
 * gm* → `gm`; campaign* `need: "view"` → `view`; `need: "edit"` → `edit`; user* → `own`, `scoped` or `user`;
 * maybeUserQuery → `maybe`.
 */
export type Access = "gm" | "view" | "edit" | "own" | "scoped" | "user" | "maybe";

export const ACCESS_CODES = ["UNAUTHENTICATED", "NOT_FOUND", "FORBIDDEN"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any public query, mutation or action
type AnyPublicFunction = FunctionReference<any, "public">;

export type Entry = {
  fn: AnyPublicFunction;
  access: Access;
  /** Overrides on top of the synthesized arguments. */
  args?: (w: World) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Overrides of the class defaults; adds a row for a role the class does not run. `scoped` must state every role. */
  expect?: Partial<Record<Role, Outcome>>;
  /** Domain codes that still mean "access granted" (never an access code). */
  okCodes?: string[];
  /** Extra state for this entry, run after the area's setup on every world the entry builds. */
  setup?: (w: World) => Promise<void>;
  /** World options for this entry (another frame), over the area's. */
  world?: WorldOptions;
  /** An open bead id (`dcm-...`): the expectations are correct but the code is not yet; all rows run as one it.fails. */
  knownBug?: string;
  note?: string;
};

export type Area = {
  area: string;
  /** World options for every entry of the area (for example a frame). */
  world?: WorldOptions;
  /** Extra state for every world of the area (a combat map, an encounter...), run before the entry's setup. */
  setup?: (w: World) => Promise<void>;
  /** NAME_HINTS additions or replacements for this area's string ids. */
  nameHints?: NameHints;
  entries: Entry[];
  /**
   * Always empty. D12 H24 removed pending support: every public function needs an entry (or an exemption), and the
   * guard fails on any name listed here. The field stays only because the area files still carry `pending: []`.
   */
  pending: string[];
  /** Public functions the matrix does not run, with the reason (the Convex Auth exports). */
  exempt?: Record<string, string>;
};

/** Class defaults (analysis 2.3). `scoped` has none; `own` depends on the function kind. */
export function defaultExpectations(access: Access, kind: FunctionKind): Partial<Record<Role, Outcome>> {
  switch (access) {
    case "gm":
      return { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", gm: "ok" };
    case "view":
      return { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "ok", gm: "ok" };
    case "edit":
      return { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", grantee: "ok", gm: "ok" };
    case "own":
      // Party members view each other's characters (rolePermission): reads are ok for playerB, writes are not.
      return {
        anon: "UNAUTHENTICATED",
        outsider: "NOT_FOUND",
        otherPlayer: kind === "query" ? "ok" : "FORBIDDEN",
        player: "ok",
        gm: "ok",
      };
    case "user":
      return { anon: "UNAUTHENTICATED", outsider: "ok", player: "ok", gm: "ok" };
    case "maybe":
      return { anon: "null", outsider: "ok", player: "ok", gm: "ok" };
    case "scoped":
      return {};
  }
}

/** Roles every `scoped` entry must state. */
export const SCOPED_REQUIRED: readonly Role[] = ["anon", "outsider", "player", "gm"];

/** Problems with an entry's declaration (also checked by the guard for every area). */
export function entryProblems(entry: Entry): string[] {
  const name = getFunctionName(entry.fn);
  const problems: string[] = [];
  if (entry.access === "scoped") {
    const missing = SCOPED_REQUIRED.filter((role) => entry.expect?.[role] === undefined);
    if (missing.length > 0) problems.push(`${name}: scoped entries state every role (missing ${missing.join(", ")})`);
  }
  const access = (entry.okCodes ?? []).filter((code) => (ACCESS_CODES as readonly string[]).includes(code));
  if (access.length > 0) problems.push(`${name}: okCodes may not contain access codes (${access.join(", ")})`);
  return problems;
}

/** Role → expected outcome, in run order. */
export function expectations(entry: Entry, kind: FunctionKind): [Role, Outcome][] {
  const merged = { ...defaultExpectations(entry.access, kind), ...entry.expect };
  return ROLES.filter((role) => merged[role] !== undefined).map((role) => [role, merged[role]!]);
}

/** What a call did: resolved to a value, or threw a ConvexError with an object payload. */
type Observed = { value: unknown } | { code: string };

async function observe(call: () => Promise<unknown>): Promise<Observed> {
  try {
    return { value: await call() };
  } catch (error) {
    if (error === null || typeof error !== "object" || !("data" in error)) throw error;
    const data = (error as { data: unknown }).data;
    // Rule 9 / TE1: every expected error is ConvexError<{ code, message? }>. A string payload fails here.
    if (data === null || typeof data !== "object" || typeof (data as { code?: unknown }).code !== "string") {
      throw new Error(`ConvexError payload is not an object with a code: ${JSON.stringify(data)}`);
    }
    return { code: (data as { code: string }).code };
  }
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value !== null && typeof value === "object" && Object.keys(value).length === 0;
}

/** Null when the observation matches, else what went wrong. */
function mismatch(observed: Observed, expected: Outcome, okCodes: readonly string[]): string | null {
  const got = "code" in observed ? observed.code : JSON.stringify(observed.value)?.slice(0, 200);
  const fail = `expected ${expected}, got ${"code" in observed ? `ConvexError ${got}` : `value ${got}`}`;
  switch (expected) {
    case "ok":
      return "value" in observed || okCodes.includes(observed.code) ? null : fail;
    case "null":
      return "value" in observed && observed.value === null ? null : fail;
    case "empty":
      return "value" in observed && isEmpty(observed.value) ? null : fail;
    default:
      return "code" in observed && observed.code === expected ? null : fail;
  }
}

/** The per-test timeout for matrix rows (a row may build a world). */
export const ROW_TIMEOUT = 30_000;

type Resolved = { name: string; kind: FunctionKind; exportArgs: string };

/**
 * The world an entry's next row runs on. Every row sees a world no earlier row changed: a query changes nothing, and
 * a refused (throwing) mutation is rolled back by Convex, so the next row reuses that world; a mutation that resolved
 * (committed) or any action (it may commit through other functions) retires it, and the next row builds a fresh one.
 */
class WorldSlot {
  private current: Promise<World> | null = null;
  constructor(
    private readonly area: Area,
    private readonly entry: Entry,
  ) {}

  get(): Promise<World> {
    this.current ??= (async () => {
      const w = await buildWorld({ ...this.area.world, ...this.entry.world });
      await this.area.setup?.(w);
      await this.entry.setup?.(w);
      return w;
    })();
    return this.current;
  }

  retire() {
    this.current = null;
  }
}

/** Runs one row: synthesizes arguments, calls as `role`, returns the mismatch or null. */
async function runRow(area: Area, entry: Entry, fn: Resolved, role: Role, expected: Outcome, slot: WorldSlot) {
  const w = await slot.get();
  const args = { ...(await synthArgs(fn.exportArgs, w, { ...NAME_HINTS, ...area.nameHints })), ...(await entry.args?.(w)) };
  const client = w.as(role);
  // FunctionReference<any> erases the argument type: the function's validator checks the synthesized args at run time.
  // convex-test's accessors are plain closures, so they can be called unbound.
  const call = (fn.kind === "query" ? client.query : fn.kind === "mutation" ? client.mutation : client.action) as unknown as (
    ref: AnyPublicFunction,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  let observed: Observed;
  try {
    observed = await observe(() => call(entry.fn, args));
  } finally {
    // A mutation that threw was rolled back; anything else that ran may have written.
    if (fn.kind === "action") slot.retire();
  }
  if (fn.kind === "mutation" && "value" in observed) slot.retire();
  const problem = mismatch(observed, expected, entry.okCodes ?? []);
  return problem === null ? null : `${fn.name} as ${role}: ${problem}`;
}

/**
 * Declares the vitest suite for one area: a describe per entry with an it per role (one it.fails for a knownBug entry).
 * Rows run in ROLES order on worlds no earlier row changed (see WorldSlot).
 */
export function runMatrix(area: Area) {
  describe(`authz matrix: ${area.area}`, () => {
    allowWorldEmails();
    // Loading every convex module takes a few seconds on a busy machine; do it once, outside the rows' timeouts.
    beforeAll(() => publicFunctions(), 120_000);

    for (const entry of area.entries) {
      const name = getFunctionName(entry.fn);
      describe(`${name} [${entry.access}]`, () => {
        let resolved: Promise<Resolved> | null = null;
        const resolve = () =>
          (resolved ??= publicFunction(name).then((f) => {
            const problems = entryProblems(entry);
            if (problems.length > 0) throw new Error(problems.join("\n"));
            return { name, kind: f.kind, exportArgs: f.fn.exportArgs() };
          }));
        const slot = new WorldSlot(area, entry);

        if (entry.knownBug !== undefined) {
          it.fails(
            `all rows (knownBug ${entry.knownBug})`,
            async () => {
              const fn = await resolve();
              const problems: string[] = [];
              for (const [role, expected] of expectations(entry, fn.kind)) {
                const problem = await runRow(area, entry, fn, role, expected, slot);
                if (problem !== null) problems.push(problem);
              }
              expect(problems).toEqual([]);
            },
            ROW_TIMEOUT * 2,
          );
          return;
        }

        // Test names are declared before the function's kind is known (the inventory loads asynchronously). The roles
        // are the same for every kind; only `own`'s otherPlayer outcome differs, and the test resolves it.
        for (const role of expectations(entry, "mutation").map(([r]) => r)) {
          it(
            role,
            async () => {
              const fn = await resolve();
              const expected = Object.fromEntries(expectations(entry, fn.kind))[role]!;
              expect(await runRow(area, entry, fn, role, expected, slot)).toBeNull();
            },
            ROW_TIMEOUT,
          );
        }
      });
    }
  });
}
