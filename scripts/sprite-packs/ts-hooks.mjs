// Lets Node 24's built-in type stripping run the sprite-pack scripts and the
// framework-free src/lib modules they import. Those modules import each other
// without file extensions (CH6), which Node's ESM resolver refuses, so this
// sync resolve hook tries `<specifier>.ts` and `<specifier>/index.ts` for
// relative imports. Code reached through it must be erasable TypeScript (no
// enums, no parameter properties, no namespaces). See docs/tasks/TASK-SP-P0.md.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.([cm]?[jt]s|json)$/.test(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      for (const suffix of [".ts", "/index.ts"]) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
    }
    return next(specifier, context);
  },
  // The repo's package.json has no "type", so Node would first try .ts files as
  // CommonJS and warn; every TypeScript file here is an ES module.
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts")) return next(url, { ...context, format: "module-typescript" });
    return next(url, context);
  },
});
