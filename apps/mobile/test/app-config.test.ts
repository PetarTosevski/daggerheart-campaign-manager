import { afterEach, expect, test } from "@jest/globals";

import appConfig from "../app.config";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

function configFor(env: Record<string, string | undefined>) {
  process.env = { ...saved, EXPO_PUBLIC_CONVEX_URL: "https://example.convex.cloud", ...env };
  return appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
}

test("the build claims https://<site>/auth as a universal link and a verified app link (dcm-gdzi.41)", () => {
  const config = configFor({ APP_VARIANT: "production", EXPO_PUBLIC_SITE_URL: "https://dualityheart.com/" });
  expect(config.ios?.associatedDomains).toEqual(["applinks:dualityheart.com"]);
  expect(config.android?.intentFilters).toEqual([
    {
      action: "VIEW",
      autoVerify: true,
      data: [{ scheme: "https", host: "dualityheart.com", path: "/auth" }],
      category: ["BROWSABLE", "DEFAULT"],
    },
  ]);
});

test("without EXPO_PUBLIC_SITE_URL it uses the store site, as src/auth/google.ts does", () => {
  const config = configFor({ APP_VARIANT: "preview", EXPO_PUBLIC_SITE_URL: undefined });
  expect(config.ios?.associatedDomains).toEqual(["applinks:dualityheart.com"]);
});

test("a site that is not https is refused at build time", () => {
  expect(() => configFor({ EXPO_PUBLIC_SITE_URL: "http://localhost:3000" })).toThrow(/https/);
  expect(() => configFor({ EXPO_PUBLIC_SITE_URL: "not a url" })).toThrow(/https/);
});
