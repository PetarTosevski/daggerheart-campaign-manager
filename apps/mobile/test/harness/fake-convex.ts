import { assertKnownFunction } from "./convex-functions";
import { fixtureMismatches } from "./convex-returns";
import { convexDir, scanGmFunctions } from "./gm-functions";
import { KNOWN_STALE_FIXTURES } from "./known-stale-fixtures";

/**
 * The fixture's validator problems that are not listed in `KNOWN_STALE_FIXTURES`. With
 * `FIXTURE_LOG=<file>` every problem (listed or not) is appended to that file instead and
 * nothing fails: run the suite that way to see what a fixture fix removed from the list.
 */
function staleFixtureProblems(name: string, value: unknown): string[] {
  const problems = fixtureMismatches(name, value);
  const log = process.env.FIXTURE_LOG;
  if (log !== undefined && problems.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("node:fs") as typeof import("node:fs")).appendFileSync(log, `${problems.join("\n")}\n`);
    return [];
  }
  return problems.filter((problem) => !KNOWN_STALE_FIXTURES.includes(problem));
}

export type Role = "player" | "gm";

/**
 * Mocks keyed by Convex function name. Build each key from the generated api with
 * `fn` (`{ [fn(api.campaigns.fear)]: 4 }`) rather than a hand-written string. Every
 * key, and every function a render subscribes to or calls, must be a public export
 * under `convex/`; anything else throws, so a renamed or moved function fails here.
 *
 * Every query value, and every value a mutation or action handler returns, must also pass
 * that function's `returns` validator (read from the real convex/ modules): a static
 * fixture that does not throws at once, a computed one fails the test when it ends.
 */
export type FakeHandlers = {
  /** Values returned for a subscribed query. A function is called with the args. */
  queries?: Record<string, unknown>;
  mutations?: Record<string, (args: unknown) => unknown>;
  actions?: Record<string, (args: unknown) => unknown>;
};

let gmNames: ReadonlySet<string> | null = null;

function gmFunctionNames(): ReadonlySet<string> {
  gmNames ??= new Set(scanGmFunctions(convexDir()));
  return gmNames;
}

function isHandler(value: unknown): value is (args: unknown) => unknown {
  return typeof value === "function";
}

export type FakeConvex = {
  readonly role: Role;
  /** Every query subscribed during this render, in subscribe order. `"skip"` is not a subscription. */
  readonly subscribed: readonly string[];
  /** Every mutation and action invocation, in call order. */
  readonly called: readonly string[];
  /** Computed fixture values that broke their function's `returns` validator; the test fails on any. */
  readonly fixtureErrors: readonly string[];
  watch(name: string, id: string): void;
  unwatch(name: string, id: string): void;
  queryResult(name: string, args: unknown): unknown;
  call(name: string, args: unknown, kind: "mutation" | "action"): unknown;
};

export function createFakeConvex(role: Role, handlers: FakeHandlers = {}): FakeConvex {
  const subscribed: string[] = [];
  const called: string[] = [];
  const fixtureErrors: string[] = [];
  const checked = (name: string, value: unknown, source: string): unknown => {
    for (const problem of staleFixtureProblems(name, value)) {
      const message = `${source} breaks its returns validator: ${problem}`;
      if (!fixtureErrors.includes(message)) fixtureErrors.push(message);
    }
    return value;
  };
  const active = new Map<string, Set<string>>();
  const addedThisRender = new Map<string, Set<string>>();
  const gm = gmFunctionNames();
  const queries = handlers.queries ?? {};
  const mutations = handlers.mutations ?? {};
  const actions = handlers.actions ?? {};
  for (const [kind, table] of [
    ["queries", queries],
    ["mutations", mutations],
    ["actions", actions],
  ] as const) {
    for (const name of Object.keys(table)) assertKnownFunction(name, `mocked in ${kind}`);
  }
  for (const [name, value] of Object.entries(queries)) {
    if (isHandler(value)) continue;
    const problems = staleFixtureProblems(name, value);
    if (problems.length > 0) {
      throw new Error(`Query fixture breaks its returns validator:\n${problems.join("\n")}`);
    }
  }

  return {
    role,
    subscribed,
    called,
    fixtureErrors,
    watch(name, id) {
      const holders = active.get(name) ?? new Set<string>();
      if (holders.has(id)) return;
      assertKnownFunction(name, "subscribed");
      if (role === "player" && gm.has(name)) {
        subscribed.push(name);
        throw new Error(`Player subscribed to GM function ${name}`);
      }
      const seen = addedThisRender.get(name);
      if (seen !== undefined && !seen.has(id)) {
        throw new Error(`Duplicate subscription ${name}`);
      }
      // A strict-mode remount gets a new id before the previous one is released.
      holders.clear();
      holders.add(id);
      active.set(name, holders);
      const nextSeen = seen ?? new Set<string>();
      nextSeen.add(id);
      addedThisRender.set(name, nextSeen);
      if (!subscribed.includes(name)) subscribed.push(name);
      queueMicrotask(() => {
        const current = addedThisRender.get(name);
        if (current === nextSeen) addedThisRender.delete(name);
      });
    },
    unwatch(name, id) {
      const holders = active.get(name);
      if (holders === undefined) return;
      holders.delete(id);
      if (holders.size === 0) active.delete(name);
    },
    queryResult(name, args) {
      const value = queries[name];
      if (isHandler(value)) return checked(name, value(args), "Query fixture");
      return value;
    },
    call(name, args, kind) {
      called.push(name);
      assertKnownFunction(name, `called as a ${kind}`);
      if (role === "player" && gm.has(name)) {
        throw new Error(`Player called GM function ${name}`);
      }
      const table = kind === "mutation" ? mutations : actions;
      const handler = table[name];
      if (handler === undefined) return undefined;
      const result = handler(args);
      if (result instanceof Promise) {
        return result.then((value: unknown) => checked(name, value, `${kind} handler result`));
      }
      return checked(name, result, `${kind} handler result`);
    },
  };
}
