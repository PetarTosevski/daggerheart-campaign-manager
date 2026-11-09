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

/**
 * The website this build signs in through (`EXPO_PUBLIC_SITE_URL`, set per build profile in `eas.json`; the same default
 * as `src/auth/google.ts`). Google returns to `https://<host>/auth`, which the app claims as an iOS universal link and
 * an Android verified app link; the site proves the claim with `/.well-known/apple-app-site-association` and
 * `/.well-known/assetlinks.json` (`src/lib/app-links.ts` in the web app, dcm-gdzi.41).
 */
function siteHost(value: string | undefined): string {
  const site = value === undefined || value.trim() === "" ? "https://dualityheart.com" : value.trim();
  let url: URL | null = null;
  try {
    url = new URL(site);
  } catch {
    url = null;
  }
  if (url?.protocol !== "https:") throw new Error(`EXPO_PUBLIC_SITE_URL must be an https URL, not ${site}`);
  return url.host;
}

/** The app's background (`colors.ink`); also behind the status bar and the splash. */
const ink = "#0c0b11";

export default ({ config }: ConfigContext): ExpoConfig => {
  // Read through a local so babel-preset-expo does not inline the `EXPO_PUBLIC_*` values when jest loads this file.
  const env = process.env;
  const convexUrl = env.EXPO_PUBLIC_CONVEX_URL;
  if (typeof convexUrl !== "string" || convexUrl.trim().length === 0) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL is not set");
  }

  const { bundleId, scheme, name } = variants[variantOf(env.APP_VARIANT)];
  const host = siteHost(env.EXPO_PUBLIC_SITE_URL);

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
      associatedDomains: [`applinks:${host}`],
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
      // Only `/auth` (Google's return): every other link on the site keeps opening in the browser.
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host, path: "/auth" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    plugins: [
      "expo-router",
      "expo-apple-authentication",
      // The splash the root layout holds until the brand fonts load (src/shell/splash-gate.ts).
      ["expo-splash-screen", { backgroundColor: ink, image: "./assets/icon.png", imageWidth: 160 }],
    ],
  };
};
