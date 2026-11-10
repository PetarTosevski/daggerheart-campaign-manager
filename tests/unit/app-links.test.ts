import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getAasa } from "../../src/app/.well-known/apple-app-site-association/route";
import { GET as getAssetLinks } from "../../src/app/.well-known/assetlinks.json/route";
import { appleAppSiteAssociation, assetLinks } from "../../src/lib/app-links";

const FP_A = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
const FP_B = Array.from({ length: 32 }, () => "AB").join(":");

const VARS = ["APPLE_TEAM_ID", "APPLE_BUNDLE_IDS", "ANDROID_PACKAGE_NAMES", "ANDROID_SHA256_CERT_FINGERPRINTS"] as const;

function clearEnv() {
  for (const name of VARS) vi.stubEnv(name, undefined);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apple-app-site-association (dcm-gdzi.41)", () => {
  it("names <team>.<bundle> for each bundle id and claims only /auth", () => {
    expect(
      appleAppSiteAssociation({ APPLE_TEAM_ID: "abcde12345", APPLE_BUNDLE_IDS: "com.dualityheart.mobile, com.dualityheart.mobile.preview" }),
    ).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["ABCDE12345.com.dualityheart.mobile", "ABCDE12345.com.dualityheart.mobile.preview"],
            components: [{ "/": "/auth", comment: expect.any(String) }],
          },
        ],
      },
    });
  });

  it.each([
    ["no env", {}],
    ["no team id", { APPLE_BUNDLE_IDS: "com.dualityheart.mobile" }],
    ["no bundle id", { APPLE_TEAM_ID: "ABCDE12345" }],
    ["a malformed team id", { APPLE_TEAM_ID: "ABC", APPLE_BUNDLE_IDS: "com.dualityheart.mobile" }],
    ["only malformed bundle ids", { APPLE_TEAM_ID: "ABCDE12345", APPLE_BUNDLE_IDS: "not a bundle, ," }],
  ])("with %s it is valid and names no app", (_, env) => {
    expect(appleAppSiteAssociation(env)).toEqual({ applinks: { details: [] } });
  });

  it("the route answers 200 JSON from the env read on each request", async () => {
    clearEnv();
    const empty = getAasa();
    expect(empty.status).toBe(200);
    expect(empty.headers.get("content-type")).toBe("application/json");
    expect(await empty.json()).toEqual({ applinks: { details: [] } });

    vi.stubEnv("APPLE_TEAM_ID", "ABCDE12345");
    vi.stubEnv("APPLE_BUNDLE_IDS", "com.dualityheart.mobile");
    const set = getAasa();
    expect(set.status).toBe(200);
    expect(((await set.json()) as ReturnType<typeof appleAppSiteAssociation>).applinks.details[0]?.appIDs).toEqual([
      "ABCDE12345.com.dualityheart.mobile",
    ]);
  });
});

describe("assetlinks.json (dcm-gdzi.41)", () => {
  it("one statement per package, each with every fingerprint (upper-cased, de-duplicated)", () => {
    expect(
      assetLinks({
        ANDROID_PACKAGE_NAMES: "com.dualityheart.mobile,com.dualityheart.mobile.preview",
        ANDROID_SHA256_CERT_FINGERPRINTS: `${FP_A.toLowerCase()}, ${FP_B}, ${FP_A}`,
      }),
    ).toEqual(
      ["com.dualityheart.mobile", "com.dualityheart.mobile.preview"].map((packageName) => ({
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: [FP_A, FP_B] },
      })),
    );
  });

  it.each([
    ["no env", {}],
    ["no package", { ANDROID_SHA256_CERT_FINGERPRINTS: FP_A }],
    ["no fingerprint", { ANDROID_PACKAGE_NAMES: "com.dualityheart.mobile" }],
    ["a short fingerprint", { ANDROID_PACKAGE_NAMES: "com.dualityheart.mobile", ANDROID_SHA256_CERT_FINGERPRINTS: "AB:CD" }],
  ])("with %s it is an empty list", (_, env) => {
    expect(assetLinks(env)).toEqual([]);
  });

  it("the route answers 200 JSON from the env read on each request", async () => {
    clearEnv();
    const empty = getAssetLinks();
    expect(empty.status).toBe(200);
    expect(empty.headers.get("content-type")).toBe("application/json");
    expect(await empty.json()).toEqual([]);

    vi.stubEnv("ANDROID_PACKAGE_NAMES", "com.dualityheart.mobile");
    vi.stubEnv("ANDROID_SHA256_CERT_FINGERPRINTS", FP_B);
    const set = getAssetLinks();
    expect(await set.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "com.dualityheart.mobile", sha256_cert_fingerprints: [FP_B] },
      },
    ]);
  });
});
