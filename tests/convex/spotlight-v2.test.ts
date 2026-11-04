/**
 * Combat HUD v2, H9.S (plan .omc/plans/combat-hud.yaml; user answers 2026-11-04 Q7 a, Q8 a): the GM hands the spotlight
 * to the whole party (`combatSpotlight.handToParty`), and takes it for an adversary free or for 1 Fear (`gmTake`'s
 * `pay`). CB p.155: "you can spend a Fear to interrupt the action and spotlight an adversary". The paid take counts as
 * that adversary's spotlight this GM turn, so its first action asks no more Fear; it is undoable and gives the Fear back.
 * Access: tests/convex/authz/spotlight.entries.ts. Every refusal is asserted on ConvexError.data.code.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { campaignFearState } from "../../convex/lib/fear";
import { allowWorldEmails, buildWorld, type Role } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

/** The authz world plus a running encounter (GM turn 1) with two Bears, each with a token on a map, and 3 Fear. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const bear = async (label: string, x: number) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: x,
        summoned: false,
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y: 10, face: Math.PI });
      return { instanceId, tokenId };
    };
    const pcToken = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    return { encounterId, pcToken, first: await bear("First Bear", 6), second: await bear("Second Bear", 7) };
  });
  const setFear = (n: number) =>
    t.run(async (ctx) => {
      const s = await campaignFearState(ctx, campaignId);
      await ctx.db.patch("campaignState", s._id, { fear: n });
    });
  await setFear(3);
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const take = (args: { tokenId?: string; pay?: "free" | "fear" } = {}, as: Role = "gm") =>
    w.as(as).mutation(api.combatSpotlight.gmTake, { campaignId, idempotencyKey: key(), ...args });
  const party = (as: Role = "gm") => w.as(as).mutation(api.combatSpotlight.handToParty, { campaignId, idempotencyKey: key() });
  const state = (as: Role = "gm") => w.as(as).query(api.combatSpotlight.state, { campaignId });
  const spotlightRows = () => t.run((ctx) => ctx.db.query("combatSpotlight").collect());
  const log = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const fearHistory = () => t.run(async (ctx) => (await ctx.db.query("history").collect()).filter((h) => h.kind === "fear"));
  const attack = (instanceId: Id<"encounterAdversaries">) =>
    gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [w.characterA], idempotencyKey: key() });
  return { w, t, campaignId, gm, ...ids, setFear, fear, instance, take, party, state, spotlightRows, log, fearHistory, attack };
}

describe("combatSpotlight.handToParty (Q8 a)", () => {
  it("hands it to the whole party: holder null for everyone, nobody reactions-only; idempotent; never costs Fear", async () => {
    const a = await arena();
    await a.take({ tokenId: a.first.tokenId });
    expect(await a.state("player")).toMatchObject({ holder: { kind: "gm" }, reactionsOnly: true });

    expect(await a.party()).toEqual({ moved: true });
    for (const role of ["gm", "player", "otherPlayer"] as const) {
      expect(await a.state(role)).toMatchObject({ holder: null, since: null, reason: null, reactionsOnly: false, adversaryTokenId: null, adversaryName: null });
    }
    expect(await a.spotlightRows()).toEqual([]);
    expect(await a.party()).toEqual({ moved: false });
    expect(await a.fear()).toBe(3);
  });

  it("from a PC holder too", async () => {
    const a = await arena();
    await a.w.as("gm").mutation(api.combatSpotlight.handTo, { campaignId: a.campaignId, characterId: a.w.characterA, idempotencyKey: key() });
    expect(await a.party()).toEqual({ moved: true });
    expect((await a.state("player")).holder).toBeNull();
  });

  it("players can't call it (FORBIDDEN) and nothing moves", async () => {
    const a = await arena();
    await a.take();
    for (const role of ["player", "otherPlayer", "grantee"] as const) expect(await code(a.party(role))).toBe("FORBIDDEN");
    expect((await a.state()).holder).toEqual({ kind: "gm" });
  });
});

describe("combatSpotlight.gmTake pay (Q7 a)", () => {
  it("Free (and no pay, as before) costs nothing and counts no spotlight", async () => {
    const a = await arena();
    expect(await a.take({ tokenId: a.first.tokenId, pay: "free" })).toEqual({ moved: true });
    expect(await a.take({ tokenId: a.second.tokenId })).toEqual({ moved: true });
    expect(await a.fear()).toBe(3);
    expect((await a.instance(a.first.instanceId)).spotlights).toBe(0);
    expect(await a.log()).toEqual([]);
  });

  it("1 Fear spends it, lights the adversary and counts as its spotlight this GM turn", async () => {
    const a = await arena();
    expect(await a.take({ tokenId: a.second.tokenId, pay: "fear" })).toEqual({ moved: true });
    expect(await a.fear()).toBe(2);
    expect(await a.state()).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", adversaryTokenId: a.second.tokenId, adversaryName: "Second Bear" });
    expect(await a.instance(a.second.instanceId)).toMatchObject({ spotlights: 1, spotlightTurn: 1 });
    // A Fear change in history, as every Fear spend.
    expect((await a.fearHistory()).map((h) => [h.action, h.before, h.after])).toEqual([["spend", 3, 2]]);
  });

  it("no double charge: the paid adversary's first action asks no more Fear, even as the turn's second spotlight", async () => {
    const a = await arena();
    // The turn's first spotlight goes to the First Bear (free); a second adversary would cost 1 Fear (CB p.153).
    await a.gm.mutation(api.encounterTracking.spotlight, { campaignId: a.campaignId, instanceId: a.first.instanceId, idempotencyKey: key() });
    await a.take({ tokenId: a.second.tokenId, pay: "fear" });
    expect(await a.fear()).toBe(2);
    const r = await a.attack(a.second.instanceId);
    expect(r.status).not.toBe("confirmFear");
    expect((await a.instance(a.second.instanceId)).spotlights).toBe(1);

    // Contrast: a free take leaves the second adversary's action to pay its spotlight.
    const b = await arena();
    await b.gm.mutation(api.encounterTracking.spotlight, { campaignId: b.campaignId, instanceId: b.first.instanceId, idempotencyKey: key() });
    await b.take({ tokenId: b.second.tokenId, pay: "free" });
    expect(await b.attack(b.second.instanceId)).toMatchObject({ status: "confirmFear", spotlight: 1 });
  });

  it("an adversary already spotlit this turn is not counted twice", async () => {
    const a = await arena();
    await a.gm.mutation(api.encounterTracking.spotlight, { campaignId: a.campaignId, instanceId: a.first.instanceId, idempotencyKey: key() });
    await a.take({ tokenId: a.first.tokenId, pay: "fear" });
    expect(await a.instance(a.first.instanceId)).toMatchObject({ spotlights: 1, spotlightTurn: 1 });
    expect(await a.fear()).toBe(2);
  });

  it("without a token: the GM interrupts generally for 1 Fear", async () => {
    const a = await arena();
    expect(await a.take({ pay: "fear" })).toEqual({ moved: true });
    expect(await a.state()).toMatchObject({ holder: { kind: "gm" }, reason: "gmTook", adversaryTokenId: null });
    expect(await a.fear()).toBe(2);
  });

  it("taking what the GM already holds spends nothing", async () => {
    const a = await arena();
    await a.take({ tokenId: a.second.tokenId, pay: "fear" });
    expect(await a.take({ tokenId: a.second.tokenId, pay: "fear" })).toEqual({ moved: false });
    expect(await a.fear()).toBe(2);
  });

  it("not enough Fear: NOT_ENOUGH_FEAR and nothing changes", async () => {
    const a = await arena();
    await a.setFear(0);
    expect(await code(a.take({ tokenId: a.second.tokenId, pay: "fear" }))).toBe("NOT_ENOUGH_FEAR");
    expect(await a.spotlightRows()).toEqual([]);
    expect((await a.instance(a.second.instanceId)).spotlights).toBe(0);
    expect(await a.log()).toEqual([]);
    // Free still works with no Fear.
    expect(await a.take({ tokenId: a.second.tokenId, pay: "free" })).toEqual({ moved: true });
  });

  it("refuses a PC's token (INVALID) and an unknown one (COMBAT_TOKEN_NOT_FOUND) before spending", async () => {
    const a = await arena();
    expect(await code(a.take({ tokenId: a.pcToken, pay: "fear" }))).toBe("INVALID");
    expect(await code(a.take({ tokenId: "nope", pay: "fear" }))).toBe("COMBAT_TOKEN_NOT_FOUND");
    expect(await a.fear()).toBe(3);
  });

  it("is logged as one group; the GM's undo gives the Fear back; players see no adversary name and can't undo it", async () => {
    const a = await arena();
    await a.take({ tokenId: a.second.tokenId, pay: "fear" });
    const rows = await a.log();
    expect(rows).toHaveLength(2);
    const gmRow = rows.find((r) => r.visibility === "gm")!;
    const publicRow = rows.find((r) => r.visibility === "public")!;
    expect(gmRow).toMatchObject({ fearDelta: -1, undoable: true, groupId: publicRow.groupId });
    expect(gmRow.summary).toContain("Second Bear");
    expect(publicRow.summary).not.toContain("Bear");

    expect(await code(a.w.as("player").mutation(api.actionLog.undo, { entryId: publicRow._id, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await a.fear()).toBe(2);

    expect(await a.gm.mutation(api.actionLog.undo, { entryId: gmRow._id, idempotencyKey: key() })).toMatchObject({ fearReverted: -1 });
    expect(await a.fear()).toBe(3);
    expect((await a.log()).every((r) => r.undoneAt !== undefined)).toBe(true);
  });

  it("players can't take it, free or paid (FORBIDDEN)", async () => {
    const a = await arena();
    for (const role of ["player", "otherPlayer", "grantee"] as const) {
      expect(await code(a.take({ tokenId: a.second.tokenId, pay: "fear" }, role))).toBe("FORBIDDEN");
      expect(await code(a.take({ pay: "free" }, role))).toBe("FORBIDDEN");
    }
    expect(await a.fear()).toBe(3);
    expect(await a.spotlightRows()).toEqual([]);
  });
});

describe("a defeated adversary can't take the spotlight (user 2026-11-04)", () => {
  const defeat = (a: Awaited<ReturnType<typeof arena>>, id: Id<"encounterAdversaries">, patch: { hp?: number; defeated?: boolean; minionCount?: number }) =>
    a.t.run(async (ctx) => {
      await ctx.db.patch("encounterAdversaries", id, patch);
    });

  it("every HP marked: gmTake refuses it free and for 1 Fear (ADVERSARY_DEFEATED); nothing moves, no Fear spent", async () => {
    const a = await arena();
    await defeat(a, a.second.instanceId, { hp: 7 });
    expect(await code(a.take({ tokenId: a.second.tokenId }))).toBe("ADVERSARY_DEFEATED");
    expect(await code(a.take({ tokenId: a.second.tokenId, pay: "free" }))).toBe("ADVERSARY_DEFEATED");
    expect(await code(a.take({ tokenId: a.second.tokenId, pay: "fear" }))).toBe("ADVERSARY_DEFEATED");
    expect(await a.spotlightRows()).toEqual([]);
    expect(await a.fear()).toBe(3);
    expect(await a.log()).toEqual([]);
    expect((await a.instance(a.second.instanceId)).spotlights).toBe(0);
    // The living one still takes it.
    expect(await a.take({ tokenId: a.first.tokenId })).toEqual({ moved: true });
  });

  it("marked defeated (a Minion group with every Minion gone): refused, also while the GM already holds it", async () => {
    const a = await arena();
    await a.take({ tokenId: a.first.tokenId });
    await defeat(a, a.second.instanceId, { defeated: true, minionCount: 3, hp: 3 });
    expect(await code(a.take({ tokenId: a.second.tokenId }))).toBe("ADVERSARY_DEFEATED");
    expect(await code(a.take({ tokenId: a.second.tokenId, pay: "fear" }))).toBe("ADVERSARY_DEFEATED");
    expect((await a.state()).adversaryTokenId).toBe(a.first.tokenId);
    expect(await a.fear()).toBe(3);
  });

  it("the tracker's spotlight count refuses it too (encounterTracking.spotlight)", async () => {
    const a = await arena();
    await defeat(a, a.first.instanceId, { hp: 7, defeated: true });
    const spot = a.gm.mutation(api.encounterTracking.spotlight, { campaignId: a.campaignId, instanceId: a.first.instanceId, idempotencyKey: key() });
    expect(await code(spot)).toBe("ADVERSARY_DEFEATED");
    expect((await a.instance(a.first.instanceId)).spotlights).toBe(0);
    expect(await a.fear()).toBe(3);
  });
});
