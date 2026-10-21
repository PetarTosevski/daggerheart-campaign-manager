/**
 * Who may call the weapon-attack functions (plan combat-actions CA3; rule 14, TE1): anonymous, outsider, player on
 * their own character, player on another player's character, and GM, for combatActions.attack, targets and
 * pickMinions, plus combatRequests.sanction and mine. Each row runs on a fresh world (a resolved mutation commits).
 * Asserts `ConvexError.data.code` only.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { allowWorldEmails, buildWorld, type Role, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/** A live map with characterA's token at (5, 10) looking east, a running encounter and two enemies: a Minion pack adjacent (Difficulty 1) and an archer out of melee range. */
async function scene(w: World) {
  const { t, campaignId } = w;
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  return t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const customId = await ctx.db.insert("customAdversaries", {
      campaignId,
      name: "Rat",
      tier: 1,
      type: "Minion",
      description: "",
      motives: "",
      difficulty: 1,
      thresholds: { major: null, severe: null },
      hp: 1,
      stress: 1,
      attack: { modifier: 0, name: "Bite", range: "Melee", damage: "1 phy" },
      experiences: [],
      features: [{ name: "Minion (1)", kind: "passive", text: "" }],
      createdAt: now,
      updatedAt: now,
    });
    const instance = (label: string, order: number, stats: { difficulty: number; major: number | null; severe: number | null; hpMax: number }, source: { kind: "custom"; customId: Id<"customAdversaries"> } | { kind: "srd"; adversaryId: string }) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source,
        label,
        order,
        summoned: false,
        stats: { ...stats, stressMax: 1 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
        ...(source.kind === "custom" ? { minionCount: stats.hpMax } : {}),
      });
    const pack = await instance("Rats", 0, { difficulty: 1, major: null, severe: null, hpMax: 6 }, { kind: "custom", customId });
    const archer = await instance("Archer", 1, { difficulty: 1, major: 100, severe: 200, hpMax: 5 }, { kind: "srd", adversaryId: "bear" });
    const packToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: pack }, side: "enemy", x: 6, y: 10, face: Math.PI });
    const archerToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: archer }, side: "enemy", x: 8, y: 10, face: Math.PI });
    return { mapId, pack, packToken, archerToken };
  });
}

type Scene = Awaited<ReturnType<typeof scene>>;

const ROW_ROLES = ["anon", "outsider", "otherPlayer", "player", "gm"] as const satisfies readonly Role[];

function attackArgs(w: World, s: Scene, targets: Id<"combatTokens">[]) {
  return { campaignId: w.campaignId, characterId: w.characterA, mapId: s.mapId, targetTokenIds: targets, slot: "primary" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() };
}

/** Runs `call` as each role on its own fresh world and returns the outcomes by role. */
async function rows(call: (w: World, s: Scene, role: Role) => Promise<unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const role of ROW_ROLES) {
    const w = await buildWorld();
    const s = await scene(w);
    out[role] = await code(call(w, s, role));
  }
  return out;
}

describe("combat attack: access by role", () => {
  allowWorldEmails();

  it("attack: the character's player and the GM; another player FORBIDDEN, outsider NOT_FOUND, anonymous UNAUTHENTICATED", async () => {
    expect(await rows((w, s, role) => w.as(role).mutation(api.combatActions.attack, attackArgs(w, s, [s.packToken])))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "FORBIDDEN",
      player: "ok",
      gm: "ok",
    });
  });

  it("targets: the character's player and the GM", async () => {
    expect(await rows((w, s, role) => w.as(role).query(api.combatActions.targets, { campaignId: w.campaignId, characterId: w.characterA, mapId: s.mapId }))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "FORBIDDEN",
      player: "ok",
      gm: "ok",
    });
  });

  it("pickMinions: the attacking character's player and the GM", async () => {
    expect(
      await rows(async (w, s, role) => {
        const r = await w.as("player").mutation(api.combatActions.attack, attackArgs(w, s, [s.packToken]));
        if (r.status !== "resolved") throw new Error("expected a resolved attack");
        return w.as(role).mutation(api.combatActions.pickMinions, { campaignId: w.campaignId, entryId: r.entryId, instanceIds: [s.pack], idempotencyKey: key() });
      }),
    ).toEqual({ anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "ok", gm: "ok" });
  });

  it("combatRequests.sanction: the GM only", async () => {
    expect(
      await rows(async (w, s, role) => {
        const r = await w.as("player").mutation(api.combatActions.attack, attackArgs(w, s, [s.archerToken]));
        if (r.status !== "pending") throw new Error("expected a pending attack");
        return w.as(role).mutation(api.combatRequests.sanction, { campaignId: w.campaignId, requestId: r.requestId, approve: false, idempotencyKey: key() });
      }),
    ).toEqual({ anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "FORBIDDEN", gm: "ok" });
  });

  it("combatRequests.mine: every member (each sees only their own, the GM all)", async () => {
    expect(await rows((w, _s, role) => w.as(role).query(api.combatRequests.mine, { campaignId: w.campaignId }))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "ok",
      player: "ok",
      gm: "ok",
    });
  });

  it("refusals past the access check keep their own codes: another campaign's request is NOT_FOUND", async () => {
    const w = await buildWorld();
    const s = await scene(w);
    const r = await w.as("player").mutation(api.combatActions.attack, attackArgs(w, s, [s.archerToken]));
    if (r.status !== "pending") throw new Error("expected a pending attack");
    const { campaignId: other } = await w.as("otherPlayer").mutation(api.campaigns.create, { frameId: "witherwild", name: "Elsewhere", idempotencyKey: key() });
    expect(await code(w.as("otherPlayer").mutation(api.combatRequests.sanction, { campaignId: other, requestId: r.requestId, approve: true, idempotencyKey: key() }))).toBe("NOT_FOUND");
    // A character of this campaign named under another campaign: NOT_FOUND.
    expect(await code(w.as("otherPlayer").mutation(api.combatActions.attack, { ...attackArgs(w, s, [s.packToken]), campaignId: other, characterId: w.characterB }))).toBe("NOT_FOUND");
  });
});
