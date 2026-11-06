import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_LOG_ENTRIES } from "../../convex/lib/validators/sessions";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Journal JD4 (plan .omc/plans/journal.yaml; user answers Q6, Q7): scene titles and states, one encounter per Combat
// scene (the legacy session encounter shows on the first Combat scene), 'Scene N began' log lines while live, the
// current scene's encounter for the Combat Map, and the Combat Map's '+ Session encounter' playing the scene.

const EMAILS = "gm@example.com,p1@example.com";
const BEAR = { kind: "srd" as const, adversaryId: "bear" }; // Bruiser, 4 BP
const BANDIT = { kind: "srd" as const, adversaryId: "jagged-knife-bandit" }; // Standard, 2 BP

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (e) {
    return errorCode(e);
  }
  throw new Error("expected the call to fail");
}

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Plan", idempotencyKey: key() });
  const sessionId = (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() })).sessionId;
  const c = { campaignId, sessionId };
  const addScene = async (type?: "combat" | "social" | "exploration" | "downtime") =>
    (await gm.mutation(api.sessionPrep.addScene, { ...c, ...(type ? { type } : {}) })).sceneId;
  const get = () => gm.query(api.sessionPrep.get, c);
  const setState = (sceneId: string, state: "planned" | "playing" | "done") => gm.mutation(api.sessionPrep.setSceneState, { ...c, sceneId, state });
  const createFor = async (sceneId: string, idempotencyKey = key()) =>
    (await gm.mutation(api.sessionPrep.createSceneEncounter, { ...c, sceneId, idempotencyKey })).encounterId;
  const link = (sceneId: string, encounterId: string) => gm.mutation(api.sessionPrep.linkSceneEncounter, { ...c, sceneId, encounterId });
  const unlink = (sceneId: string) => gm.mutation(api.sessionPrep.unlinkSceneEncounter, { ...c, sceneId });
  const newEncounter = async (name: string) => (await gm.mutation(api.encounters.create, { campaignId, name, idempotencyKey: key() })).encounterId;
  const add = (encounterId: string, source: typeof BEAR | typeof BANDIT, count: number) =>
    gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source, count, summoned: false, idempotencyKey: key() });
  const start = () => gm.mutation(api.sessions.start, { ...c, idempotencyKey: key() });
  const log = () =>
    t.run((ctx) =>
      ctx.db
        .query("sessionLog")
        .withIndex("by_session_at", (q) => q.eq("sessionId", sessionId as Id<"sessions">))
        .take(MAX_LOG_ENTRIES),
    );
  const sceneLines = async () => (await log()).filter((l) => l.event === "scene").map((l) => [l.text, l.auto]);
  return { t, gm, ids, campaignId, sessionId, c, addScene, get, setState, createFor, link, unlink, newEncounter, add, start, log, sceneLines };
}

describe("journal plan: scene title and state (Q7)", () => {
  useAllowlist(EMAILS);

  it("setScene sets a trimmed title (one field per call, at most 120 characters, empty clears)", async () => {
    const f = await setup();
    const a = await f.addScene();
    const set = (extra: object) => f.gm.mutation(api.sessionPrep.setScene, { ...f.c, sceneId: a, ...extra });
    await set({ title: "  The old road north  " });
    expect((await f.get()).scenes[0]).toMatchObject({ id: a, title: "The old road north" });
    expect(await failure(set({ title: "x".repeat(121) }))).toBe("INVALID");
    expect(await failure(set({ title: "x", text: "y" }))).toBe("INVALID");
    await set({ title: "" });
    expect((await f.get()).scenes[0]!.title).toBeUndefined();
  });

  it("'playing' makes the previous playing scene done; 'done' and 'planned' set one scene; a stale id is SESSION_SCENE_NOT_FOUND", async () => {
    const f = await setup();
    const [a, b, cc] = [await f.addScene("social"), await f.addScene(), await f.addScene("exploration")];
    await f.setState(a, "playing");
    await f.setState(b, "playing");
    expect((await f.get()).scenes.map((s) => s.state)).toEqual(["done", "playing", undefined]);
    await f.setState(cc, "done");
    await f.setState(a, "planned");
    expect((await f.get()).scenes.map((s) => s.state)).toEqual([undefined, "playing", "done"]);
    expect(await failure(f.setState("gone", "playing"))).toBe("SESSION_SCENE_NOT_FOUND");
    // A planned session writes no log line.
    expect(await f.sceneLines()).toEqual([]);
  });

  it("while live, 'playing' logs 'Scene N began · <title>' once (auto, event scene); liveWindows ignores it", async () => {
    const f = await setup();
    const a = await f.addScene("social");
    const b = await f.addScene("exploration");
    await f.gm.mutation(api.sessionPrep.setScene, { ...f.c, sceneId: a, title: "The old road north" });
    await f.start();
    await f.setState(a, "playing");
    await f.setState(a, "playing"); // already playing: no second line
    await f.setState(b, "playing");
    expect(await f.sceneLines()).toEqual([
      ["Scene 1 began · The old road north", true],
      ["Scene 2 began", true],
    ]);
  });

  it("a played session's scene cannot start playing (SESSION_SCENE_STATE)", async () => {
    const f = await setup();
    const a = await f.addScene("social");
    await f.gm.mutation(api.sessionRecords.setPlayed, { ...f.c, played: true });
    expect(await failure(f.setState(a, "playing"))).toBe("SESSION_SCENE_STATE");
    await f.setState(a, "done");
    expect((await f.get()).scenes[0]!.state).toBe("done");
  });
});

describe("journal plan: per-scene encounters (Q6)", () => {
  useAllowlist(EMAILS);

  it("createSceneEncounter makes a D8 draft named after the scene and links it; retry-safe; the summary carries chips and BP", async () => {
    const f = await setup();
    await f.addScene("social");
    const a = await f.addScene();
    await f.gm.mutation(api.sessionPrep.setScene, { ...f.c, sceneId: a, title: "Ambush at the Forest Camp" });
    const k = key();
    const encounterId = await f.createFor(a, k);
    expect(await f.createFor(a, k)).toBe(encounterId);
    await f.add(encounterId, BEAR, 1);
    await f.add(encounterId, BANDIT, 2);
    const scene = (await f.get()).scenes[1]!;
    expect(scene.encounterId).toBe(encounterId);
    expect(scene.encounter).toMatchObject({ _id: encounterId, name: "Ambush at the Forest Camp", status: "draft", pcs: 4, budget: 14, spent: 8, onMap: false });
    expect(scene.encounter!.instances.map((i) => [i.type, i.count, i.bp, i.onMap])).toEqual([
      ["Bruiser", 1, 4, false],
      ["Standard", 1, 2, false],
      ["Standard", 1, 2, false],
    ]);
    expect((await f.get()).scenes[0]!.encounter).toBeNull();
    // Unnamed scene: 'Session N · Scene K'.
    const b = await f.addScene();
    const other = await f.createFor(b);
    expect((await f.t.run((ctx) => ctx.db.get("encounters", other as Id<"encounters">)))!.name).toBe("Session 1 · Scene 3");
  });

  it("a non-Combat scene cannot have an encounter (SESSION_SCENE_STATE); a scene showing one refuses another (SESSION_HAS_ENCOUNTER)", async () => {
    const f = await setup();
    const social = await f.addScene("social");
    const fight = await f.addScene();
    const e1 = await f.newEncounter("One");
    const e2 = await f.newEncounter("Two");
    expect(await failure(f.link(social, e1))).toBe("SESSION_SCENE_STATE");
    expect(await failure(f.createFor(social))).toBe("SESSION_SCENE_STATE");
    await f.link(fight, e1);
    expect(await f.link(fight, e1)).toBeNull();
    expect(await failure(f.link(fight, e2))).toBe("SESSION_HAS_ENCOUNTER");
    expect(await failure(f.createFor(fight))).toBe("SESSION_HAS_ENCOUNTER");
    expect(await failure(f.link(fight, "nope"))).toBe("NOT_FOUND");
    await f.unlink(fight);
    expect((await f.get()).scenes[1]!.encounter).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get("encounters", e1 as Id<"encounters">))).not.toBeNull();
    await f.link(fight, e2);
    // Changing the scene to Social drops its link.
    await f.gm.mutation(api.sessionPrep.setScene, { ...f.c, sceneId: fight, type: "social" });
    expect((await f.get()).scenes[1]).toMatchObject({ type: "social", encounter: null });
    expect((await f.get()).scenes[1]!.encounterId).toBeUndefined();
  });

  it("the legacy session encounter shows on the first Combat scene only; unlinking that scene drops it", async () => {
    const f = await setup();
    await f.addScene("social");
    const first = await f.addScene();
    const second = await f.addScene();
    const legacy = (await f.t.mutation(internal.sessionPrep.createEncounter, f.c)).encounterId;
    const scenes = (await f.get()).scenes;
    expect(scenes.map((s) => s.encounter?._id ?? null)).toEqual([null, legacy, null]);
    expect(await failure(f.link(first, await f.newEncounter("Other")))).toBe("SESSION_HAS_ENCOUNTER");
    await f.unlink(first);
    const after = await f.get();
    expect(after.encounter).toBeNull();
    expect(after.scenes.map((s) => s.encounter)).toEqual([null, null, null]);
    expect(second).toBeTruthy();
  });

  it("a dangling scene encounter reads as none; onMap follows tokens on the live map", async () => {
    const f = await setup();
    const a = await f.addScene();
    const encounterId = await f.createFor(a);
    await f.add(encounterId, BEAR, 1);
    const { mapId } = await f.gm.mutation(api.combatMaps.create, { campaignId: f.campaignId, size: "medium", idempotencyKey: key() });
    await f.gm.mutation(api.encounters.start, { campaignId: f.campaignId, encounterId });
    const [instanceId] = (await f.gm.query(api.combatTokensReads.combatants, { campaignId: f.campaignId, mapId })).queue.map((q) => q.instanceId);
    await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId: f.campaignId, mapId, instanceIds: [instanceId!], idempotencyKey: key() });
    // Tokens on a map that is not live do not count.
    await f.t.run((ctx) => ctx.db.patch("combatMaps", mapId as Id<"combatMaps">, { live: false }));
    expect((await f.get()).scenes[0]!.encounter!.onMap).toBe(false);
    await f.t.run((ctx) => ctx.db.patch("combatMaps", mapId as Id<"combatMaps">, { live: true }));
    const enc = (await f.get()).scenes[0]!.encounter!;
    expect([enc.onMap, enc.instances[0]!.onMap]).toEqual([true, true]);
    await f.t.run((ctx) => ctx.db.delete("encounters", encounterId as Id<"encounters">));
    expect((await f.get()).scenes[0]!.encounter).toBeNull();
  });
});

describe("journal plan: the current scene's encounter and the Combat Map (Q6, Q7)", () => {
  useAllowlist(EMAILS);

  async function twoFights() {
    const f = await setup();
    const talk = await f.addScene("social");
    const one = await f.addScene();
    const two = await f.addScene();
    const e1 = await f.createFor(one);
    const e2 = await f.createFor(two);
    await f.add(e1, BANDIT, 1);
    await f.add(e2, BEAR, 1);
    const { mapId } = await f.gm.mutation(api.combatMaps.create, { campaignId: f.campaignId, size: "medium", idempotencyKey: key() });
    const current = async () => (await f.gm.query(api.sessionPrep.current, { campaignId: f.campaignId }))?.encounterId ?? null;
    const place = () => f.gm.mutation(api.combatTokens.placeSessionEncounter, { campaignId: f.campaignId, mapId, idempotencyKey: key() });
    return { ...f, talk, one, two, e1, e2, mapId, current, place };
  }

  it("current follows the playing Combat scene, else the next Combat scene that is not done", async () => {
    const f = await twoFights();
    expect(await f.current()).toBe(f.e1);
    await f.setState(f.two, "playing");
    expect(await f.current()).toBe(f.e2);
    await f.setState(f.two, "done");
    expect(await f.current()).toBe(f.e1);
    await f.setState(f.one, "done");
    expect(await f.current()).toBeNull();
    // A playing non-Combat scene: the next Combat scene after it.
    await f.setState(f.one, "planned");
    await f.setState(f.talk, "playing");
    expect(await f.current()).toBe(f.e1);
    const read = await f.gm.query(api.combatTokensReads.sessionEncounter, { campaignId: f.campaignId, mapId: f.mapId });
    expect(read.session).toMatchObject({ encounterId: f.e1, encounterName: "Session 1 · Scene 2", adversaries: 1 });
  });

  it("'+ Session encounter' on a live session starts the scene's encounter, marks the scene Playing now (previous Done) and logs it once", async () => {
    const f = await twoFights();
    await f.gm.mutation(api.sessionPrep.setScene, { ...f.c, sceneId: f.two, title: "Ambush at the Forest Camp" });
    await f.start();
    await f.setState(f.talk, "playing");
    await f.setState(f.one, "done");
    const placed = await f.place();
    expect(placed).toMatchObject({ n: 1, added: 1, started: true });
    expect((await f.get()).scenes.map((s) => s.state)).toEqual(["done", "done", "playing"]);
    await f.place(); // already playing: no second line
    expect(await f.sceneLines()).toEqual([
      ["Scene 1 began", true],
      ["Scene 3 began · Ambush at the Forest Camp", true],
    ]);
  });

  it("'+ Session encounter' on a planned session leaves the scenes alone", async () => {
    const f = await twoFights();
    await f.place();
    expect((await f.get()).scenes.map((s) => s.state)).toEqual([undefined, undefined, undefined]);
    expect(await f.sceneLines()).toEqual([]);
  });

  it("a legacy session encounter without Combat scenes is still the current one, and placing it plays no scene", async () => {
    const f = await setup();
    await f.addScene("social");
    const legacy = (await f.t.mutation(internal.sessionPrep.createEncounter, f.c)).encounterId;
    await f.add(legacy, BANDIT, 1);
    expect((await f.gm.query(api.sessionPrep.current, { campaignId: f.campaignId }))?.encounterId).toBe(legacy);
    await f.start();
    const { mapId } = await f.gm.mutation(api.combatMaps.create, { campaignId: f.campaignId, size: "medium", idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.placeSessionEncounter, { campaignId: f.campaignId, mapId, idempotencyKey: key() });
    expect((await f.get()).scenes[0]!.state).toBeUndefined();
    expect(await f.sceneLines()).toEqual([]);
  });
});
