// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const mobileNodeModules = path.resolve(projectRoot, "node_modules");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// getDefaultConfig already watches workspace packages. The repo root has to be
// watched too: convex/_generated stays next to the Next.js app.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver.nodeModulesPaths = [
  mobileNodeModules,
  path.resolve(workspaceRoot, "node_modules"),
];

// One physical copy of each, the one installed for this package. `convex/*`
// covers convex/server, convex/values, and the rest of the public subpaths.
const singletonRoots = ["convex", "react", "react-native"];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const singleton = singletonRoots.find(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  if (singleton) {
    return context.resolveRequest(
      {
        ...context,
        originModulePath: path.join(mobileNodeModules, singleton, "package.json"),
      },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
