import { describe, expect, it } from "vitest";

import { createOrUpdateUser } from "../../convex/lib/users";
import { errorCode } from "./helpers";
import { makeTest } from "./setup";

const env = { GM_EMAILS: "gm@example.com" };
const verifiedGm = { email: "GM@example.com", emailVerified: true };

describe("createOrUpdateUser (sign-in callback)", () => {
  it("creates one user for a verified, allowlisted email and reuses it", async () => {
    const t = makeTest();
    const first = await t.run((ctx) =>
      createOrUpdateUser(ctx, { existingUserId: null, profile: verifiedGm }, env),
    );
    const second = await t.run((ctx) =>
      createOrUpdateUser(ctx, { existingUserId: null, profile: verifiedGm }, env),
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
        createOrUpdateUser(
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
        createOrUpdateUser(
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
        createOrUpdateUser(
          ctx,
          { existingUserId: userId, profile: verifiedGm },
          { GM_EMAILS: "someone-else@example.com" },
        ),
      )
      .catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
  });

  describe("password accounts", () => {
    const password = { id: "password" };
    const penv = { ALLOWED_EMAILS: "player@example.com, gm@example.com" };

    it("creates a user for an allowlisted email without requiring verification", async () => {
      const t = makeTest();
      const id = await t.run((ctx) =>
        createOrUpdateUser(
          ctx,
          { existingUserId: null, provider: password, profile: { email: "Player@example.com", name: " Ana " } },
          penv,
        ),
      );
      const user = await t.run((ctx) => ctx.db.get(id));
      expect(user).toMatchObject({ email: "player@example.com", name: "Ana" });
      expect(user?.emailVerificationTime).toBeUndefined();
    });

    it("refuses an email outside the allowlist", async () => {
      const t = makeTest();
      const error = await t
        .run((ctx) =>
          createOrUpdateUser(ctx, { existingUserId: null, provider: password, profile: { email: "x@example.com" } }, penv),
        )
        .catch((e) => e);
      expect(errorCode(error)).toBe("FORBIDDEN");
      expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
    });

    it("refuses a new password account for an existing email with the same code as a non-allowlisted one", async () => {
      const t = makeTest();
      await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }));
      const error = await t
        .run((ctx) =>
          createOrUpdateUser(ctx, { existingUserId: null, provider: password, profile: { email: "GM@example.com" } }, penv),
        )
        .catch((e) => e);
      expect(errorCode(error)).toBe("FORBIDDEN");
      expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
    });

    it("a Google sign-in onto a password-created user removes the password login", async () => {
      const t = makeTest();
      const id = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { email: "gm@example.com" });
        await ctx.db.insert("authAccounts", { userId, provider: "password", providerAccountId: "gm@example.com", secret: "x" });
        return userId;
      });
      await t.run((ctx) =>
        createOrUpdateUser(ctx, { existingUserId: null, provider: { id: "google" }, profile: verifiedGm }, penv),
      );
      expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toEqual([]);
      expect((await t.run((ctx) => ctx.db.get(id)))?.emailVerificationTime).toEqual(expect.any(Number));
    });

    it("lets a Google sign-in reuse a user first created with a password", async () => {
      const t = makeTest();
      const id = await t.run((ctx) =>
        createOrUpdateUser(ctx, { existingUserId: null, provider: password, profile: { email: "gm@example.com" } }, penv),
      );
      const again = await t.run((ctx) =>
        createOrUpdateUser(ctx, { existingUserId: null, provider: { id: "google" }, profile: verifiedGm }, penv),
      );
      expect(again).toBe(id);
    });
  });
});
