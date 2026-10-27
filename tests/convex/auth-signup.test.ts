/**
 * Password sign-up, code verification, reset and rate limits through the real Convex Auth `signIn` action
 * (open-signup plan, OS3). Resend is a stubbed `fetch`; the e2e fake-code mode is off (no E2E_AUTH_ENABLED), so the
 * codes are random and read back from the "sent" email. Assertions use ConvexError.data.code, never message text.
 */
import { generateKeyPairSync } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENV: Record<string, string> = {
  JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  CONVEX_SITE_URL: "https://auth-signup.example.test",
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

type Sent = { to: string; subject: string; code: string };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { to: string[]; subject: string; text: string };
      sent.push({ to: body.to[0], subject: body.subject, code: /Your code: (\d{6})/.exec(body.text)![1] });
      return { ok: true, status: 200 };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Tokens = { token: string; refreshToken: string };
type SignInResult = { tokens?: Tokens | null; started?: boolean };

const GOOD = "correct horse";

function signUp(t: ReturnType<typeof makeTest>, email: string, password = GOOD, name = "Ana") {
  return t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password, name } }) as Promise<SignInResult>;
}
function signInPw(t: ReturnType<typeof makeTest>, email: string, password: string) {
  return t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email, password } }) as Promise<SignInResult>;
}
function verify(t: ReturnType<typeof makeTest>, email: string, code: string) {
  return t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email, code } }) as Promise<SignInResult>;
}
const rows = (t: ReturnType<typeof makeTest>) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    accounts: await ctx.db.query("authAccounts").collect(),
    sessions: await ctx.db.query("authSessions").collect(),
  }));
const caught = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e);

describe("password sign-up with an emailed code", () => {
  it("creates an unverified user, emails a 6-digit code and issues no session", async () => {
    const t = makeTest();
    const result = await signUp(t, "Ana@Example.com");
    expect(result.tokens ?? null).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@example.com" });
    expect(sent[0].code).toMatch(/^\d{6}$/);
    const { users, accounts, sessions } = await rows(t);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "ana@example.com", name: "Ana" });
    expect(users[0].emailVerificationTime).toBeUndefined();
    expect(accounts[0].emailVerified).toBeUndefined();
    expect(sessions).toEqual([]);
  });

  it("signing in before the code issues no session and sends a fresh code", async () => {
    const t = makeTest();
    await signUp(t, "ana@example.com");
    const result = await signInPw(t, "ana@example.com", GOOD);
    expect(result.tokens ?? null).toBeNull();
    expect(sent).toHaveLength(2);
    expect((await rows(t)).sessions).toEqual([]);
  });

  it("the correct code verifies the email and signs in, whatever the case of the email typed", async () => {
    const t = makeTest();
    await signUp(t, "Ana@Example.com");
    const result = await verify(t, "ANA@example.com", sent[0].code);
    expect(result.tokens?.token).toEqual(expect.any(String));
    const { users, accounts, sessions } = await rows(t);
    expect(users[0].emailVerificationTime).toEqual(expect.any(Number));
    expect(accounts[0].emailVerified).toBe("ana@example.com");
    expect(sessions).toHaveLength(1);
    // And the password works from now on.
    expect((await signInPw(t, "ana@example.com", GOOD)).tokens?.token).toEqual(expect.any(String));
  });

  it("a wrong code is CODE_INVALID, issues no session and does not verify the email", async () => {
    const t = makeTest();
    await signUp(t, "ana@example.com");
    const wrong = sent[0].code === "000000" ? "000001" : "000000";
    expect(errorCode(await caught(verify(t, "ana@example.com", wrong)))).toBe("CODE_INVALID");
    const { users, sessions } = await rows(t);
    expect(users[0].emailVerificationTime).toBeUndefined();
    expect(sessions).toEqual([]);
  });

  it("a code for an email without an account is CODE_INVALID too (no account probing)", async () => {
    const t = makeTest();
    expect(errorCode(await caught(verify(t, "nobody@example.com", "123456")))).toBe("CODE_INVALID");
  });

  it("an expired code (15 minutes) is CODE_INVALID and does not verify the email", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    const t = makeTest();
    await signUp(t, "ana@example.com");
    vi.setSystemTime(new Date("2026-10-26T12:15:01Z"));
    expect(errorCode(await caught(verify(t, "ana@example.com", sent[0].code)))).toBe("CODE_INVALID");
    expect((await rows(t)).users[0].emailVerificationTime).toBeUndefined();
  });

  it("a code is still good just inside its 15 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    const t = makeTest();
    await signUp(t, "ana@example.com");
    vi.setSystemTime(new Date("2026-10-26T12:14:30Z"));
    expect((await verify(t, "ana@example.com", sent[0].code)).tokens?.token).toEqual(expect.any(String));
  });

  it("a password under 8 characters is PASSWORD_TOO_SHORT and creates nothing", async () => {
    const t = makeTest();
    expect(errorCode(await caught(signUp(t, "ana@example.com", "short")))).toBe("PASSWORD_TOO_SHORT");
    expect((await rows(t)).users).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("an email that already has a verified account is EMAIL_TAKEN, even with the same password", async () => {
    const t = makeTest();
    await signUp(t, "ana@example.com");
    await verify(t, "ana@example.com", sent[0].code);
    sent = [];
    expect(errorCode(await caught(signUp(t, "ANA@example.com", "another password")))).toBe("EMAIL_TAKEN");
    expect(errorCode(await caught(signUp(t, "ana@example.com", GOOD)))).toBe("EMAIL_TAKEN");
    expect(sent).toEqual([]);
    expect((await rows(t)).users).toHaveLength(1);
  });

  it("an email held by a Google user is EMAIL_TAKEN", async () => {
    const t = makeTest();
    await t.run((ctx) => ctx.db.insert("users", { email: "ana@example.com", emailVerificationTime: 1 }));
    expect(errorCode(await caught(signUp(t, "ana@example.com")))).toBe("EMAIL_TAKEN");
    expect((await rows(t)).users).toHaveLength(1);
  });

  it("a new sign-up replaces an abandoned unverified account: new password, fresh code, old password dead", async () => {
    const t = makeTest();
    await signUp(t, "ana@example.com", "first password", "Squatter");
    const firstCode = sent[0].code;
    await signUp(t, "ana@example.com", "second password");
    expect(sent).toHaveLength(2);
    // The old code no longer works: one code per account, the newest.
    if (sent[1].code !== firstCode) {
      expect(errorCode(await caught(verify(t, "ana@example.com", firstCode)))).toBe("CODE_INVALID");
    }
    expect((await verify(t, "ana@example.com", sent[1].code)).tokens?.token).toEqual(expect.any(String));
    expect((await rows(t)).users).toHaveLength(1);
    expect((await signInPw(t, "ana@example.com", "second password")).tokens?.token).toEqual(expect.any(String));
    expect(await caught(signInPw(t, "ana@example.com", "first password"))).toBeDefined();
  });
});

describe("Google and unverified accounts", () => {
  it("a Google sign-in for an email held by an unverified password account removes that password login", async () => {
    const t = makeTest();
    await signUp(t, "ana@example.com", "squatter pass");
    // Google vouches for the address (what the callback receives for a Google profile).
    const { createOrUpdateUser } = await import("../../convex/lib/users");
    await t.run((ctx) =>
      createOrUpdateUser(ctx, { existingUserId: null, provider: { id: "google" }, profile: { email: "ana@example.com", emailVerified: true } }),
    );
    const { users, accounts, sessions } = await rows(t);
    expect(users).toHaveLength(1);
    expect(users[0].emailVerificationTime).toEqual(expect.any(Number));
    expect(accounts).toEqual([]);
    expect(sessions).toEqual([]);
    // The squatter's code is dead too.
    expect(errorCode(await caught(verify(t, "ana@example.com", sent[0].code)))).toBe("CODE_INVALID");
  });
});

describe("invites and unverified accounts", () => {
  it("an invite to X is unreachable by an unverified password account for X and reachable after the code", async () => {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|session` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Table", idempotencyKey: key() });
    await gm.mutation(api.members.invite, { campaignId, email: "ana@example.com" });

    await signUp(t, "ana@example.com");
    const anaId = (await rows(t)).users.find((u) => u.email === "ana@example.com")!._id;
    const ana = t.withIdentity({ subject: `${anaId}|session` });
    expect(await ana.query(api.campaigns.get, { campaignId })).toBeNull();
    expect(await ana.query(api.campaigns.list, {})).toEqual([]);

    await verify(t, "ana@example.com", sent[0].code);
    expect((await ana.query(api.campaigns.get, { campaignId }))?.role).toBe("player");
  });
});

describe("password reset by code", () => {
  async function verifiedAccount(t: ReturnType<typeof makeTest>) {
    await signUp(t, "ana@example.com");
    await verify(t, "ana@example.com", sent[0].code);
    sent = [];
  }

  it("a reset code sets a new password, signs in and ends the sessions of the old one", async () => {
    const t = makeTest();
    await verifiedAccount(t);
    // A second device signed in with the old password.
    await signInPw(t, "ana@example.com", GOOD);
    expect((await rows(t)).sessions).toHaveLength(2);

    const started = await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", email: "Ana@example.com" } });
    expect((started as SignInResult).tokens ?? null).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/reset/i);

    const done = (await t.action(api.auth.signIn, {
      provider: "password",
      params: { flow: "reset-verification", email: "ana@example.com", code: sent[0].code, newPassword: "brand new pass" },
    })) as SignInResult;
    expect(done.tokens?.token).toEqual(expect.any(String));
    // Only the session created by the reset survives.
    expect((await rows(t)).sessions).toHaveLength(1);
    expect(await caught(signInPw(t, "ana@example.com", GOOD))).toBeDefined();
    expect((await signInPw(t, "ana@example.com", "brand new pass")).tokens?.token).toEqual(expect.any(String));
  });

  it("a wrong reset code is CODE_INVALID and the old password keeps working", async () => {
    const t = makeTest();
    await verifiedAccount(t);
    await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", email: "ana@example.com" } });
    const wrong = sent[0].code === "000000" ? "000001" : "000000";
    const error = await caught(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { flow: "reset-verification", email: "ana@example.com", code: wrong, newPassword: "brand new pass" },
      }),
    );
    expect(errorCode(error)).toBe("CODE_INVALID");
    expect((await signInPw(t, "ana@example.com", GOOD)).tokens?.token).toEqual(expect.any(String));
  });

  it("a reset password under 8 characters is PASSWORD_TOO_SHORT", async () => {
    const t = makeTest();
    await verifiedAccount(t);
    await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", email: "ana@example.com" } });
    const error = await caught(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { flow: "reset-verification", email: "ana@example.com", code: sent[0].code, newPassword: "short" },
      }),
    );
    expect(errorCode(error)).toBe("PASSWORD_TOO_SHORT");
  });

  it("a reset for an email without an account answers like a known one: no error and no email", async () => {
    const t = makeTest();
    const result = (await t.action(api.auth.signIn, {
      provider: "password",
      params: { flow: "reset", email: "nobody@example.com" },
    })) as SignInResult;
    expect(result.tokens ?? null).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("rate limits (per email, anonymous callers)", () => {
  it("the sixth code email for one address within an hour is RATE_LIMITED", async () => {
    const t = makeTest();
    await signUp(t, "ana@example.com"); // send 1
    for (let i = 0; i < 4; i += 1) await signInPw(t, "ana@example.com", GOOD); // sends 2..5
    expect(sent).toHaveLength(5);
    expect(errorCode(await caught(signInPw(t, "ana@example.com", GOOD)))).toBe("RATE_LIMITED");
    expect(sent).toHaveLength(5);
    // Another address is not affected.
    await signUp(t, "bob@example.com");
    expect(sent).toHaveLength(6);
  });

  it("the limit refills: an hour later a code can be sent again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    const t = makeTest();
    await signUp(t, "ana@example.com");
    for (let i = 0; i < 4; i += 1) await signInPw(t, "ana@example.com", GOOD);
    expect(errorCode(await caught(signInPw(t, "ana@example.com", GOOD)))).toBe("RATE_LIMITED");
    vi.setSystemTime(new Date("2026-10-26T13:00:01Z"));
    await signInPw(t, "ana@example.com", GOOD);
    expect(sent).toHaveLength(6);
  });

  it("the eleventh sign-up attempt for one address within an hour is RATE_LIMITED", async () => {
    const t = makeTest();
    await t.run((ctx) => ctx.db.insert("users", { email: "ana@example.com", emailVerificationTime: 1 }));
    for (let i = 0; i < 10; i += 1) {
      expect(errorCode(await caught(signUp(t, "ana@example.com")))).toBe("EMAIL_TAKEN");
    }
    expect(errorCode(await caught(signUp(t, "ana@example.com")))).toBe("RATE_LIMITED");
  });

  it("the global sign-up bucket stops a flood across many addresses", async () => {
    const t = makeTest();
    let limited = 0;
    // The bucket refills one slot every 12 s (300/hour); this loop can take that long, so allow a refill or two.
    for (let i = 0; i < 70 && limited === 0; i += 1) {
      const error = await caught(signUp(t, `flood${i}@example.com`));
      if (error !== undefined) {
        expect(errorCode(error)).toBe("RATE_LIMITED");
        limited = i + 1;
      }
    }
    expect(limited).toBeGreaterThanOrEqual(61);
    expect(limited).toBeLessThanOrEqual(63);
  }, 120_000);
});

describe("e2e fake-code mode (dcm-bxp.128.2)", () => {
  const FAKE = { CONVEX_CLOUD_URL: "http://127.0.0.1:3210", E2E_AUTH_ENABLED: "true", E2E_AUTH_SECRET: "e2e-secret" };
  const saved: Record<string, string | undefined> = {};
  const setFake = (env: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(env)) {
      if (!(name in saved)) saved[name] = process.env[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  beforeEach(() => setFake(FAKE));
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const readCode = async (t: ReturnType<typeof makeTest>, email: string, secret = "e2e-secret") => {
    const res = await t.fetch(`/e2e/code?email=${encodeURIComponent(email)}&secret=${secret}`);
    return { status: res.status, code: res.status === 200 ? ((await res.json()) as { code: string }).code : null };
  };

  it("two sign-ups pending at once both verify, each with its own code, and no email is sent", async () => {
    const t = makeTest();
    await signUp(t, "one@example.com");
    await signUp(t, "two@example.com");
    expect(sent).toEqual([]);
    const one = await readCode(t, "One@Example.com");
    const two = await readCode(t, "two@example.com");
    expect(one.code).toMatch(/^\d{6}$/);
    expect(two.code).toMatch(/^\d{6}$/);
    expect((await verify(t, "one@example.com", one.code!)).tokens?.token).toEqual(expect.any(String));
    expect((await verify(t, "two@example.com", two.code!)).tokens?.token).toEqual(expect.any(String));
  });

  it("a new code for an email replaces the stored one", async () => {
    const t = makeTest();
    await signUp(t, "one@example.com");
    await signInPw(t, "one@example.com", GOOD);
    const rowsLeft = await t.run((ctx) => ctx.db.query("e2eCodes").collect());
    expect(rowsLeft).toHaveLength(1);
  });

  it("the route answers 404 for a wrong secret, an unknown email and a missing secret", async () => {
    const t = makeTest();
    await signUp(t, "one@example.com");
    expect((await readCode(t, "one@example.com", "nope")).status).toBe(404);
    expect((await readCode(t, "nobody@example.com")).status).toBe(404);
    expect((await t.fetch("/e2e/code?email=one%40example.com")).status).toBe(404);
  });

  it("outside the e2e rails nothing is stored and the route is 404 (cloud URL, or e2e auth off)", async () => {
    const t = makeTest();
    setFake({ CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud" });
    await signUp(t, "one@example.com");
    expect(sent).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("e2eCodes").collect())).toEqual([]);
    expect((await readCode(t, "one@example.com")).status).toBe(404);
    await t.run((ctx) => ctx.db.insert("e2eCodes", { email: "one@example.com", code: "111111", createdAt: 0 }));
    expect((await readCode(t, "one@example.com")).status).toBe(404);
    setFake({ CONVEX_CLOUD_URL: FAKE.CONVEX_CLOUD_URL, E2E_AUTH_ENABLED: undefined });
    expect((await readCode(t, "one@example.com")).status).toBe(404);
  });
});
