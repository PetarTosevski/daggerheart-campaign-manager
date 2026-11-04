/**
 * Revive a defeated adversary (bead dcm-6c2o, user 2026-11-04: "Give the GM the option to revive a dead adversary"):
 * `encounterTracking.reviveInstance` sets the marked HP and Stress and clears the defeat in one keyed GM step, the
 * spotlight takes the adversary again, and one GM undo (`actionLog.undo`) puts it back to defeated with its previous
 * marks. Players see a public feed line, named only once the party saw the adversary (dcm-bn14). Access:
 * tests/convex/authz/adversaries.entries.ts. Every refusal is asserted on ConvexError.data.code.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { allowWorldEmails, buildWorld, type Role } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

type Seed = { hp: number; stress: number; defeated: boolean; hpMax: number; stressMax: number; minionCount?: number };

/** The authz world plus a running encounter with a defeated Bear (7 / 7 HP, 2 / 2 Stress), a wiped-out Minion group and a living Wolf, each with a token. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const add = async (label: string, x: number, seed: Seed) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: seed.minionCount ? "jagged-knife-lackey" : "bear" },
        label,
        order: x,
        summoned: false,
        ...(seed.minionCount ? { minionCount: seed.minionCount } : {}),
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: seed.hpMax, stressMax: seed.stressMax },
        hp: seed.hp,
        stress: seed.stress,
        defeated: seed.defeated,
        conditions: ["vulnerable"],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y: 10, face: Math.PI });
      return { instanceId, tokenId };
    };
    return {
      encounterId,
      bear: await add("Bear", 6, { hp: 7, stress: 2, defeated: true, hpMax: 7, stressMax: 2 }),
      lackeys: await add("Lackeys", 7, { hp: 4, stress: 0, defeated: true, hpMax: 4, stressMax: 1, minionCount: 4 }),
      wolf: await add("Wolf", 8, { hp: 1, stress: 0, defeated: false, hpMax: 4, stressMax: 1 }),
    };
  });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const revive = (instanceId: string, hp = 0, stress = 0, as: Role = "gm") =>
    w.as(as).mutation(api.encounterTracking.reviveInstance, { campaignId, instanceId, hp, stress, idempotencyKey: key() });
  const log = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const gmRows = async () => (await log()).filter((r) => r.visibility === "gm");
  const publicRows = async () => (await log()).filter((r) => r.visibility === "public");
  const setLive = (live: boolean) => t.run((ctx) => ctx.db.patch("combatMaps", mapId, { live }));
  const markSeen = (tokenId: Id<"combatTokens">) => t.run((ctx) => ctx.db.insert("combatSeen", { campaignId, tokenId, seenAt: Date.now() }));
  const playerFeed = async () =>
    (await w.as("player").query(api.feed.list, { campaignId, paginationOpts: { numItems: 20, cursor: null } })).page.map((r) => r.summary);
  const tokens = () => gm.query(api.combatTokensReads.list, { campaignId, mapId });
  const take = (tokenId: string) => gm.mutation(api.combatSpotlight.gmTake, { campaignId, tokenId, idempotencyKey: key() });
  return { w, t, campaignId, gm, ...ids, instance, revive, log, gmRows, publicRows, setLive, markSeen, playerFeed, tokens, take };
}

describe("encounterTracking.reviveInstance (dcm-6c2o)", () => {
  it("at full health: 0 HP and 0 Stress marked, no longer defeated, its token no longer down; conditions stay", async () => {
    const a = await arena();
    expect(await a.revive(a.bear.instanceId)).toEqual({ hp: 0, stress: 0, defeated: false });
    expect(await a.instance(a.bear.instanceId)).toMatchObject({ hp: 0, stress: 0, defeated: false, conditions: ["vulnerable"] });
    const token = (await a.tokens()).find((t) => t._id === a.bear.tokenId)!;
    expect(token.stats).toMatchObject({ hp: 0, stress: 0, down: false });
  });

  it("sets the marks the GM chose", async () => {
    const a = await arena();
    await a.revive(a.bear.instanceId, 3, 1);
    expect(await a.instance(a.bear.instanceId)).toMatchObject({ hp: 3, stress: 1, defeated: false });
  });

  it("makes the spotlight takeable again (ADVERSARY_DEFEATED before, taken after)", async () => {
    const a = await arena();
    expect(await code(a.take(a.bear.tokenId))).toBe("ADVERSARY_DEFEATED");
    await a.revive(a.bear.instanceId);
    expect(await a.take(a.bear.tokenId)).toEqual({ moved: true });
    expect((await a.gm.query(api.combatSpotlight.state, { campaignId: a.campaignId })).adversaryTokenId).toBe(a.bear.tokenId);
  });

  it("a Minion group comes back: its fallen Minions cleared (or as many as the GM leaves), the group size unchanged", async () => {
    const a = await arena();
    await a.revive(a.lackeys.instanceId);
    expect(await a.instance(a.lackeys.instanceId)).toMatchObject({ hp: 0, defeated: false, minionCount: 4 });
    const b = await arena();
    await b.revive(b.lackeys.instanceId, 1);
    expect(await b.instance(b.lackeys.instanceId)).toMatchObject({ hp: 1, defeated: false, minionCount: 4 });
    expect((await b.gmRows())[0]!.summary).toContain("3 of 4 Minions standing");
  });

  it("one GM undo puts it back to defeated with its previous marks", async () => {
    const a = await arena();
    await a.revive(a.bear.instanceId, 2, 1);
    const rows = await a.gmRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "adversary", visibility: "gm", undoable: true });
    expect(rows[0]!.summary).toBe("Bear revived: 2 of 7 HP marked, 1 of 2 Stress marked");
    await a.gm.mutation(api.actionLog.undo, { entryId: rows[0]!._id, idempotencyKey: key() });
    expect(await a.instance(a.bear.instanceId)).toMatchObject({ hp: 7, stress: 2, defeated: true });
    // dcm-bn14: the players' line is in the same group, so the undo takes it back too.
    expect((await a.publicRows()).every((r) => r.undoneAt !== undefined)).toBe(true);
    expect((await a.tokens()).find((t) => t._id === a.bear.tokenId)!.stats).toMatchObject({ down: true });
    expect(await code(a.take(a.bear.tokenId))).toBe("ADVERSARY_DEFEATED");
  });

  it("players see a public line naming it as its token does (no live map: named) (dcm-bn14)", async () => {
    const a = await arena();
    await a.setLive(false);
    await a.revive(a.bear.instanceId, 2, 1);
    const pub = await a.publicRows();
    expect(pub).toHaveLength(1);
    expect(pub[0]).toMatchObject({ kind: "adversary", summary: "The Bear is back on its feet", groupId: (await a.gmRows())[0]!.groupId });
    expect(await a.playerFeed()).toEqual(["The Bear is back on its feet"]);
  });

  it("on the live map, a token the party has not seen this scene gets no public line; a seen group is named in the plural (dcm-bn14)", async () => {
    const a = await arena();
    await a.setLive(true);
    await a.revive(a.bear.instanceId);
    expect(await a.publicRows()).toHaveLength(0);
    expect(await a.playerFeed()).toEqual([]);
    await a.markSeen(a.lackeys.tokenId);
    await a.revive(a.lackeys.instanceId);
    expect(await a.playerFeed()).toEqual(["The Lackeys are back on their feet"]);
  });

  it("refuses marks that leave it defeated or out of range (ENCOUNTER_RULE) and writes nothing", async () => {
    const a = await arena();
    expect(await code(a.revive(a.bear.instanceId, 7, 0))).toBe("ENCOUNTER_RULE");
    expect(await code(a.revive(a.bear.instanceId, -1, 0))).toBe("ENCOUNTER_RULE");
    expect(await code(a.revive(a.bear.instanceId, 0, 3))).toBe("ENCOUNTER_RULE");
    expect(await code(a.revive(a.bear.instanceId, 0.5, 0))).toBe("ENCOUNTER_RULE");
    expect(await a.instance(a.bear.instanceId)).toMatchObject({ hp: 7, stress: 2, defeated: true });
    expect(await a.log()).toEqual([]);
  });

  it("refuses an adversary that is not defeated (ENCOUNTER_RULE)", async () => {
    const a = await arena();
    expect(await code(a.revive(a.wolf.instanceId))).toBe("ENCOUNTER_RULE");
    expect(await a.instance(a.wolf.instanceId)).toMatchObject({ hp: 1 });
  });

  it("refuses while the encounter is not running (ENCOUNTER_NOT_RUNNING)", async () => {
    const a = await arena();
    await a.t.run((ctx) => ctx.db.patch("encounters", a.encounterId, { status: "ended" }));
    expect(await code(a.revive(a.bear.instanceId))).toBe("ENCOUNTER_NOT_RUNNING");
  });

  it("players get FORBIDDEN and nothing changes", async () => {
    const a = await arena();
    for (const role of ["player", "otherPlayer", "grantee"] as const) {
      expect(await code(a.revive(a.bear.instanceId, 0, 0, role))).toBe("FORBIDDEN");
    }
    expect(await a.instance(a.bear.instanceId)).toMatchObject({ hp: 7, stress: 2, defeated: true });
    expect(await a.log()).toEqual([]);
  });
});
