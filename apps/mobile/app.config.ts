import type { ConfigContext, ExpoConfig } from "expo/config";

const productionBundleId = "com.dualityheart.mobile";
const developmentBundleId = "com.dualityheart.mobile.dev";

export default ({ config }: ConfigContext): ExpoConfig => {
  const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (typeof convexUrl !== "string" || convexUrl.trim().length === 0) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL is not set");
  }

  const development = process.env.APP_VARIANT === "development";
  const bundleId = development ? developmentBundleId : productionBundleId;

  return {
    ...config,
    name: "Duality Heart",
    slug: "dualityheart",
    scheme: development ? "dualityheart-dev" : "dualityheart",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: bundleId,
    },
    android: {
      package: bundleId,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1a1408",
      },
    },
    plugins: ["expo-router"],
  };
};
