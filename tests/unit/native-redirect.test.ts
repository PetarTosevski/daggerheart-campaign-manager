import { describe, expect, it } from "vitest";

import { NATIVE_RETURN_PATH, nativeRedirectTarget } from "../../convex/lib/nativeRedirect";

const SITE = "https://app.example.test";

describe("nativeRedirectTarget", () => {
  it("allows a relative path, a query, SITE_URL, and the phone's https return address", () => {
    expect(nativeRedirectTarget("/campaigns", SITE)).toBe("https://app.example.test/campaigns");
    expect(nativeRedirectTarget("?next=/campaigns", SITE)).toBe("https://app.example.test?next=/campaigns");
    expect(nativeRedirectTarget(SITE, SITE)).toBe(SITE);
    expect(nativeRedirectTarget(`${SITE}/campaigns`, `${SITE}/`)).toBe(`${SITE}/campaigns`);
    expect(nativeRedirectTarget(`${SITE}${NATIVE_RETURN_PATH}`, SITE)).toBe("https://app.example.test/auth");
  });

  it("rejects every custom app scheme, so no other app can claim the code (dcm-gdzi.5)", () => {
    for (const redirectTo of [
      "dualityheart://auth",
      "dualityheart-dev://auth",
      "dualityheart://auth?next=/campaigns",
      "exp://127.0.0.1:8081/--/auth",
      "com.dualityheart.mobile://auth",
    ]) {
      expect(() => nativeRedirectTarget(redirectTo, SITE)).toThrow(/Invalid `redirectTo`/);
    }
  });

  it("rejects another site, a lookalike host, javascript, data, and a protocol-relative URL", () => {
    for (const redirectTo of [
      "https://evil.test",
      "https://evil.test/auth",
      "http://app.example.test/auth",
      "https://app.example.test.evil",
      "https://app.example.test@evil.test/auth",
      "dualityheart.evil://auth",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,hi",
      "//evil",
      "/\\evil.test",
      "/auth\nLocation: https://evil.test",
      "",
    ]) {
      expect(() => nativeRedirectTarget(redirectTo, SITE)).toThrow(/Invalid `redirectTo`/);
    }
  });
});
