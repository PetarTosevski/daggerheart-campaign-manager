import { convexTest } from "convex-test";

import schema from "../../convex/schema";

// `import.meta.glob` is provided by Vite (which runs vitest); declared here
// because Vite's client types are not a direct dependency.
declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

export const modules = import.meta.glob("../../convex/**/*.ts");

// The components' test helpers reference vite/client types, which clash with
// the ImportMeta declaration above, so tsc must not follow these imports.
type ComponentTestHelper = { default: { register: (t: unknown, name?: string) => void } };
const RATE_LIMITER_TEST = "@convex-dev/rate-limiter/test";
const MIGRATIONS_TEST = "@convex-dev/migrations/test";
const rateLimiter = ((await import(/* @vite-ignore */ RATE_LIMITER_TEST)) as ComponentTestHelper).default;
const migrations = ((await import(/* @vite-ignore */ MIGRATIONS_TEST)) as ComponentTestHelper).default;

/** A convex-test instance with every component in convex/convex.config.ts registered. */
export function makeTest() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  migrations.register(t);
  return t;
}
