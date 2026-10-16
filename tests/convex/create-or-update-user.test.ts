import { describe, expect, it } from "vitest";

import { createOrUpdateGmUser } from "../../convex/lib/users";
import { makeTest } from "./setup";

const env = { GM_EMAILS: "gm@example.com" };
const verifiedGm = { email: "GM@example.com", emailVerified: true };

function errorCode(error: unknown): unknown {
  return (error as { data?: unknown }).data;
}

describe("createOrUpdateGmUser (sign-in callback)", () => {
  it("creates one user for a verified, allowlisted email and reuses it", async () => {
    const t = makeTest();
    const first = await t.run((ctx) =>
      createOrUpdateGmUser(ctx, { existingUserId: null, profile: verifiedGm }, env),
    );
    const second = await t.run((ctx) =>
      createOrUpdateGmUser(ctx, { existingUserId: null, profile: verifiedGm }, env),
    );
    expect(second).toBe(first);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("gm@example.com");
    expect(users[0].emailVerificationTime).toEqual(expect.any(Number));
  });

  it("refuses an unverified Google profile and creates no user", async () => {
    const t = makeTest();
    const error = await t
      .run((ctx) =>
        createOrUpdateGmUser(
          ctx,
          { existingUserId: null, profile: { email: "gm@example.com", emailVerified: false } },
          env,
        ),
      )
      .catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });

  it("refuses a verified email that is not allowlisted and creates no user", async () => {
    const t = makeTest();
    const error = await t
      .run((ctx) =>
        createOrUpdateGmUser(
          ctx,
          { existingUserId: null, profile: { email: "intruder@example.com", emailVerified: true } },
          env,
        ),
      )
      .catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });

  it("refuses a returning account whose email was removed from the allowlist", async () => {
    const t = makeTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "gm@example.com" }),
    );
    const error = await t
      .run((ctx) =>
        createOrUpdateGmUser(
          ctx,
          { existingUserId: userId, profile: verifiedGm },
          { GM_EMAILS: "someone-else@example.com" },
        ),
      )
      .catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
  });
});
