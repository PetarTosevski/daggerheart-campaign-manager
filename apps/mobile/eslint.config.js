const expo = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expo,
  {
    ignores: ["dist-android/**", "dist-ios/**", ".expo/**", "node_modules/**"],
  },
  // CH2 (docs/best-practices.md): typed lint, as on the web. Warnings first
  // (CH4); raise to errors once apps/mobile is clean.
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        // CommonJS config file: Node defines __dirname.
        // eslint-disable-next-line no-undef
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": [
        "warn",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
    },
  },
  // The phone shares the website's framework-free code (src/lib, convex/,
  // a few pure modules under src/components) but never its routes, Next.js
  // or the web-only `@/` alias (CH6).
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message: "Next.js does not run in React Native.",
            },
            {
              group: ["@/*"],
              message:
                "`@/` is the website's alias; Metro cannot resolve it. Use a relative import of src/lib.",
            },
            {
              regex: "^(\\.\\./)+src/app(/|$)",
              message:
                "Route code is web-only; share logic through the website's src/lib.",
            },
          ],
        },
      ],
    },
  },
]);
