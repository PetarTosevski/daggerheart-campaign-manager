import { convexDir, scanGmFunctions } from "./gm-functions";

export type Role = "player" | "gm";

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
  watch(name: string, id: string): void;
  unwatch(name: string, id: string): void;
  queryResult(name: string, args: unknown): unknown;
  call(name: string, args: unknown, kind: "mutation" | "action"): unknown;
};

export function createFakeConvex(role: Role, handlers: FakeHandlers = {}): FakeConvex {
  const subscribed: string[] = [];
  const called: string[] = [];
  const active = new Map<string, Set<string>>();
  const gm = gmFunctionNames();
  const queries = handlers.queries ?? {};
  const mutations = handlers.mutations ?? {};
  const actions = handlers.actions ?? {};

  return {
    role,
    subscribed,
    called,
    watch(name, id) {
      const holders = active.get(name);
      if (holders?.has(id)) return;
      if (role === "player" && gm.has(name)) {
        subscribed.push(name);
        throw new Error(`Player subscribed to GM function ${name}`);
      }
      if (holders !== undefined && holders.size > 0) {
        throw new Error(`Duplicate subscription ${name}`);
      }
      const next = holders ?? new Set<string>();
      next.add(id);
      active.set(name, next);
      subscribed.push(name);
    },
    unwatch(name, id) {
      const holders = active.get(name);
      if (holders === undefined) return;
      holders.delete(id);
      if (holders.size === 0) active.delete(name);
    },
    queryResult(name, args) {
      const value = queries[name];
      if (isHandler(value)) return value(args);
      return value;
    },
    call(name, args, kind) {
      called.push(name);
      if (role === "player" && gm.has(name)) {
        throw new Error(`Player called GM function ${name}`);
      }
      const table = kind === "mutation" ? mutations : actions;
      const handler = table[name];
      if (handler !== undefined) return handler(args);
      return undefined;
    },
  };
}
