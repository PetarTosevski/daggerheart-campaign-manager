// Lets Node load the repo's convex/ modules straight from TypeScript (run with
// --experimental-transform-types, which also handles parameter properties).
// convex/ imports without file extensions, which Node's ESM resolver refuses, so
// relative imports try `.ts`, `/index.ts` and `.js` (convex/_generated is .js).
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.([cm]?[jt]s|json)$/.test(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      for (const suffix of [".ts", "/index.ts", ".js"]) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts")) return next(url, { ...context, format: "module-typescript" });
    return next(url, context);
  },
});
