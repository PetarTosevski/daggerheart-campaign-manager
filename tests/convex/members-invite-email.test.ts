/**
 * The invite email (open-signup plan, OS7): `members.invite` stores the invite, then a scheduled action emails the
 * address through a stubbed Resend `fetch`. Limits, the e2e fake mode, unverified accounts and failed sends are covered.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { key } from "./helpers";
import { makeTest } from "./setup";

const ENV: Record<string, string | undefined> = {
  SITE_URL: "https://app.example.test/",
  AUTH_RESEND_KEY: "re_test_key",
  MAIL_FROM: "Duality Heart <noreply@dualityheart.com>",
};
const previous: Record<string, string | undefined> = {};
const set = (env: Record<string, string | undefined>) => {
  for (const [name, value] of Object.entries(env)) {
    if (!(name in previous)) previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

type Sent = { to: string[]; subject: string; text: string; html: string };
let sent: Sent[] = [];
let status = 200;

beforeAll(() => set(ENV));
afterAll(() => set(Object.fromEntries(Object.keys(previous).map((n) => [n, previous[n]]))));
beforeEach(() => {
  sent = [];
  status = 200;
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Sent);
      return { ok: status < 300, status };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  set({ E2E_AUTH_ENABLED: undefined, CONVEX_CLOUD_URL: undefined });
});

async function setup(name = "Table") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1, name: "Maya" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|session` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name, idempotencyKey: key() });
  const flush = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, gm, campaignId, flush };
}

describe("invite email", () => {
  it("emails a new invite once, naming the GM and campaign, with a sign-in link", async () => {
    const { gm, campaignId, flush } = await setup();
    await gm.mutation(api.members.invite, { campaignId, email: " New@Example.com " });
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["new@example.com"]);
    expect(sent[0]!.subject).toBe("Maya invited you to Table on Duality Heart");
    expect(sent[0]!.text).toContain("https://app.example.test/signin");
    expect(sent[0]!.html).toContain('href="https://app.example.test/signin"');

    // The same pending invite again sends nothing more.
    await gm.mutation(api.members.invite, { campaignId, email: "new@example.com" });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it("escapes names in the HTML", async () => {
    const { gm, campaignId, flush } = await setup("<b>Hi</b>");
    await gm.mutation(api.members.invite, { campaignId, email: "a@example.com" });
    await flush();
    expect(sent[0]!.html).not.toContain("<b>Hi</b>");
    expect(sent[0]!.html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
  });

  it("a failed send keeps the invite", async () => {
    const { gm, campaignId, flush } = await setup();
    status = 500;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await gm.mutation(api.members.invite, { campaignId, email: "a@example.com" });
    await flush();
    expect(sent).toHaveLength(1);
    expect(err).toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).not.toContain("a@example.com");
    err.mockRestore();
    const { invites } = await gm.query(api.members.access, { campaignId });
    expect(invites.map((i) => i.email)).toEqual(["a@example.com"]);
  });

  it("limits to 20 emails an hour per campaign; the invite is still stored", async () => {
    const { gm, campaignId, flush } = await setup();
    for (let i = 0; i < 21; i++) await gm.mutation(api.members.invite, { campaignId, email: `p${i}@example.com` });
    await flush();
    expect(sent).toHaveLength(20);
    const { invites } = await gm.query(api.members.access, { campaignId });
    expect(invites).toHaveLength(21);
  });

  it("limits to 3 emails a day per recipient across campaigns", async () => {
    const { gm, flush } = await setup();
    for (let i = 0; i < 4; i++) {
      const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: `C${i}`, idempotencyKey: key() });
      await gm.mutation(api.members.invite, { campaignId, email: "same@example.com" });
    }
    await flush();
    expect(sent).toHaveLength(3);
  });

  it("sends nothing to an address with an unverified account, but stores the invite", async () => {
    const { t, gm, campaignId, flush } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { email: "unverified@example.com" }));
    await gm.mutation(api.members.invite, { campaignId, email: "unverified@example.com" });
    await flush();
    expect(sent).toHaveLength(0);
    const { invites } = await gm.query(api.members.access, { campaignId });
    expect(invites).toHaveLength(1);
  });

  it("emails a verified existing account", async () => {
    const { t, gm, campaignId, flush } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { email: "ok@example.com", emailVerificationTime: 5 }));
    await gm.mutation(api.members.invite, { campaignId, email: "ok@example.com" });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it("sends nothing on the e2e backend (fake mode)", async () => {
    set({ E2E_AUTH_ENABLED: "true", CONVEX_CLOUD_URL: "http://127.0.0.1:3210" });
    const { gm, campaignId, flush } = await setup();
    await gm.mutation(api.members.invite, { campaignId, email: "a@example.com" });
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("a revoked invite is not emailed", async () => {
    const { gm, campaignId, flush } = await setup();
    const inviteId = await gm.mutation(api.members.invite, { campaignId, email: "a@example.com" });
    await gm.mutation(api.members.revokeInvite, { inviteId });
    await flush();
    expect(sent).toHaveLength(0);
  });
});
