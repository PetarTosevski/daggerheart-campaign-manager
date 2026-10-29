import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { createOrUpdateUser, type SignInArgs } from "../../convex/lib/users";
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

    it("links a new password account of a verified user without a password account to that same user", async () => {
      const t = makeTest();
      const id = await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }));
      const linked = await t.run((ctx) =>
        createOrUpdateUser(ctx, { existingUserId: null, provider: password, profile: { email: "GM@example.com", name: "Other" } }),
      );
      expect(linked).toBe(id);
      expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([
        expect.objectContaining({ _id: id, email: "gm@example.com", emailVerificationTime: 1 }),
      ]);
      expect((await t.run((ctx) => ctx.db.get(id)))?.name).toBeUndefined();
    });

    it("refuses a new password account for a verified user that already has one with EMAIL_TAKEN", async () => {
      const t = makeTest();
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 });
        await ctx.db.insert("authAccounts", { userId, provider: "password", providerAccountId: "gm@example.com", secret: "x" });
      });
      const error = await t
        .run((ctx) =>
          createOrUpdateUser(ctx, { existingUserId: null, provider: password, profile: { email: "GM@example.com" } }),
        )
        .catch((e) => e);
      expect(errorCode(error)).toBe("EMAIL_TAKEN");
    });

    it("refuses a new password account for an UNVERIFIED existing user with EMAIL_TAKEN", async () => {
      const t = makeTest();
      await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com" }));
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

  describe("apple-native accounts", () => {
    const apple = { id: "apple-native" };

    it("signs a verified email into the existing verified user", async () => {
      const t = makeTest();
      const id = await t.run((ctx) => ctx.db.insert("users", { email: "ada@example.com", emailVerificationTime: 1 }));
      const linked = await t.run((ctx) =>
        createOrUpdateUser(ctx, {
          existingUserId: null,
          provider: apple,
          profile: { email: "Ada@example.com", emailVerified: true },
        }),
      );
      expect(linked).toBe(id);
      expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
    });

    it("creates a separate user for a Hide My Email address", async () => {
      const t = makeTest();
      const first = await t.run((ctx) =>
        createOrUpdateUser(ctx, {
          existingUserId: null,
          provider: apple,
          profile: { email: "ada@example.com", emailVerified: true, name: "Ada" },
        }),
      );
      const relay = await t.run((ctx) =>
        createOrUpdateUser(ctx, {
          existingUserId: null,
          provider: apple,
          profile: { email: "hide@privaterelay.appleid.com", emailVerified: true },
        }),
      );
      expect(relay).not.toBe(first);
      const users = await t.run((ctx) => ctx.db.query("users").collect());
      expect(users.map((user) => user.email).sort()).toEqual(["ada@example.com", "hide@privaterelay.appleid.com"]);
    });

    it("refuses a profile whose email is not verified", async () => {
      const t = makeTest();
      const error = await t
        .run((ctx) =>
          createOrUpdateUser(ctx, {
            existingUserId: null,
            provider: apple,
            profile: { email: "ada@example.com" },
          }),
        )
        .catch((e) => e);
      expect(errorCode(error)).toBe("FORBIDDEN");
      expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
    });

    it("returns the existing account when a later sign-in has no email", async () => {
      const t = makeTest();
      const id = await t.run((ctx) => ctx.db.insert("users", { email: "ada@example.com", emailVerificationTime: 1 }));
      const result = await t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: id, provider: apple, profile: {} }));
      expect(result).toBe(id);
    });
  });
});

describe("createOrUpdateUser: sign-up mode (config AD4, Q18 a)", () => {
  type T = ReturnType<typeof makeTest>;
  const setMode = (t: T, signUpMode: "open" | "invite" | "closed", ownerId?: Id<"users">) =>
    t.run((ctx) => ctx.db.insert("appConfig", { key: "app", signUpMode, updatedAt: 1, ...(ownerId ? { ownerId } : {}) }));
  const setReadOnly = (t: T) => t.run((ctx) => ctx.db.insert("appStatus", { key: "app", readOnly: true, updatedAt: 1 }));
  const campaign = (ctx: MutationCtx, ownerId: Id<"users">, joinCode: string, deletedAt?: number) =>
    ctx.db.insert("campaigns", {
      ownerId,
      frameId: "witherwild",
      name: joinCode,
      nameKey: joinCode.toLowerCase(),
      tier: 1,
      level: 1,
      createdAt: 1,
      lastOpenedAt: 1,
      joinCode,
      ...(deletedAt === undefined ? {} : { deletedAt }),
    });
  const create = (t: T, provider: { id: string }, profile: SignInArgs["profile"]) =>
    t.run((ctx) => createOrUpdateUser(ctx, { existingUserId: null, provider, profile })).catch((e: unknown) => e);
  const newcomer = { email: "new@example.com", emailVerified: true };
  const users = (t: T) => t.run((ctx) => ctx.db.query("users").collect());
  const gmWith = (t: T, build: (ctx: MutationCtx, gm: Id<"users">) => Promise<unknown>) =>
    t.run(async (ctx) => {
      const gm = await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 });
      await build(ctx, gm);
    });

  it("closed: refuses a new Google or password user with SIGN_UP_CLOSED and creates nothing", async () => {
    const t = makeTest();
    await setMode(t, "closed");
    expect(errorCode(await create(t, google, newcomer))).toBe("SIGN_UP_CLOSED");
    expect(errorCode(await create(t, password, { email: "new@example.com" }))).toBe("SIGN_UP_CLOSED");
    expect(await users(t)).toEqual([]);
  });

  it("read-only mode refuses a new user even when sign-up is open", async () => {
    const t = makeTest();
    await setMode(t, "open");
    await setReadOnly(t);
    expect(errorCode(await create(t, google, newcomer))).toBe("SIGN_UP_CLOSED");
    expect(await users(t)).toEqual([]);
  });

  it("closed and read-only never refuse an existing user: the owner, a code entered, a password linked to Google", async () => {
    const t = makeTest();
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner@example.com", emailVerificationTime: 1 }));
    const pendingId = await t.run((ctx) => ctx.db.insert("users", { email: "ana@example.com" }));
    await setMode(t, "closed", ownerId);
    await setReadOnly(t);
    expect(await create(t, google, { email: "Owner@example.com", emailVerified: true })).toBe(ownerId);
    const verified = await t.run((ctx) =>
      createOrUpdateUser(ctx, {
        existingUserId: pendingId,
        provider: password,
        profile: { email: "ana@example.com", emailVerified: true },
      }),
    );
    expect(verified).toBe(pendingId);
    expect(await create(t, password, { email: "owner@example.com" })).toBe(ownerId);
    expect(await users(t)).toHaveLength(2);
  });

  it("invite: refuses an uninvited email without a code with SIGN_UP_INVITE_ONLY", async () => {
    const t = makeTest();
    await setMode(t, "invite");
    expect(errorCode(await create(t, google, newcomer))).toBe("SIGN_UP_INVITE_ONLY");
    expect(errorCode(await create(t, password, { email: "new@example.com" }))).toBe("SIGN_UP_INVITE_ONLY");
    expect(await users(t)).toEqual([]);
  });

  it("invite: allows Google and password for an email with a pending invite to a live campaign", async () => {
    const t = makeTest();
    await gmWith(t, async (ctx, gm) => {
      const campaignId = await campaign(ctx, gm, "LIVE1");
      await ctx.db.insert("campaignInvites", { campaignId, email: "new@example.com", invitedBy: gm, createdAt: 1 });
      await ctx.db.insert("campaignInvites", { campaignId, email: "pw@example.com", invitedBy: gm, createdAt: 1 });
    });
    await setMode(t, "invite");
    expect(typeof (await create(t, google, { email: "New@Example.com", emailVerified: true }))).toBe("string");
    expect(typeof (await create(t, password, { email: "pw@example.com" }))).toBe("string");
  });

  it("invite: an invite to a deleted campaign does not count", async () => {
    const t = makeTest();
    await gmWith(t, async (ctx, gm) => {
      const campaignId = await campaign(ctx, gm, "GONE1", 5);
      await ctx.db.insert("campaignInvites", { campaignId, email: "new@example.com", invitedBy: gm, createdAt: 1 });
    });
    await setMode(t, "invite");
    expect(errorCode(await create(t, google, newcomer))).toBe("SIGN_UP_INVITE_ONLY");
  });

  it("invite: a password sign-up with a live campaign's join code is allowed; a wrong or deleted one is not", async () => {
    const t = makeTest();
    await gmWith(t, async (ctx, gm) => {
      await campaign(ctx, gm, "LIVE1");
      await campaign(ctx, gm, "GONE1", 5);
    });
    await setMode(t, "invite");
    expect(errorCode(await create(t, password, { email: "a@example.com", joinCode: "NOPE1" }))).toBe("SIGN_UP_INVITE_ONLY");
    expect(errorCode(await create(t, password, { email: "a@example.com", joinCode: "GONE1" }))).toBe("SIGN_UP_INVITE_ONLY");
    // Normalised like a typed code (case, separators).
    expect(typeof (await create(t, password, { email: "a@example.com", joinCode: "live-1" }))).toBe("string");
  });

  it("invite: Google ignores a join code (Google sign-up works only for invited emails)", async () => {
    const t = makeTest();
    await gmWith(t, (ctx, gm) => campaign(ctx, gm, "LIVE1"));
    await setMode(t, "invite");
    expect(errorCode(await create(t, google, { ...newcomer, joinCode: "LIVE1" }))).toBe("SIGN_UP_INVITE_ONLY");
  });
});
