import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_ENCOUNTERS } from "../../convex/lib/encounters";
import { MAX_SCENES } from "../../convex/lib/validators/sessions";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// D10 S4: session prep (B3, K6, K10, Q1). The GM plans scenes, writes hooks and creates or links the session's one D8
// encounter; the summary carries its Battle Points. Players never reach prep (FORBIDDEN).

const EMAILS = "gm@example.com,p1@example.com,out@example.com";
const BEAR = { kind: "srd" as const, adversaryId: "bear" }; // Bruiser, 4 BP
const BANDIT = { kind: "srd" as const, adversaryId: "jagged-knife-bandit" }; // Standard, 2 BP

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Prep", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const create = async () => (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
  const get = (sessionId: string) => gm.query(api.sessionPrep.get, { campaignId, sessionId });
  const addScene = async (sessionId: string, type?: "combat" | "social" | "exploration" | "downtime") =>
    (await gm.mutation(api.sessionPrep.addScene, { campaignId, sessionId, ...(type ? { type } : {}) })).sceneId;
  const createEncounter = async (sessionId: string) =>
    (await gm.mutation(api.sessionPrep.createEncounter, { campaignId, sessionId, idempotencyKey: key() })).encounterId;
  return { t, gm, p1, out, ids, campaignId, create, get, addScene, createEncounter };
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (e) {
    return errorCode(e);
  }
  throw new Error("expected the call to fail");
}

async function addPcs(env: Awaited<ReturnType<typeof setup>>, statuses: ("active" | "away")[]) {
  await env.t.run(async (ctx) => {
    for (const status of statuses) {
      await ctx.db.insert("characters", { campaignId: env.campaignId, ownerId: env.ids.p1, createdBy: env.ids.p1, status, sheet: {} as never, createdAt: 0, updatedAt: 0 });
    }
  });
}

describe("session prep", () => {
  useAllowlist(EMAILS);

  it("get on a session without prep is empty and writes nothing", async () => {
    const env = await setup();
    const sessionId = await env.create();
    expect(await env.get(sessionId)).toEqual({ scenes: [], hooks: "", encounter: null });
    expect(await env.t.run((ctx) => ctx.db.query("sessionPrep").take(5))).toEqual([]);
  });

  it("addScene appends a Combat scene (or the given type) with a server id; setScene changes the type or the trimmed text", async () => {
    const env = await setup();
    const sessionId = await env.create();
    const a = await env.addScene(sessionId);
    const b = await env.addScene(sessionId, "social");
    expect(a).not.toBe(b);
    await env.gm.mutation(api.sessionPrep.setScene, { campaignId: env.campaignId, sessionId, sceneId: a, text: "  Ambush at the ford  " });
    await env.gm.mutation(api.sessionPrep.setScene, { campaignId: env.campaignId, sessionId, sceneId: b, type: "exploration" });
    expect((await env.get(sessionId)).scenes).toEqual([
      { id: a, type: "combat", text: "Ambush at the ford" },
      { id: b, type: "exploration", text: "" },
    ]);
    // Exactly one field per intent; text over 300 characters is INVALID.
    const set = (extra: object) => env.gm.mutation(api.sessionPrep.setScene, { campaignId: env.campaignId, sessionId, sceneId: a, ...extra });
    expect(await failure(set({}))).toBe("INVALID");
    expect(await failure(set({ type: "social", text: "x" }))).toBe("INVALID");
    expect(await failure(set({ text: "x".repeat(301) }))).toBe("INVALID");
  });

  it("removeScene drops one scene; a stale scene id is SESSION_SCENE_NOT_FOUND for set and remove", async () => {
    const env = await setup();
    const sessionId = await env.create();
    const a = await env.addScene(sessionId);
    const b = await env.addScene(sessionId, "downtime");
    await env.gm.mutation(api.sessionPrep.removeScene, { campaignId: env.campaignId, sessionId, sceneId: a });
    expect((await env.get(sessionId)).scenes.map((s) => s.id)).toEqual([b]);
    expect(await failure(env.gm.mutation(api.sessionPrep.removeScene, { campaignId: env.campaignId, sessionId, sceneId: a }))).toBe("SESSION_SCENE_NOT_FOUND");
    expect(await failure(env.gm.mutation(api.sessionPrep.setScene, { campaignId: env.campaignId, sessionId, sceneId: a, text: "x" }))).toBe(
      "SESSION_SCENE_NOT_FOUND",
    );
    // Before any prep row exists, too.
    const other = await env.create();
    expect(await failure(env.gm.mutation(api.sessionPrep.removeScene, { campaignId: env.campaignId, sessionId: other, sceneId: b }))).toBe("SESSION_SCENE_NOT_FOUND");
  });

  it(`addScene refuses past ${MAX_SCENES} scenes with SESSION_SCENE_LIMIT`, async () => {
    const env = await setup();
    const sessionId = await env.create();
    for (let i = 0; i < MAX_SCENES; i++) await env.addScene(sessionId);
    expect(await failure(env.addScene(sessionId))).toBe("SESSION_SCENE_LIMIT");
    expect((await env.get(sessionId)).scenes).toHaveLength(MAX_SCENES);
  });

  it("setHooks trims, clears with empty text, refuses more than 4000 characters; a blank first write creates no row", async () => {
    const env = await setup();
    const sessionId = await env.create();
    const set = (hooks: string) => env.gm.mutation(api.sessionPrep.setHooks, { campaignId: env.campaignId, sessionId, hooks });
    await set("   ");
    expect(await env.t.run((ctx) => ctx.db.query("sessionPrep").take(5))).toEqual([]);
    await set("  The miller owes Thane money.\nWho lit the beacon?  ");
    expect((await env.get(sessionId)).hooks).toBe("The miller owes Thane money.\nWho lit the beacon?");
    expect(await failure(set("x".repeat(4001)))).toBe("INVALID");
    await set("");
    expect((await env.get(sessionId)).hooks).toBe("");
  });

  it("prep is per session: another session's prep stays apart, and a deleted session is SESSION_NOT_FOUND", async () => {
    const env = await setup();
    const one = await env.create();
    const two = await env.create();
    await env.addScene(one);
    expect((await env.get(two)).scenes).toEqual([]);
    await env.gm.mutation(api.sessionRecords.remove, { campaignId: env.campaignId, sessionId: one });
    expect(await failure(env.get(one))).toBe("SESSION_NOT_FOUND");
    expect(await failure(env.get("not-an-id"))).toBe("SESSION_NOT_FOUND");
  });

  it("a session id of another campaign is SESSION_NOT_FOUND", async () => {
    const env = await setup();
    const { campaignId: otherCampaign } = await env.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const foreign = (await env.gm.mutation(api.sessionRecords.create, { campaignId: otherCampaign, idempotencyKey: key() })).sessionId;
    expect(await failure(env.get(foreign))).toBe("SESSION_NOT_FOUND");
    expect(await failure(env.addScene(foreign))).toBe("SESSION_NOT_FOUND");
    expect(await failure(env.createEncounter(foreign))).toBe("SESSION_NOT_FOUND");
  });

  describe("the session encounter (Q1)", () => {
    it("createEncounter makes a draft 'Session N encounter' with the active PCs, links it, and the summary counts Battle Points", async () => {
      const env = await setup();
      await addPcs(env, ["active", "active", "active", "away"]);
      await env.create();
      const sessionId = await env.create(); // Session 2
      const idempotencyKey = key();
      const args = { campaignId: env.campaignId, sessionId, idempotencyKey };
      const { encounterId } = await env.gm.mutation(api.sessionPrep.createEncounter, args);
      // The key makes a retry a no-op.
      expect(await env.gm.mutation(api.sessionPrep.createEncounter, args)).toEqual({ encounterId });
      const encounter = await env.t.run((ctx) => ctx.db.get("encounters", encounterId));
      expect(encounter).toMatchObject({ name: "Session 2 encounter", status: "draft", pcs: 3, adjustments: [] });
      // 3 PCs: budget 3 × 3 + 2 = 11.
      expect((await env.get(sessionId)).encounter).toEqual({
        _id: encounterId,
        name: "Session 2 encounter",
        status: "draft",
        pcs: 3,
        adversaries: 0,
        budget: 11,
        spent: 0,
        verdict: "11 BP left",
      });
      // Adding through D8's own functions moves the summary: two Bandits (2 + 2) and a Bear (4), then 'hard' (+2).
      await env.gm.mutation(api.encounters.addAdversary, { campaignId: env.campaignId, encounterId, source: BANDIT, count: 2, summoned: false, idempotencyKey: key() });
      await env.gm.mutation(api.encounters.addAdversary, { campaignId: env.campaignId, encounterId, source: BEAR, count: 1, summoned: false, idempotencyKey: key() });
      expect((await env.get(sessionId)).encounter).toMatchObject({ adversaries: 3, budget: 11, spent: 8, verdict: "3 BP left" });
      await env.gm.mutation(api.encounters.addAdversary, { campaignId: env.campaignId, encounterId, source: BEAR, count: 1, summoned: false, idempotencyKey: key() });
      expect((await env.get(sessionId)).encounter).toMatchObject({ spent: 12, verdict: "Over by 1 BP" });
      await env.gm.mutation(api.encounters.setBudget, { campaignId: env.campaignId, encounterId, change: { kind: "adjustment", adjustment: "hard", on: true } });
      expect((await env.get(sessionId)).encounter).toMatchObject({ budget: 13, spent: 12, verdict: "1 BP left" });
    });

    it("createEncounter uses 4 PCs when nobody is active, and refuses a second encounter with SESSION_HAS_ENCOUNTER", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const encounterId = await env.createEncounter(sessionId);
      expect((await env.t.run((ctx) => ctx.db.get("encounters", encounterId)))!.pcs).toBe(4);
      expect(await failure(env.createEncounter(sessionId))).toBe("SESSION_HAS_ENCOUNTER");
      const { encounterId: other } = await env.gm.mutation(api.encounters.create, { campaignId: env.campaignId, name: "Other", idempotencyKey: key() });
      expect(await failure(env.gm.mutation(api.sessionPrep.linkEncounter, { campaignId: env.campaignId, sessionId, encounterId: other }))).toBe(
        "SESSION_HAS_ENCOUNTER",
      );
      // Re-linking the same one is a no-op.
      expect(await env.gm.mutation(api.sessionPrep.linkEncounter, { campaignId: env.campaignId, sessionId, encounterId })).toBeNull();
    });

    it(`createEncounter refuses past ${MAX_ENCOUNTERS} encounters with ENCOUNTER_LIMIT and links nothing`, async () => {
      const env = await setup();
      const sessionId = await env.create();
      await env.t.run(async (ctx) => {
        for (let i = 0; i < MAX_ENCOUNTERS; i++) {
          await ctx.db.insert("encounters", { campaignId: env.campaignId, name: `E${i}`, status: "ended", pcs: 4, adjustments: [], gmTurn: 1, createdAt: 0, updatedAt: 0 });
        }
      });
      expect(await failure(env.createEncounter(sessionId))).toBe("ENCOUNTER_LIMIT");
      expect((await env.get(sessionId)).encounter).toBeNull();
    });

    it("linkEncounter links an existing encounter of the campaign; another campaign's or a bad id is NOT_FOUND; unlink drops the link only", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const { encounterId } = await env.gm.mutation(api.encounters.create, { campaignId: env.campaignId, name: "Bridge fight", idempotencyKey: key() });
      const { campaignId: otherCampaign } = await env.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
      const { encounterId: foreign } = await env.gm.mutation(api.encounters.create, { campaignId: otherCampaign, name: "Elsewhere", idempotencyKey: key() });
      const link = (id: string) => env.gm.mutation(api.sessionPrep.linkEncounter, { campaignId: env.campaignId, sessionId, encounterId: id });
      expect(await failure(link(foreign))).toBe("NOT_FOUND");
      expect(await failure(link("nope"))).toBe("NOT_FOUND");
      await link(encounterId);
      expect((await env.get(sessionId)).encounter).toMatchObject({ _id: encounterId, name: "Bridge fight", status: "draft" });
      await env.gm.mutation(api.sessionPrep.unlinkEncounter, { campaignId: env.campaignId, sessionId });
      expect((await env.get(sessionId)).encounter).toBeNull();
      expect(await env.t.run((ctx) => ctx.db.get("encounters", encounterId))).not.toBeNull();
      // Unlinking again is a no-op; now another one may be created.
      expect(await env.gm.mutation(api.sessionPrep.unlinkEncounter, { campaignId: env.campaignId, sessionId })).toBeNull();
      await env.createEncounter(sessionId);
    });

    it("an encounter D8 deleted reads as none, and the session may create a new one", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const encounterId = await env.createEncounter(sessionId);
      await env.gm.mutation(api.encounters.remove, { campaignId: env.campaignId, encounterId });
      expect((await env.get(sessionId)).encounter).toBeNull();
      const next = await env.createEncounter(sessionId);
      expect(next).not.toBe(encounterId);
    });

    it("a deleted custom adversary costs nothing; summoned adversaries cost nothing", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const encounterId = await env.createEncounter(sessionId);
      await env.gm.mutation(api.encounters.addAdversary, { campaignId: env.campaignId, encounterId, source: BEAR, count: 1, summoned: true, idempotencyKey: key() });
      const customId = await env.t.run(async (ctx) => {
        const id = await ctx.db.insert("customAdversaries", {
          campaignId: env.campaignId,
          name: "Ogre",
          tier: 1,
          type: "Bruiser",
          description: "",
          motives: "",
          difficulty: 12,
          thresholds: { major: 8, severe: 15 },
          hp: 6,
          stress: 3,
          attack: { modifier: 1, name: "Club", range: "Melee", damage: "1d10+3 phy" },
          experiences: [],
          features: [],
          createdAt: 0,
          updatedAt: 0,
        });
        return id as Id<"customAdversaries">;
      });
      await env.gm.mutation(api.encounters.addAdversary, { campaignId: env.campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: key() });
      expect((await env.get(sessionId)).encounter).toMatchObject({ adversaries: 2, spent: 4 });
      await env.t.run((ctx) => ctx.db.delete("customAdversaries", customId));
      expect((await env.get(sessionId)).encounter).toMatchObject({ adversaries: 2, spent: 0 });
    });
  });

  describe("authorization: anonymous, outsider, player, GM", () => {
    it("get: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN (K10), GM reads", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const args = { campaignId: env.campaignId, sessionId };
      expect(await failure(env.t.query(api.sessionPrep.get, args))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.query(api.sessionPrep.get, args))).toBe("NOT_FOUND");
      expect(await failure(env.p1.query(api.sessionPrep.get, args))).toBe("FORBIDDEN");
      expect(await env.gm.query(api.sessionPrep.get, args)).toEqual({ scenes: [], hooks: "", encounter: null });
    });

    it("createEncounter: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM creates", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const args = () => ({ campaignId: env.campaignId, sessionId, idempotencyKey: key() });
      expect(await failure(env.t.mutation(api.sessionPrep.createEncounter, args()))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.mutation(api.sessionPrep.createEncounter, args()))).toBe("NOT_FOUND");
      expect(await failure(env.p1.mutation(api.sessionPrep.createEncounter, args()))).toBe("FORBIDDEN");
      expect((await env.gm.mutation(api.sessionPrep.createEncounter, args())).encounterId).toBeTruthy();
    });

    it("addScene: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM adds", async () => {
      const env = await setup();
      const sessionId = await env.create();
      const args = { campaignId: env.campaignId, sessionId };
      expect(await failure(env.t.mutation(api.sessionPrep.addScene, args))).toBe("UNAUTHENTICATED");
      expect(await failure(env.out.mutation(api.sessionPrep.addScene, args))).toBe("NOT_FOUND");
      expect(await failure(env.p1.mutation(api.sessionPrep.addScene, args))).toBe("FORBIDDEN");
      expect((await env.gm.mutation(api.sessionPrep.addScene, args)).sceneId).toBeTruthy();
    });

    const writes = [
      ["setScene", (sceneId: string) => ({ sceneId, text: "Scene" })],
      ["removeScene", (sceneId: string) => ({ sceneId })],
      ["setHooks", () => ({ hooks: "Hooks" })],
      ["linkEncounter", (_: string, encounterId: string) => ({ encounterId })],
      ["unlinkEncounter", () => ({})],
    ] as const;

    for (const [name, extra] of writes) {
      it(`${name}: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM may`, async () => {
        const env = await setup();
        const sessionId = await env.create();
        const sceneId = await env.addScene(sessionId);
        const { encounterId } = await env.gm.mutation(api.encounters.create, { campaignId: env.campaignId, name: "Fight", idempotencyKey: key() });
        const fn = api.sessionPrep[name] as typeof api.sessionPrep.setHooks;
        const args = { campaignId: env.campaignId, sessionId, ...extra(sceneId, encounterId) } as never;
        expect(await failure(env.t.mutation(fn, args))).toBe("UNAUTHENTICATED");
        expect(await failure(env.out.mutation(fn, args))).toBe("NOT_FOUND");
        expect(await failure(env.p1.mutation(fn, args))).toBe("FORBIDDEN");
        expect(await env.gm.mutation(fn, args)).toBeNull();
      });
    }
  });
});
