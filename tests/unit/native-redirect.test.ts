import { describe, expect, it } from "vitest";

import { nativeRedirectTarget } from "../../convex/lib/nativeRedirect";

const SITE = "https://app.example.test";

describe("nativeRedirectTarget", () => {
  it("allows a relative path, a query, SITE_URL, and the app schemes", () => {
    expect(nativeRedirectTarget("/campaigns", SITE)).toBe("https://app.example.test/campaigns");
    expect(nativeRedirectTarget("?next=/campaigns", SITE)).toBe("https://app.example.test?next=/campaigns");
    expect(nativeRedirectTarget(SITE, SITE)).toBe(SITE);
    expect(nativeRedirectTarget(`${SITE}/campaigns`, `${SITE}/`)).toBe(`${SITE}/campaigns`);
    expect(nativeRedirectTarget("dualityheart://auth", SITE)).toBe("dualityheart://auth");
    expect(nativeRedirectTarget("dualityheart-dev://auth", SITE)).toBe("dualityheart-dev://auth");
  });

  it("rejects another site, a lookalike scheme, javascript, and a protocol-relative URL", () => {
    for (const redirectTo of ["https://evil.test", "dualityheart.evil://auth", "javascript:alert(1)", "//evil"]) {
      expect(() => nativeRedirectTarget(redirectTo, SITE)).toThrow(/Invalid `redirectTo`/);
    }
    expect(() => nativeRedirectTarget("https://app.example.test.evil", SITE)).toThrow(/Invalid `redirectTo`/);
    expect(() => nativeRedirectTarget("JavaScript:alert(1)", SITE)).toThrow(/Invalid `redirectTo`/);
    expect(() => nativeRedirectTarget("/\\evil.test", SITE)).toThrow(/Invalid `redirectTo`/);
  });
});
