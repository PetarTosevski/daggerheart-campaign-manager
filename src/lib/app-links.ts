/**
 * The phone app's link files (dcm-gdzi.41): `/.well-known/apple-app-site-association` (iOS universal links) and
 * `/.well-known/assetlinks.json` (Android verified app links). They prove that the site hands `https://<site>/auth`,
 * where Google sign-in returns (`convex/lib/nativeRedirect.ts`), to the phone app only, never to another app.
 *
 * The values come from the web app's environment, read on each request (`docs/deploy.md`, "Phone sign-in links"):
 * - `APPLE_TEAM_ID`: the 10-character Apple Developer Team ID;
 * - `APPLE_BUNDLE_IDS`: comma-separated bundle ids (`apps/mobile/app.config.ts`);
 * - `ANDROID_PACKAGE_NAMES`: comma-separated Android package names (the same ids);
 * - `ANDROID_SHA256_CERT_FINGERPRINTS`: comma-separated SHA-256 fingerprints of the signing certificates.
 * A missing or malformed value leaves that platform out: the file is still valid, it just names no app, so the phone's
 * Google sign-in fails safely (back to the sign-in screen) instead of the site breaking.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** The only path the app claims; every other link on the site keeps opening in the browser. */
const APP_LINK_PATH = "/auth";

const TEAM_ID = /^[A-Z0-9]{10}$/;
const APP_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/** The distinct, well-formed entries of a comma-separated value. */
function list(value: string | undefined, valid: RegExp, normalize: (entry: string) => string = (entry) => entry): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => normalize(entry.trim()))
    .filter((entry) => valid.test(entry));
  return [...new Set(entries)];
}

type AppleAppSiteAssociation = {
  applinks: {
    details: { appIDs: string[]; components: { "/": string; comment: string }[] }[];
  };
};

/** The AASA document: the app ids `<team>.<bundle>` that may open `/auth`, or no details when unset. */
export function appleAppSiteAssociation(env: Env): AppleAppSiteAssociation {
  const team = (env.APPLE_TEAM_ID ?? "").trim().toUpperCase();
  const bundles = list(env.APPLE_BUNDLE_IDS, APP_ID);
  if (!TEAM_ID.test(team) || bundles.length === 0) return { applinks: { details: [] } };
  return {
    applinks: {
      details: [
        {
          appIDs: bundles.map((bundle) => `${team}.${bundle}`),
          components: [{ "/": APP_LINK_PATH, comment: "Google sign-in returns here (convex/lib/nativeRedirect.ts)" }],
        },
      ],
    },
  };
}

type AssetLinkStatement = {
  relation: string[];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
};

/** The Digital Asset Links statements: one per package with every fingerprint, or `[]` when unset. */
export function assetLinks(env: Env): AssetLinkStatement[] {
  const packages = list(env.ANDROID_PACKAGE_NAMES, ANDROID_PACKAGE);
  const fingerprints = list(env.ANDROID_SHA256_CERT_FINGERPRINTS, FINGERPRINT, (entry) => entry.toUpperCase());
  if (packages.length === 0 || fingerprints.length === 0) return [];
  return packages.map((packageName) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
  }));
}

/** A JSON answer as both platforms want it: 200, `application/json`, no redirect; cached briefly so a fix lands soon. */
export function appLinkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}
