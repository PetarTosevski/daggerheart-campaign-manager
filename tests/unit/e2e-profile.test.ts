import { describe, expect, it } from "vitest";

import { buildE2EProfile, isAllowedProfile } from "../../convex/lib/allowlist";

const localEnv = {
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
  E2E_AUTH_ENABLED: "true",
  E2E_AUTH_SECRET: "s3cret",
  GM_EMAILS: "e2e-gm@example.test",
};

describe("buildE2EProfile", () => {
  it("returns a verified profile for the right secret, which the allowlist accepts", () => {
    const profile = buildE2EProfile(
      { email: " E2E-GM@example.test ", secret: "s3cret" },
      localEnv,
    );
    expect(profile).toEqual({
      email: "e2e-gm@example.test",
      emailVerified: true,
    });
    expect(isAllowedProfile(profile!, localEnv)).toBe(true);
  });

  it("returns null for a wrong or missing secret", () => {
    expect(
      buildE2EProfile({ email: "e2e-gm@example.test", secret: "nope" }, localEnv),
    ).toBeNull();
    expect(buildE2EProfile({ email: "e2e-gm@example.test" }, localEnv)).toBeNull();
    expect(
      buildE2EProfile(
        { email: "e2e-gm@example.test", secret: "s3cret" },
        { ...localEnv, E2E_AUTH_SECRET: undefined },
      ),
    ).toBeNull();
  });

  it("returns null when e2e auth is not enabled", () => {
    expect(
      buildE2EProfile(
        { email: "e2e-gm@example.test", secret: "s3cret" },
        { ...localEnv, E2E_AUTH_ENABLED: undefined },
      ),
    ).toBeNull();
  });

  it("returns null on a cloud deployment even with the flag and secret set", () => {
    expect(
      buildE2EProfile(
        { email: "e2e-gm@example.test", secret: "s3cret" },
        { ...localEnv, CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud" },
      ),
    ).toBeNull();
  });

  it("produces a profile the allowlist rejects when the email is not listed", () => {
    const profile = buildE2EProfile(
      { email: "someone-else@example.test", secret: "s3cret" },
      localEnv,
    );
    expect(profile).not.toBeNull();
    expect(isAllowedProfile(profile!, localEnv)).toBe(false);
  });
});
