import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Sessions as the hub (TASK-SESSIONS-HUB): `sessionPrep.current` names the live (else newest planned) session and its
// linked encounter, so the encounter tracker can show a 'Session N' chip that links back to the Play stage. GM-only
// (K10): anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN.

const EMAILS = "gm@example.com,p1@example.com,out@example.com";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Ford", idempotencyKey: key() });
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code: joinCode });
  const newSession = async () => (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
  const linkNew = async (sessionId: string) =>
    (await gm.mutation(api.sessionPrep.createEncounter, { campaignId, sessionId, idempotencyKey: key() })).encounterId;
  const current = () => gm.query(api.sessionPrep.current, { campaignId });
  return { t, gm, p1, out, campaignId, newSession, linkNew, current };
}

describe("sessionPrep.current: access", () => {
  useAllowlist(EMAILS);

  it("refuses anonymous callers (UNAUTHENTICATED), outsiders (NOT_FOUND) and players (FORBIDDEN); the GM reads it", async () => {
    const f = await setup();
    await f.linkNew(await f.newSession());
    type Client = typeof f.gm;
    const run = (c: Client) => c.query(api.sessionPrep.current, { campaignId: f.campaignId });
    expect(await code(run(f.t as unknown as Client))).toBe("UNAUTHENTICATED");
    expect(await code(run(f.out))).toBe("NOT_FOUND");
    expect(await code(run(f.p1))).toBe("FORBIDDEN");
    expect(await code(run(f.gm))).toBe("ok");
  });
});

describe("sessionPrep.current: which session", () => {
  useAllowlist(EMAILS);

  it("is null without a session, without a link and after D8 deletes the linked encounter", async () => {
    const f = await setup();
    expect(await f.current()).toBeNull();
    const sessionId = await f.newSession();
    expect(await f.current()).toBeNull();
    const encounterId = await f.linkNew(sessionId);
    expect(await f.current()).toEqual({ sessionId, n: 1, live: false, encounterId });
    await f.gm.mutation(api.encounters.remove, { campaignId: f.campaignId, encounterId });
    expect(await f.current()).toBeNull();
  });

  it("prefers the live session over a newer planned one, else the newest planned one; a played one is never used", async () => {
    const f = await setup();
    const first = await f.newSession();
    const second = await f.newSession();
    const e1 = await f.linkNew(first);
    const e2 = await f.linkNew(second);
    expect(await f.current()).toEqual({ sessionId: second, n: 2, live: false, encounterId: e2 });
    await f.gm.mutation(api.sessions.start, { campaignId: f.campaignId, sessionId: first, idempotencyKey: key() });
    expect(await f.current()).toEqual({ sessionId: first, n: 1, live: true, encounterId: e1 });
    await f.gm.mutation(api.sessions.end, { campaignId: f.campaignId, idempotencyKey: key() });
    expect(await f.current()).toEqual({ sessionId: second, n: 2, live: false, encounterId: e2 });
    await f.gm.mutation(api.sessionRecords.setPlayed, { campaignId: f.campaignId, sessionId: second, played: true });
    expect(await f.current()).toBeNull();
  });
});
