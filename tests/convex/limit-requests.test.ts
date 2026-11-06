import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { capLimits, reserve } from "../../convex/lib/lorekeeper/caps";
import { escapeHtml, limitRequestEmail } from "../../convex/lorekeeperLimitRequests";
import { PRIMARY_MODEL } from "../../src/lib/lorekeeper/pricing";
import { allowWorldEmails, buildWorld, WORLD_EMAILS, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

// Config AD12 (Q21 changed, N10 b): a GM or co-GM asks the owner for higher Lorekeeper limits; one pending request per
// campaign, refused while the owner's switch is off; the owner is emailed; the owner approves with their own numbers
// or declines, or sets a campaign's numbers directly; capLimits picks the numbers up on the next question.

allowWorldEmails();

const fail = (p: Promise<unknown>) => p.then(() => "ok", errorCode);

async function openWorld(): Promise<World> {
  const w = await buildWorld();
  await w.as("appOwner").mutation(api.adminLorekeeper.setLimit, { change: { field: "allowGmRequests", value: true } });
  return w;
}

const ask = (w: World, who: "gm" | "coGm" | "player" = "gm", wants: Record<string, number> = { dailyQuestions: 60 }, reason = "Big session") =>
  w.as(who).mutation(api.lorekeeperLimitRequests.request, { campaignId: w.campaignId, wants, reason });

const scheduled = (w: World) => w.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

describe("lorekeeperLimitRequests.request (GM and co-GM)", () => {
  it("is refused while the owner's switch is off (the default)", async () => {
    const w = await buildWorld();
    expect(await fail(ask(w))).toBe("LIMIT_REQUESTS_OFF");
  });

  it("allows one pending request per campaign, from the GM or a co-GM, and never from a player", async () => {
    const w = await openWorld();
    expect(await fail(ask(w, "player"))).toBe("FORBIDDEN");
    await ask(w, "coGm", { dailyWebSearches: 30, bookPages: 600 });
    expect(await fail(ask(w, "gm"))).toBe("LIMIT_REQUEST_PENDING");
    const rows = await w.t.run((ctx) => ctx.db.query("lorekeeperLimitRequests").collect());
    expect(rows).toMatchObject([{ requestedBy: w.users.coGm, wants: { dailyWebSearches: 30, bookPages: 600 }, status: "pending" }]);
  });

  it("checks the numbers and the reason", async () => {
    const w = await openWorld();
    expect(await fail(ask(w, "gm", {}))).toBe("INVALID");
    expect(await fail(ask(w, "gm", { dailyQuestions: 1001 }))).toBe("INVALID");
    expect(await fail(ask(w, "gm", { dailyQuestions: 2.5 }))).toBe("INVALID");
    expect(await fail(ask(w, "gm", { dailyQuestions: -1 }))).toBe("INVALID");
    expect(await fail(ask(w, "gm", { dailyQuestions: 10 }, "   "))).toBe("INVALID");
    expect(await fail(ask(w, "gm", { dailyQuestions: 10 }, "x".repeat(301)))).toBe("INVALID");
    expect(await fail(ask(w, "gm", { dailyQuestions: 1000, bookCount: 0 }, "x".repeat(300)))).toBe("ok");
  });

  it("lets the GM or a co-GM cancel, never a player, and is rate-limited per GM", async () => {
    const w = await openWorld();
    const id = await ask(w);
    expect(await fail(w.as("player").mutation(api.lorekeeperLimitRequests.cancel, { campaignId: w.campaignId, requestId: id }))).toBe("FORBIDDEN");
    await w.as("coGm").mutation(api.lorekeeperLimitRequests.cancel, { campaignId: w.campaignId, requestId: id });
    expect(await fail(w.as("gm").mutation(api.lorekeeperLimitRequests.cancel, { campaignId: w.campaignId, requestId: id }))).toBe("NOT_FOUND");
    expect(await w.t.run((ctx) => ctx.db.query("lorekeeperLimitRequests").collect())).toEqual([]);
    for (let i = 0; i < 4; i++) {
      const next = await ask(w);
      await w.as("gm").mutation(api.lorekeeperLimitRequests.cancel, { campaignId: w.campaignId, requestId: next });
    }
    expect(await fail(ask(w))).toBe("RATE_LIMITED");
    expect(await fail(ask(w, "coGm"))).toBe("ok");
  });

  it("schedules one email to the owner per request", async () => {
    const w = await openWorld();
    await ask(w);
    const jobs = await scheduled(w);
    expect(jobs.map((j) => j.name)).toEqual(["lorekeeperLimitRequests:notifyOwner"]);
  });
});

describe("the owner's email (N10 b)", () => {
  const NAMES = ["AUTH_RESEND_KEY", "MAIL_FROM", "SITE_URL"];
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
    process.env.AUTH_RESEND_KEY = "re_secret_key_123";
    process.env.MAIL_FROM = "app@example.com";
    process.env.SITE_URL = "https://app.example.com/";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [n, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[n];
      else process.env[n] = value;
    }
  });

  it("goes to the owner's stored address, escapes the reason and carries no key", async () => {
    const w = await openWorld();
    await w.t.run((ctx) => ctx.db.patch("users", w.users.gm, { name: "Mira" }));
    const requestId = await ask(w, "gm", { dailyQuestions: 80 }, `<script>alert("x")</script> & more`);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await w.t.action(internal.lorekeeperLimitRequests.notifyOwner, { requestId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { to: string[]; subject: string; text: string; html: string };
    expect(body.to).toEqual([WORLD_EMAILS.appOwner]);
    expect(body.subject).toContain("Lorekeeper limit request");
    expect(body.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more");
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("Mira");
    expect(body.html).toContain("https://app.example.com/admin");
    expect(JSON.stringify(body)).not.toContain("re_secret_key_123");
  });

  it("sends nothing for a request decided or cancelled before the send", async () => {
    const w = await openWorld();
    const requestId = await ask(w);
    await w.as("gm").mutation(api.lorekeeperLimitRequests.cancel, { campaignId: w.campaignId, requestId });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await w.t.action(internal.lorekeeperLimitRequests.notifyOwner, { requestId });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds the email text without HTML in the subject or the plain text escaping", () => {
    const email = limitRequestEmail({ gmName: "  Ann\n", campaignName: "The\nVale", wants: { bookCount: 4 }, reason: "a < b" }, null);
    expect(email.subject).toBe("Lorekeeper limit request: The Vale");
    expect(email.text).toContain("Books: 4");
    expect(email.text).toContain("a < b");
    expect(email.html).toContain("a &lt; b");
    expect(escapeHtml(`'"<>&`)).toBe("&#39;&quot;&lt;&gt;&amp;");
  });
});

describe("decide, setCampaignLimits and forCampaign", () => {
  it("approves with the owner's numbers, which capLimits uses on the next question", async () => {
    const w = await openWorld();
    const requestId = await ask(w, "gm", { dailyQuestions: 60, dailyWebSearches: 50 });
    await w.as("appOwner").mutation(api.lorekeeperLimitRequests.decide, { requestId, approve: true, numbers: { dailyQuestions: 2 } });
    expect(await w.t.run((ctx) => capLimits(ctx, w.campaignId))).toMatchObject({ dailyQuestions: 2, dailyWebSearches: 20 });
    // The next questions: the third of the day is refused by the campaign's new number.
    const question = () =>
      w.t.run(async (ctx) => {
        const user = (await ctx.db.get("users", w.users.player))!;
        const campaign = (await ctx.db.get("campaigns", w.campaignId))!;
        return reserve(ctx, user, campaign, PRIMARY_MODEL, Date.now());
      });
    await question();
    await question();
    expect(await fail(question())).toBe("LOREKEEPER_CAP_USER");

    const view = await w.as("coGm").query(api.lorekeeperLimitRequests.forCampaign, { campaignId: w.campaignId });
    expect(view).toMatchObject({
      requestsOpen: true,
      current: { dailyQuestions: 2, dailyWebSearches: 20, bookCount: null, bookPages: null, custom: true },
      pending: null,
      lastDecision: { _id: requestId, status: "approved", mine: false, wants: { dailyQuestions: 60, dailyWebSearches: 50 } },
    });
    expect(JSON.stringify(view)).not.toContain(WORLD_EMAILS.appOwner);
    const audit = await w.t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
    expect(audit.filter((a) => a.action === "limits.request.approve")).toMatchObject([
      { actorId: w.users.appOwner, field: "dailyQuestions", from: "default", to: 2, target: requestId },
    ]);
  });

  it("approves with the asked numbers when the owner gives none; declines; decides once", async () => {
    const w = await openWorld();
    const first = await ask(w, "gm", { dailyWebSearches: 40 });
    await w.as("appOwner").mutation(api.lorekeeperLimitRequests.decide, { requestId: first, approve: true });
    expect(await w.t.run((ctx) => capLimits(ctx, w.campaignId))).toMatchObject({ dailyWebSearches: 40 });
    expect(await fail(w.as("appOwner").mutation(api.lorekeeperLimitRequests.decide, { requestId: first, approve: false }))).toBe("INVALID");

    const second = await ask(w, "gm", { dailyQuestions: 99 });
    expect(await fail(w.as("gm").mutation(api.lorekeeperLimitRequests.decide, { requestId: second, approve: true }))).toBe("FORBIDDEN");
    await w.as("appOwner").mutation(api.lorekeeperLimitRequests.decide, { requestId: second, approve: false });
    const view = await w.as("gm").query(api.lorekeeperLimitRequests.forCampaign, { campaignId: w.campaignId });
    expect(view.lastDecision).toMatchObject({ _id: second, status: "declined", mine: true });
    expect(view.current).toMatchObject({ dailyQuestions: 40, dailyWebSearches: 40 });
    // A new request is allowed once the last one is decided.
    expect(await fail(ask(w))).toBe("ok");
    expect(await fail(w.as("appOwner").mutation(api.lorekeeperLimitRequests.decide, { requestId: second, approve: true, numbers: {} }))).toBe(
      "INVALID",
    );
  });

  it("refuses owner numbers out of range", async () => {
    const w = await openWorld();
    const requestId = await ask(w);
    const decide = (numbers: Record<string, number>) =>
      fail(w.as("appOwner").mutation(api.lorekeeperLimitRequests.decide, { requestId, approve: true, numbers }));
    expect(await decide({ dailyQuestions: 10_001 })).toBe("INVALID");
    expect(await decide({ bookPages: 1.5 })).toBe("INVALID");
    expect(await decide({ dailyQuestions: 10_000 })).toBe("ok");
  });

  it("sets one number directly and clears it back to the default, audited", async () => {
    const w = await openWorld();
    const set = (field: "dailyQuestions" | "bookCount", value: number | null) =>
      w.as("appOwner").mutation(api.lorekeeperLimitRequests.setCampaignLimits, { campaignId: w.campaignId, change: { field, value } });
    await set("dailyQuestions", 7);
    await set("bookCount", 3);
    expect(await w.t.run((ctx) => capLimits(ctx, w.campaignId))).toMatchObject({ dailyQuestions: 7 });
    await set("dailyQuestions", null);
    expect(await w.t.run((ctx) => capLimits(ctx, w.campaignId))).toMatchObject({ dailyQuestions: 40 });
    const view = await w.as("gm").query(api.lorekeeperLimitRequests.forCampaign, { campaignId: w.campaignId });
    expect(view.current).toMatchObject({ dailyQuestions: 40, bookCount: 3, custom: true });
    expect(await fail(set("bookCount", -1))).toBe("INVALID");
    const audit = await w.t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
    expect(audit.filter((a) => a.action === "limits.campaign.set")).toMatchObject([
      { field: "dailyQuestions", from: "default", to: 7, target: w.campaignId },
      { field: "bookCount", from: "default", to: 3 },
      { field: "dailyQuestions", from: 7, to: "default" },
    ]);
  });
});

describe("lorekeeperLimitRequests.list (owner)", () => {
  it("lists one status at a time: pending oldest first with names and current numbers, decided newest first", async () => {
    const w = await openWorld();
    await w.t.run((ctx) => ctx.db.patch("users", w.users.gm, { name: "Mira" }));
    const { campaignId: second } = await w.as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Second", idempotencyKey: key() });
    const a = await ask(w);
    const b = await w.as("gm").mutation(api.lorekeeperLimitRequests.request, { campaignId: second, wants: { bookCount: 2 }, reason: "More books" });
    const list = (status: "pending" | "approved" | "declined") =>
      w.as("appOwner").query(api.lorekeeperLimitRequests.list, { status, paginationOpts: { numItems: 10, cursor: null } });
    const pending = await list("pending");
    expect(pending.page[0]).toMatchObject({ _id: a, campaignName: expect.any(String), requesterName: "Mira", status: "pending", current: { dailyQuestions: 40 } });
    expect(pending.page.map((r) => r._id)).toEqual([a, b]);
    expect(pending.page[1]).toMatchObject({ campaignName: "Second", wants: { bookCount: 2 } });
    expect(JSON.stringify(pending)).not.toContain(WORLD_EMAILS.gm);
    await w.as("appOwner").mutation(api.lorekeeperLimitRequests.decide, { requestId: a, approve: false });
    expect((await list("declined")).page.map((r) => r._id)).toEqual([a]);
    expect((await list("approved")).page).toEqual([]);
    expect(await fail(w.as("gm").query(api.lorekeeperLimitRequests.list, { status: "pending", paginationOpts: { numItems: 10, cursor: null } }))).toBe(
      "FORBIDDEN",
    );
  });
});
