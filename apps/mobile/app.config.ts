import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * One identity per EAS build profile (`eas.json` sets `APP_VARIANT`), so a development or preview
 * build installs beside the store app instead of replacing it, and never signs in as it.
 * Apple's identity token carries the bundle id as its audience: the server's list
 * (`convex/lib/appleIdentity.ts`) must name each of these.
 */
const variants = {
  production: { bundleId: "com.dualityheart.mobile", scheme: "dualityheart", name: "Duality Heart" },
  preview: { bundleId: "com.dualityheart.mobile.preview", scheme: "dualityheart-preview", name: "Duality Heart (preview)" },
  development: { bundleId: "com.dualityheart.mobile.dev", scheme: "dualityheart-dev", name: "Duality Heart (dev)" },
} as const;

type Variant = keyof typeof variants;

function variantOf(value: string | undefined): Variant {
  if (value === undefined || value === "" || value === "production") return "production";
  if (value === "preview" || value === "development") return value;
  throw new Error(`APP_VARIANT must be development, preview or production, not ${value}`);
}

/** The app's background (`colors.ink`); also behind the status bar and the splash. */
const ink = "#0c0b11";

export default ({ config }: ConfigContext): ExpoConfig => {
  const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (typeof convexUrl !== "string" || convexUrl.trim().length === 0) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL is not set");
  }

  const { bundleId, scheme, name } = variants[variantOf(process.env.APP_VARIANT)];

  return {
    ...config,
    name,
    slug: "dualityheart",
    scheme,
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    // The palette is dark only (the website has no light theme): a system light mode must not
    // turn the status bar's text dark on the ink background, where it would be invisible.
    userInterfaceStyle: "dark",
    backgroundColor: ink,
    androidStatusBar: { barStyle: "light-content", backgroundColor: ink },
    ios: {
      bundleIdentifier: bundleId,
      usesAppleSignIn: true,
      infoPlist: {
        UIStatusBarStyle: "UIStatusBarStyleLightContent",
      },
    },
    android: {
      package: bundleId,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1a1408",
      },
    },
    plugins: ["expo-router", "expo-apple-authentication"],
  };
};
