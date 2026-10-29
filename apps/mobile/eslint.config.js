const expo = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expo,
  {
    ignores: ["dist-android/**", "dist-ios/**", ".expo/**", "node_modules/**"],
  },
]);
