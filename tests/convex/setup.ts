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

export function makeTest() {
  return convexTest(schema, modules);
}
