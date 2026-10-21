/**
 * The runtime inventory of client-callable Convex functions (rule 14, TE2).
 *
 * `publicFunctions()` walks every module under convex/ (the same glob convex-test uses) and keeps the exports that
 * Convex registered as public queries, mutations and actions. `wrapperOf(name)` reads the module's raw source to find
 * which builder from convex/lib/functions.ts defined the export, so the matrix guard can check an entry's access class
 * against the wrapper that really decides access.
 */
import { modules } from "../setup";

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: "?raw"; import: "default" }): Record<string, () => Promise<string>>;
  }
}

const sources = import.meta.glob("../../../convex/**/*.ts", { query: "?raw", import: "default" });

export type FunctionKind = "query" | "mutation" | "action";

/** What Convex attaches to a registered function. */
export type Registered = ((...args: never[]) => unknown) & {
  isPublic?: boolean;
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  exportArgs(): string;
  exportReturns(): string;
};

export type PublicFunction = { name: string; module: string; exportName: string; kind: FunctionKind; fn: Registered };

/** Modules that register no functions (convex.config pulls in component code). */
const CONFIG_MODULES = ["convex.config", "auth.config", "schema"];

function moduleOf(path: string): string {
  return path.replace(/^.*\/convex\//, "").replace(/\.ts$/, "");
}

let cached: Promise<PublicFunction[]> | null = null;

/** Every public query, mutation and action as `<module>:<export>` (module paths keep their folders: `trackers/horizon:get`). */
export function publicFunctions(): Promise<PublicFunction[]> {
  cached ??= (async () => {
    const found: PublicFunction[] = [];
    for (const [path, load] of Object.entries(modules)) {
      const mod = moduleOf(path);
      if (mod.startsWith("_generated/") || CONFIG_MODULES.includes(mod)) continue;
      const exports = (await load()) as Record<string, unknown>;
      for (const [exportName, value] of Object.entries(exports)) {
        const fn = value as Registered | null;
        if (typeof fn !== "function" || !fn.isPublic) continue;
        const kind: FunctionKind | null = fn.isQuery ? "query" : fn.isMutation ? "mutation" : fn.isAction ? "action" : null;
        if (kind === null) continue;
        found.push({ name: `${mod}:${exportName}`, module: mod, exportName, kind, fn });
      }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  })();
  return cached;
}

/** One public function by name; throws (naming it) when it is not in the inventory. */
export async function publicFunction(name: string): Promise<PublicFunction> {
  const found = (await publicFunctions()).find((f) => f.name === name);
  if (found === undefined) throw new Error(`${name} is not a public Convex function.`);
  return found;
}

/** The builders in convex/lib/functions.ts. */
export const WRAPPERS = [
  "userQuery",
  "maybeUserQuery",
  "userMutation",
  "keyedUserMutation",
  "userAction",
  "campaignQuery",
  "campaignMutation",
  "keyedCampaignMutation",
  "gmQuery",
  "gmMutation",
  "keyedGmMutation",
] as const;
export type Wrapper = (typeof WRAPPERS)[number];

export type WrapperInfo = { wrapper: Wrapper; need?: "view" | "edit" | "owner" };

/**
 * The builder that defines `<module>:<export>`, read from the module's raw source: `export const X = <wrapper>({`,
 * plus the `need` option for the campaign builders. Null when the export is not defined by one of the builders (Convex
 * Auth's destructured exports, or a builder this scan does not know, which the guard reports).
 */
export async function wrapperOf(name: string): Promise<WrapperInfo | null> {
  const [module, exportName] = name.split(":");
  const load = Object.entries(sources).find(([path]) => moduleOf(path) === module)?.[1];
  if (load === undefined) return null;
  const source = await load();
  const start = source.search(new RegExp(`export const ${exportName} = (\\w+)\\(`));
  if (start === -1) return null;
  const wrapper = /export const \w+ = (\w+)\(/.exec(source.slice(start))?.[1];
  if (wrapper === undefined || !(WRAPPERS as readonly string[]).includes(wrapper)) return null;
  // The definition runs to the next top-level export; its options come before the handler.
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport /);
  const body = next === -1 ? rest : rest.slice(0, next);
  const options = body.slice(0, Math.max(0, body.indexOf("handler")) || body.length);
  const need = /\bneed:\s*"(view|edit|owner)"/.exec(options)?.[1] as WrapperInfo["need"];
  return need === undefined ? { wrapper: wrapper as Wrapper } : { wrapper: wrapper as Wrapper, need };
}
