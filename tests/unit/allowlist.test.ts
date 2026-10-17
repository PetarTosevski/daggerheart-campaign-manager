import { describe, expect, it } from "vitest";

import {
  allowedEmails,
  constantTimeEqual,
  isAllowedEmail,
  isAllowedProfile,
  isE2EDeployment,
  parseGmEmails,
  parseSeedAccounts,
  seedAccountsFor,
} from "../../convex/lib/allowlist";

const env = { GM_EMAILS: " GM@Example.com , second@example.com ,," };

describe("parseGmEmails", () => {
  it("normalises and drops empty entries", () => {
    expect([...parseGmEmails(env.GM_EMAILS)]).toEqual([
      "gm@example.com",
      "second@example.com",
    ]);
  });

  it("returns an empty set when unset", () => {
    expect(parseGmEmails(undefined).size).toBe(0);
    expect(parseGmEmails("").size).toBe(0);
  });
});

describe("isAllowedEmail", () => {
  it("matches case-insensitively and ignores surrounding spaces", () => {
    expect(isAllowedEmail("  gm@EXAMPLE.com ", env)).toBe(true);
  });

  it("rejects emails that are not listed", () => {
    expect(isAllowedEmail("intruder@example.com", env)).toBe(false);
  });

  it("fails closed for missing values", () => {
    expect(isAllowedEmail(undefined, env)).toBe(false);
    expect(isAllowedEmail("", env)).toBe(false);
    expect(isAllowedEmail(42, env)).toBe(false);
    expect(isAllowedEmail("gm@example.com", {})).toBe(false);
  });
});

describe("isAllowedProfile", () => {
  it("allows a verified, allowlisted email", () => {
    expect(
      isAllowedProfile({ email: "gm@example.com", emailVerified: true }, env),
    ).toBe(true);
  });

  it("rejects an allowlisted email when the verified flag is absent", () => {
    expect(isAllowedProfile({ email: "gm@example.com" }, env)).toBe(false);
  });

  it("rejects an allowlisted email when the flag is not exactly true", () => {
    expect(
      isAllowedProfile({ email: "gm@example.com", emailVerified: false }, env),
    ).toBe(false);
    expect(
      isAllowedProfile({ email: "gm@example.com", emailVerified: "true" }, env),
    ).toBe(false);
  });

  it("rejects a verified email that is not allowlisted", () => {
    expect(
      isAllowedProfile(
        { email: "intruder@example.com", emailVerified: true },
        env,
      ),
    ).toBe(false);
  });
});

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

describe("allowlist sources", () => {
  const local = { CONVEX_CLOUD_URL: "http://127.0.0.1:3210" };
  const cloud = { CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud" };
  const sources = { ALLOWED_EMAILS: "p@x.test", GM_EMAILS: "g@x.test", SEED_ACCOUNTS: "s@x.test:pw" };

  it("unions ALLOWED_EMAILS, the legacy GM_EMAILS and, locally, the seeded accounts", () => {
    expect(parseSeedAccounts("a@x.test:pw:with:colons; bad ;B@X.test:pw2")).toEqual([
      { email: "a@x.test", password: "pw:with:colons" },
      { email: "b@x.test", password: "pw2" },
    ]);
    expect([...allowedEmails({ ...local, ...sources })].sort()).toEqual([
      "g@x.test",
      "p@x.test",
      "s@x.test",
    ]);
  });

  it("ignores SEED_ACCOUNTS on a cloud or unknown deployment", () => {
    expect([...allowedEmails({ ...cloud, ...sources })].sort()).toEqual(["g@x.test", "p@x.test"]);
    expect([...allowedEmails(sources)].sort()).toEqual(["g@x.test", "p@x.test"]);
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
});
