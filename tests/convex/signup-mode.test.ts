/**
 * Sign-up mode and read-only mode at account creation (config AD4, Q18 a), through the real Convex Auth `signIn`
 * action, as `auth-signup.test.ts` drives it (stubbed Resend `fetch`, random codes read back from the "sent" email).
 * Assertions use ConvexError.data.code, never message text.
 */
import { generateKeyPairSync } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { joinCodeFromNext } from "../../src/app/signin/password-form";
import { errorCode } from "./helpers";
import { makeTest } from "./setup";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENV: Record<string, string> = {
  JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  CONVEX_SITE_URL: "https://signup-mode.example.test",
  SITE_URL: "https://app.example.test",
  AUTH_RESEND_KEY: "re_test_key",
  MAIL_FROM: "Duality Heart <noreply@dualityheart.com>",
};
const previous: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [name, value] of Object.entries(ENV)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
});
afterAll(() => {
  for (const name of Object.keys(ENV)) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
});

let sent: { to: string; code: string }[] = [];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { to: string[]; text: string };
      sent.push({ to: body.to[0], code: /Your code: (\d{6})/.exec(body.text)![1] });
      return { ok: true, status: 200 };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type T = ReturnType<typeof makeTest>;
type SignInResult = { tokens?: { token: string } | null };
const GOOD = "correct horse";

const signUp = (t: T, email: string, extra: Record<string, string> = {}) =>
  t.action(api.auth.signIn, {
    provider: "password",
    params: { flow: "signUp", email, password: GOOD, name: "Ana", ...extra },
  }) as Promise<SignInResult>;
const signInPw = (t: T, email: string) =>
  t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email, password: GOOD } }) as Promise<SignInResult>;
const verify = (t: T, email: string, code: string) =>
  t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email, code } }) as Promise<SignInResult>;
const caught = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e);
const users = (t: T) => t.run((ctx) => ctx.db.query("users").collect());

const setMode = (t: T, signUpMode: "open" | "invite" | "closed") =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "app"))
      .unique();
    if (row) await ctx.db.patch(row._id, { signUpMode });
    else await ctx.db.insert("appConfig", { key: "app", signUpMode, updatedAt: 1 });
  });
const setReadOnly = (t: T) => t.run((ctx) => ctx.db.insert("appStatus", { key: "app", readOnly: true, updatedAt: 1 }));

/** A GM with a live campaign whose join code is `LIVE1`, and an invite of `invited@example.com` to it. */
const seedCampaign = (t: T) =>
  t.run(async (ctx) => {
    const gm: Id<"users"> = await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 });
    const campaignId = await ctx.db.insert("campaigns", {
      ownerId: gm,
      frameId: "witherwild",
      name: "Live",
      nameKey: "live",
      tier: 1,
      level: 1,
      createdAt: 1,
      lastOpenedAt: 1,
      joinCode: "LIVE1",
    });
    await ctx.db.insert("campaignInvites", { campaignId, email: "invited@example.com", invitedBy: gm, createdAt: 1 });
  });

/** A verified password account, created while sign-up was open. */
async function verifiedAccount(t: T, email: string) {
  await signUp(t, email);
  const code = sent.find((s) => s.to === email)!.code;
  expect((await verify(t, email, code)).tokens?.token).toEqual(expect.any(String));
}

describe("password sign-up and the sign-up mode", () => {
  it("open (the default) creates the account as before", async () => {
    const t = makeTest();
    await signUp(t, "ana@example.com");
    expect(await users(t)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("closed refuses a new account with SIGN_UP_CLOSED, creates nothing and sends no email", async () => {
    const t = makeTest();
    await setMode(t, "closed");
    expect(errorCode(await caught(signUp(t, "ana@example.com")))).toBe("SIGN_UP_CLOSED");
    expect(await users(t)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("read-only mode refuses a new account with SIGN_UP_CLOSED while sign-up is open", async () => {
    const t = makeTest();
    await setReadOnly(t);
    expect(errorCode(await caught(signUp(t, "ana@example.com")))).toBe("SIGN_UP_CLOSED");
    expect(await users(t)).toEqual([]);
  });

  it("a refused sign-up does not reveal whether the email has an account", async () => {
    const t = makeTest();
    await verifiedAccount(t, "ana@example.com");
    await setMode(t, "closed");
    expect(errorCode(await caught(signUp(t, "ana@example.com")))).toBe("SIGN_UP_CLOSED");
    expect(errorCode(await caught(signUp(t, "nobody@example.com")))).toBe("SIGN_UP_CLOSED");
    await setMode(t, "invite");
    expect(errorCode(await caught(signUp(t, "ana@example.com")))).toBe("SIGN_UP_INVITE_ONLY");
    expect(errorCode(await caught(signUp(t, "nobody@example.com")))).toBe("SIGN_UP_INVITE_ONLY");
  });

  it("closed and read-only never stop an existing account from signing in or entering its code", async () => {
    const t = makeTest();
    await verifiedAccount(t, "ana@example.com");
    await signUp(t, "bo@example.com"); // created while open, code not yet entered
    await setMode(t, "closed");
    await setReadOnly(t);
    expect((await signInPw(t, "ana@example.com")).tokens?.token).toEqual(expect.any(String));
    const code = sent.find((s) => s.to === "bo@example.com")!.code;
    expect((await verify(t, "bo@example.com", code)).tokens?.token).toEqual(expect.any(String));
  });

  it("invite refuses an uninvited email without a join code with SIGN_UP_INVITE_ONLY", async () => {
    const t = makeTest();
    await seedCampaign(t);
    await setMode(t, "invite");
    expect(errorCode(await caught(signUp(t, "stranger@example.com")))).toBe("SIGN_UP_INVITE_ONLY");
    expect(errorCode(await caught(signUp(t, "stranger@example.com", { joinCode: "WRONG9" })))).toBe("SIGN_UP_INVITE_ONLY");
    expect((await users(t)).map((u) => u.email)).toEqual(["gm@example.com"]);
    expect(sent).toEqual([]);
  });

  it("invite allows an email with a pending invite", async () => {
    const t = makeTest();
    await seedCampaign(t);
    await setMode(t, "invite");
    await signUp(t, "Invited@Example.com");
    expect((await users(t)).map((u) => u.email)).toContain("invited@example.com");
    expect(sent).toHaveLength(1);
  });

  it("invite allows a sign-up carrying a live campaign's join code, and the code is not stored on the user", async () => {
    const t = makeTest();
    await seedCampaign(t);
    await setMode(t, "invite");
    await signUp(t, "linked@example.com", { joinCode: "live1" });
    const user = (await users(t)).find((u) => u.email === "linked@example.com");
    expect(user).toBeDefined();
    expect(user).not.toHaveProperty("joinCode");
    // The code works after verification, like any account.
    expect((await verify(t, "linked@example.com", sent[0].code)).tokens?.token).toEqual(expect.any(String));
  });

  it("a refused attempt still spends the per-email sign-up limit (join-code guesses are counted)", async () => {
    const t = makeTest();
    await setMode(t, "invite");
    for (let i = 0; i < 10; i++) {
      expect(errorCode(await caught(signUp(t, "guess@example.com", { joinCode: `GUESS${i}` })))).toBe("SIGN_UP_INVITE_ONLY");
    }
    expect(errorCode(await caught(signUp(t, "guess@example.com", { joinCode: "GUESS10" })))).toBe("RATE_LIMITED");
  });
});

describe("joinCodeFromNext (password form)", () => {
  it("reads the code of a /join/<code> return path only", () => {
    expect(joinCodeFromNext("/join/ABC123")).toBe("ABC123");
    expect(joinCodeFromNext("/join/ABC123/")).toBe("ABC123");
    expect(joinCodeFromNext("/join/AB%2DC")).toBe("AB-C");
    expect(joinCodeFromNext(null)).toBeNull();
    expect(joinCodeFromNext("/")).toBeNull();
    expect(joinCodeFromNext("/campaigns/x")).toBeNull();
    expect(joinCodeFromNext("/join/a/b")).toBeNull();
    expect(joinCodeFromNext("/join/%E0%A4%A")).toBeNull();
  });
});
