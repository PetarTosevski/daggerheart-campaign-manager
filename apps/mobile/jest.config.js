/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/test/**/*.test.ts", "<rootDir>/test/**/*.test.tsx"],
  // One copy of convex, the one installed for this package, as Metro's singletonRoots (metro.config.js). Shared website
  // code under ../../src would otherwise load the repo root's copy, and its ConvexError would not be the class the
  // phone's errorMessage checks, so error codes would not map in tests.
  moduleNameMapper: {
    "^convex$": "<rootDir>/node_modules/convex",
    "^convex/(.*)$": "<rootDir>/node_modules/convex/$1",
  },
};
