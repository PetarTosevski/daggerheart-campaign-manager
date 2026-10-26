import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_COMBAT_TOKENS } from "../../convex/lib/combatMaps";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D10 S8: the Combat Map's '＋ Session encounter' (B11, Q2 default a + refuse). `sessionEncounter` names the live
// (else newest planned) session's linked encounter; `placeSessionEncounter` starts it through D8's start rules when
// it is a draft or ended and places every unplaced, undefeated instance (a Solo 2 × 2). Another running encounter:
// ENCOUNTER_RUNNING; no linked encounter: SESSION_NO_ENCOUNTER. Both are GM functions (player FORBIDDEN).

const EMAILS = "gm@example.com,p1@example.com,out@example.com";
const BURROWER = { kind: "srd" as const, adversaryId: "acid-burrower" }; // Solo
const BANDIT = { kind: "srd" as const, adversaryId: "jagged-knife-bandit" }; // Standard
const BEAR = { kind: "srd" as const, adversaryId: "bear" }; // Bruiser

type Source = typeof BURROWER | typeof BANDIT | typeof BEAR;

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
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const newSession = async () => (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
  const sessionEncounter = async (sessionId: string) =>
    (await gm.mutation(api.sessionPrep.createEncounter, { campaignId, sessionId, idempotencyKey: key() })).encounterId;
  const add = (encounterId: string, source: Source, count: number) =>
    gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source, count, summoned: false, idempotencyKey: key() });
  const read = (mid: string = mapId) => gm.query(api.combatTokens.sessionEncounter, { campaignId, mapId: mid });
  const place = (idempotencyKey = key(), mid: string = mapId) => gm.mutation(api.combatTokens.placeSessionEncounter, { campaignId, mapId: mid, idempotencyKey });
  const tokens = () => gm.query(api.combatTokens.list, { campaignId, mapId });
  const status = (encounterId: Id<"encounters">) => t.run(async (ctx) => (await ctx.db.get("encounters", encounterId))!.status);
  return { t, gm, p1, out, campaignId, mapId, newSession, sessionEncounter, add, read, place, tokens, status };
}

/** A planned session whose encounter (a draft) holds a Solo and two Standards. */
async function withPlan() {
  const f = await setup();
  const sessionId = await f.newSession();
  const encounterId = await f.sessionEncounter(sessionId);
  await f.add(encounterId, BURROWER, 1);
  await f.add(encounterId, BANDIT, 2);
  return { ...f, sessionId, encounterId };
}

describe("session encounter: access", () => {
  useAllowlist(EMAILS);

  it("keeps both functions from anonymous callers (UNAUTHENTICATED), outsiders (NOT_FOUND) and players (FORBIDDEN); the GM runs each", async () => {
    const f = await withPlan();
    const { campaignId, mapId } = f;
    type Client = typeof f.gm;
    const all = {
      sessionEncounter: (c: Client) => c.query(api.combatTokens.sessionEncounter, { campaignId, mapId }),
      placeSessionEncounter: (c: Client) => c.mutation(api.combatTokens.placeSessionEncounter, { campaignId, mapId, idempotencyKey: key() }),
    };
    for (const [name, run] of Object.entries(all)) {
      expect([name, await code(run(f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
      expect([name, await code(run(f.out))]).toEqual([name, "NOT_FOUND"]);
      expect([name, await code(run(f.p1))]).toEqual([name, "FORBIDDEN"]);
      expect([name, await code(run(f.gm))]).toEqual([name, "ok"]);
    }
  });
});

describe("session encounter: which session (B11)", () => {
  useAllowlist(EMAILS);

  it("is null with 'No planned session with an encounter' without a session, without a link, and after D8 deletes the encounter", async () => {
    const f = await setup();
    const none = { title: "No planned session with an encounter", session: null };
    expect(await f.read()).toEqual(none);
    expect(await code(f.place())).toBe("SESSION_NO_ENCOUNTER");
    const sessionId = await f.newSession();
    expect(await f.read()).toEqual(none);
    expect(await code(f.place())).toBe("SESSION_NO_ENCOUNTER");
    const encounterId = await f.sessionEncounter(sessionId);
    expect((await f.read()).session?.encounterId).toBe(encounterId);
    await f.gm.mutation(api.encounters.remove, { campaignId: f.campaignId, encounterId });
    expect(await f.read()).toEqual(none);
    expect(await code(f.place())).toBe("SESSION_NO_ENCOUNTER");
  });

  it("names the session and its adversaries in the board's role order; an empty encounter is 'no adversaries planned'", async () => {
    const f = await setup();
    const sessionId = await f.newSession();
    const encounterId = await f.sessionEncounter(sessionId);
    expect((await f.read()).title).toBe("Session 1: no adversaries planned");
    await f.add(encounterId, BEAR, 2);
    await f.add(encounterId, BURROWER, 1);
    await f.add(encounterId, BANDIT, 1);
    const read = await f.read();
    expect(read.title).toBe("Session 1: 1× Standard, 2× Bruiser, 1× Solo");
    expect(read.session).toMatchObject({ n: 1, encounterId, encounterName: "Session 1 encounter", status: "draft", adversaries: 4, unplaced: 4 });
  });

  it("uses the live session over a newer planned one, else the newest planned one; a played session is never used", async () => {
    const f = await setup();
    const first = await f.newSession();
    const second = await f.newSession();
    const e1 = await f.sessionEncounter(first);
    const e2 = await f.sessionEncounter(second);
    expect((await f.read()).session).toMatchObject({ n: 2, encounterId: e2 });
    await f.gm.mutation(api.sessions.start, { campaignId: f.campaignId, sessionId: first, idempotencyKey: key() });
    expect((await f.read()).session).toMatchObject({ n: 1, encounterId: e1 });
    await f.gm.mutation(api.sessions.end, { campaignId: f.campaignId, idempotencyKey: key() });
    expect((await f.read()).session).toMatchObject({ n: 2, encounterId: e2 });
    await f.gm.mutation(api.sessionRecords.setPlayed, { campaignId: f.campaignId, sessionId: second, played: true });
    expect((await f.read()).session).toBeNull();
  });

  it("reads an unknown or another campaign's map as nothing unplaced, and refuses to place on it (COMBAT_MAP_NOT_FOUND)", async () => {
    const f = await withPlan();
    expect((await f.read("nope")).session?.unplaced).toBe(0);
    expect(await code(f.place(key(), "nope"))).toBe("COMBAT_MAP_NOT_FOUND");
    const { campaignId: otherCampaign } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const { mapId: otherMap } = await f.gm.mutation(api.combatMaps.create, { campaignId: otherCampaign, size: "small", idempotencyKey: key() });
    expect(await code(f.place(key(), otherMap))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await f.status(f.encounterId)).toBe("draft");
  });
});

describe("session encounter: placing (Q2)", () => {
  useAllowlist(EMAILS);

  it("starts a draft encounter and places a Solo (2 × 2) and two Standards once; a second click adds nothing; a retry returns the stored result", async () => {
    const f = await withPlan();
    const k = key();
    expect(await f.place(k)).toEqual({ n: 1, added: 3, started: true });
    expect(await f.status(f.encounterId)).toBe("running");
    const placed = await f.tokens();
    const rows = placed.map((tk) => [tk.name, tk.kind, tk.side, tk.size, tk.tracked] as const);
    expect(rows.sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ["Acid Burrower", "adversary", "enemy", 2, true],
      ["Jagged Knife Bandit", "adversary", "enemy", 1, true],
      ["Jagged Knife Bandit 2", "adversary", "enemy", 1, true],
    ]);
    // No two footprints overlap.
    const covers = (a: (typeof placed)[number], b: (typeof placed)[number]) => a.x < b.x + b.size && a.x + a.size > b.x && a.y < b.y + b.size && a.y + a.size > b.y;
    for (const a of placed) for (const b of placed) if (a !== b) expect(covers(a, b)).toBe(false);
    expect((await f.read()).session).toMatchObject({ status: "running", unplaced: 0 });
    expect(await f.place(k)).toEqual({ n: 1, added: 3, started: true });
    expect(await f.place()).toEqual({ n: 1, added: 0, started: false });
    expect(await f.tokens()).toHaveLength(3);
    // The running queue on the Combatants card is empty too.
    expect((await f.gm.query(api.combatTokens.combatants, { campaignId: f.campaignId, mapId: f.mapId })).queue).toEqual([]);
  });

  it("refuses with ENCOUNTER_RUNNING while another encounter runs and writes nothing", async () => {
    const f = await withPlan();
    const { encounterId: other } = await f.gm.mutation(api.encounters.create, { campaignId: f.campaignId, name: "Ambush", idempotencyKey: key() });
    await f.gm.mutation(api.encounters.start, { campaignId: f.campaignId, encounterId: other });
    expect(await code(f.place())).toBe("ENCOUNTER_RUNNING");
    expect(await f.status(f.encounterId)).toBe("draft");
    expect(await f.tokens()).toEqual([]);
    await f.gm.mutation(api.encounters.end, { campaignId: f.campaignId, encounterId: other });
    expect((await f.place()).added).toBe(3);
  });

  it("restarts an ended encounter, skips defeated and already placed instances, and adds only what is missing", async () => {
    const f = await withPlan();
    const { instanceIds: [bear] } = await f.add(f.encounterId, BEAR, 1);
    await f.gm.mutation(api.encounters.start, { campaignId: f.campaignId, encounterId: f.encounterId });
    await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId: f.campaignId, mapId: f.mapId, instanceIds: [bear!], idempotencyKey: key() });
    await f.gm.mutation(api.encounters.end, { campaignId: f.campaignId, encounterId: f.encounterId });
    const bandit = await f.t.run(async (ctx) => {
      const rows = await ctx.db
        .query("encounterAdversaries")
        .withIndex("by_encounter_order", (q) => q.eq("encounterId", f.encounterId))
        .take(10);
      const row = rows.find((r) => r.label === "Jagged Knife Bandit 2")!;
      await ctx.db.patch("encounterAdversaries", row._id, { defeated: true });
      return row._id;
    });
    expect(bandit).toBeTruthy();
    expect((await f.read()).session).toMatchObject({ status: "ended", adversaries: 4, unplaced: 2 });
    expect(await f.place()).toEqual({ n: 1, added: 2, started: true });
    expect(await f.status(f.encounterId)).toBe("running");
    expect((await f.tokens()).map((tk) => tk.name).sort()).toEqual(["Acid Burrower", "Bear", "Jagged Knife Bandit"]);
  });

  it("places an already running session encounter without restarting it", async () => {
    const f = await withPlan();
    await f.gm.mutation(api.encounters.start, { campaignId: f.campaignId, encounterId: f.encounterId });
    const before = await f.t.run(async (ctx) => (await ctx.db.get("encounters", f.encounterId))!.startedAt);
    expect(await f.place()).toEqual({ n: 1, added: 3, started: false });
    expect(await f.t.run(async (ctx) => (await ctx.db.get("encounters", f.encounterId))!.startedAt)).toBe(before);
  });

  it("refuses past MAX_COMBAT_TOKENS (COMBAT_TOKEN_LIMIT) and leaves the encounter a draft", async () => {
    const f = await withPlan();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < MAX_COMBAT_TOKENS - 2; i++) {
        await ctx.db.insert("combatTokens", {
          campaignId: f.campaignId,
          mapId: f.mapId,
          ref: { kind: "custom", name: `Rock ${i}`, hp: 0, hpMax: 0, stress: 0, stressMax: 0, conditions: [] },
          side: "neutral",
          size: 1,
          x: 0,
          y: 0,
          face: 0,
          light: "none",
          revealedTo: [],
        });
      }
    });
    expect(await code(f.place())).toBe("COMBAT_TOKEN_LIMIT");
    expect(await f.status(f.encounterId)).toBe("draft");
    expect(await f.tokens()).toHaveLength(MAX_COMBAT_TOKENS - 2);
  });
});
