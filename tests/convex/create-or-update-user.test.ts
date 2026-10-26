import { describe, expect, it } from "vitest";

import { createOrUpdateUser } from "../../convex/lib/users";
import { errorCode } from "./helpers";
import { makeTest } from "./setup";

const verifiedGm = { email: "GM@example.com", emailVerified: true };
const password = { id: "password" };
const google = { id: "google" };

describe("createOrUpdateUser (sign-in callback)", () => {
  it("creates one user for a verified email and reuses it", async () => {
    const t = makeTest();
    const first = await t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: null, provider: google, profile: verifiedGm }));
    const second = await t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: null, provider: google, profile: verifiedGm }));
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
        createOrUpdateUser(ctx, {
          existingUserId: null,
          provider: google,
          profile: { email: "gm@example.com", emailVerified: false },
        }),
      )
      .catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });

  it("accepts any verified email (sign-up is open)", async () => {
    const t = makeTest();
    const id = await t.run((ctx) =>
      createOrUpdateUser(ctx, {
        existingUserId: null,
        provider: google,
        profile: { email: "newcomer@example.com", emailVerified: true },
      }),
    );
    expect((await t.run((ctx) => ctx.db.get(id)))?.email).toBe("newcomer@example.com");
  });

  it("refuses a profile without an email", async () => {
    const t = makeTest();
    const error = await t
      .run((ctx) => createOrUpdateUser(ctx, { existingUserId: null, provider: password, profile: { email: "  " } }))
      .catch((e) => e);
    expect(errorCode(error)).toBe("INVALID");
  });

  it("marks an existing user verified when the profile says the email is now verified", async () => {
    const t = makeTest();
    const id = await t.run((ctx) => ctx.db.insert("users", { email: "ana@example.com" }));
    // The code was entered: Convex Auth passes the account's user and `emailVerified: true`.
    const result = await t.run((ctx) =>
      createOrUpdateUser(ctx, {
        existingUserId: id,
        provider: password,
        profile: { email: "ana@example.com", emailVerified: true },
      }),
    );
    expect(result).toBe(id);
    expect((await t.run((ctx) => ctx.db.get(id)))?.emailVerificationTime).toEqual(expect.any(Number));
  });

  it("does not verify an existing user on a plain sign-in", async () => {
    const t = makeTest();
    const id = await t.run((ctx) => ctx.db.insert("users", { email: "ana@example.com" }));
    await t.run((ctx) =>
      createOrUpdateUser(ctx, { existingUserId: id, provider: password, profile: { email: "ana@example.com" } }),
    );
    expect((await t.run((ctx) => ctx.db.get(id)))?.emailVerificationTime).toBeUndefined();
  });

  describe("password accounts", () => {
    it("creates an UNVERIFIED user for any email, with a lower-cased email and trimmed name", async () => {
      const t = makeTest();
      const id = await t.run((ctx) =>
        createOrUpdateUser(ctx, {
          existingUserId: null,
          provider: password,
          profile: { email: "Player@example.com", name: " Ana " },
        }),
      );
      const user = await t.run((ctx) => ctx.db.get(id));
      expect(user).toMatchObject({ email: "player@example.com", name: "Ana" });
      expect(user?.emailVerificationTime).toBeUndefined();
    });

    it("refuses a new password account for an existing email with EMAIL_TAKEN", async () => {
      const t = makeTest();
      await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }));
      const error = await t
        .run((ctx) =>
          createOrUpdateUser(ctx, { existingUserId: null, provider: password, profile: { email: "GM@example.com" } }),
        )
        .catch((e) => e);
      expect(errorCode(error)).toBe("EMAIL_TAKEN");
      expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
    });

    it("a Google sign-in onto a password-created user removes the password login, its codes and sessions", async () => {
      const t = makeTest();
      const id = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { email: "gm@example.com" });
        const accountId = await ctx.db.insert("authAccounts", {
          userId,
          provider: "password",
          providerAccountId: "gm@example.com",
          secret: "x",
        });
        await ctx.db.insert("authVerificationCodes", { accountId, provider: "resend-otp", code: "h", expirationTime: 1 });
        await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1000 });
        return userId;
      });
      await t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: null, provider: google, profile: verifiedGm }));
      expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toEqual([]);
      expect(await t.run((ctx) => ctx.db.query("authVerificationCodes").collect())).toEqual([]);
      expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toEqual([]);
      expect((await t.run((ctx) => ctx.db.get(id)))?.emailVerificationTime).toEqual(expect.any(Number));
    });

    it("keeps the password login of a VERIFIED user when Google links to the same email", async () => {
      const t = makeTest();
      const id = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 });
        await ctx.db.insert("authAccounts", {
          userId,
          provider: "password",
          providerAccountId: "gm@example.com",
          secret: "x",
          emailVerified: "gm@example.com",
        });
        return userId;
      });
      const linked = await t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: null, provider: google, profile: verifiedGm }));
      expect(linked).toBe(id);
      expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(1);
    });

    it("lets a Google sign-in reuse a user first created with a password", async () => {
      const t = makeTest();
      const id = await t.run((ctx) =>
        createOrUpdateUser(ctx, { existingUserId: null, provider: password, profile: { email: "gm@example.com" } }),
      );
      const again = await t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: null, provider: google, profile: verifiedGm }));
      expect(again).toBe(id);
    });
  });
});
