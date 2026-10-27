import { describe, expect, it } from "vitest";

import {
  constantTimeEqual,
  isE2EDeployment,
  parseSeedAccounts,
  seedAccountsEnabled,
  seedAccountsFor,
} from "../../convex/lib/allowlist";

describe("isE2EDeployment", () => {
  it("accepts local backends only", () => {
    expect(isE2EDeployment({ CONVEX_CLOUD_URL: "http://127.0.0.1:3210" })).toBe(
      true,
    );
    expect(isE2EDeployment({ CONVEX_CLOUD_URL: "http://localhost:3210" })).toBe(
      true,
    );
  });

  it("rejects cloud deployments, look-alikes and missing values", () => {
    expect(
      isE2EDeployment({ CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud" }),
    ).toBe(false);
    expect(
      isE2EDeployment({ CONVEX_CLOUD_URL: "https://localhost.evil.example" }),
    ).toBe(false);
    expect(
      isE2EDeployment({ CONVEX_CLOUD_URL: "http://localhost:3210/.convex.cloud" }),
    ).toBe(false);
    expect(isE2EDeployment({ CONVEX_CLOUD_URL: "not a url" })).toBe(false);
    expect(isE2EDeployment({})).toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("compares strings exactly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
  });
});

describe("seedAccountsEnabled", () => {
  const local = { CONVEX_CLOUD_URL: "http://127.0.0.1:3210" };
  const cloud = { CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud" };

  it("parses SEED_ACCOUNTS entries", () => {
    expect(parseSeedAccounts("a@x.test:pw:with:colons; bad ;B@X.test:pw2")).toEqual([
      { email: "a@x.test", password: "pw:with:colons" },
      { email: "b@x.test", password: "pw2" },
    ]);
  });

  it("is on for a local deployment and off for cloud or unknown ones", () => {
    expect(seedAccountsEnabled(local)).toBe(true);
    expect(seedAccountsEnabled(cloud)).toBe(false);
    expect(seedAccountsEnabled({})).toBe(false);
  });

  it("is on for a cloud deployment only when ALLOW_SEED_ACCOUNTS is exactly \"true\"", () => {
    expect(seedAccountsEnabled({ ...cloud, ALLOW_SEED_ACCOUNTS: "true" })).toBe(true);
    for (const flag of ["false", "TRUE", "1", "", " true"]) {
      expect(seedAccountsEnabled({ ...cloud, ALLOW_SEED_ACCOUNTS: flag })).toBe(false);
    }
  });
});

describe("seedAccountsFor (accounts:seed)", () => {
  it("returns the seed accounts on a local deployment", () => {
    expect(
      seedAccountsFor({ CONVEX_CLOUD_URL: "http://localhost:3210", SEED_ACCOUNTS: "s@x.test:pw" }),
    ).toEqual([{ email: "s@x.test", password: "pw" }]);
  });

  it("refuses to run against a *.convex.cloud deployment", () => {
    expect(() =>
      seedAccountsFor({ CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud", SEED_ACCOUNTS: "s@x.test:pw" }),
    ).toThrow();
    expect(() => seedAccountsFor({ SEED_ACCOUNTS: "s@x.test:pw" })).toThrow();
  });

  it("runs on a cloud deployment with ALLOW_SEED_ACCOUNTS=true and refuses with any other value", () => {
    const cloudSeed = { CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud", SEED_ACCOUNTS: "s@x.test:pw" };
    expect(seedAccountsFor({ ...cloudSeed, ALLOW_SEED_ACCOUNTS: "true" })).toEqual([
      { email: "s@x.test", password: "pw" },
    ]);
    for (const flag of ["false", "yes", "1", ""]) {
      expect(() => seedAccountsFor({ ...cloudSeed, ALLOW_SEED_ACCOUNTS: flag })).toThrow();
    }
  });
});
