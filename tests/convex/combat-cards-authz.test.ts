/**
 * Who may call the domain-card functions (plan combat-actions CA4; rule 14, TE1): anonymous, outsider, player on their
 * own character, player on another player's character, and GM, for combatCards.useCard, hand, sanction and pending; and
 * (F7-H4) hand with the GM's switch off or the hand hidden, handSharing, setHandHidden and campaigns.setPlayersSeeHands.
 * Each row runs on a fresh world. Asserts `ConvexError.data.code` only.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
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

/** A live map, characterA's token at (5, 10) looking east holding Cinder Grasp, a running encounter, an adjacent Bandit and an Archer out of melee. */
async function scene(w: World) {
  const { t, campaignId } = w;
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  return t.run(async (ctx) => {
    const sheet = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...sheet, domainCards: { owned: ["cinder-grasp"], loadout: ["cinder-grasp"] } });
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const instance = (label: string, order: number) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 5, stressMax: 1 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
    const bandit = await instance("Bandit", 0);
    const archer = await instance("Archer", 1);
    const banditToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: bandit }, side: "enemy", x: 6, y: 10, face: Math.PI });
    const archerToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: archer }, side: "enemy", x: 9, y: 10, face: Math.PI });
    return { mapId, banditToken, archerToken };
  });
}

type Scene = Awaited<ReturnType<typeof scene>>;

const ROW_ROLES = ["anon", "outsider", "otherPlayer", "player", "gm"] as const satisfies readonly Role[];

function useArgs(w: World, s: Scene, target: Id<"combatTokens">) {
  return { campaignId: w.campaignId, characterId: w.characterA, mapId: s.mapId, cardId: "cinder-grasp", targetTokenIds: [target], choices: [], idempotencyKey: key() };
}

async function rows(call: (w: World, s: Scene, role: Role) => Promise<unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const role of ROW_ROLES) {
    const w = await buildWorld();
    const s = await scene(w);
    out[role] = await code(call(w, s, role));
  }
  return out;
}

describe("combat cards: access by role", () => {
  allowWorldEmails();

  it("useCard: the character's player and the GM (playing for the character); another player FORBIDDEN", async () => {
    expect(await rows((w, s, role) => w.as(role).mutation(api.combatCards.useCard, useArgs(w, s, s.banditToken)))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "FORBIDDEN",
      player: "ok",
      gm: "ok",
    });
  });

  it("hand: every member while hands are shared (F7-H4: the GM's switch on by default, nothing hidden)", async () => {
    expect(await rows((w, _s, role) => w.as(role).query(api.combatCards.hand, { campaignId: w.campaignId, characterId: w.characterA }))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "ok",
      player: "ok",
      gm: "ok",
    });
  });

  it("hand with the GM's switch off: the character's player and the GM; another player FORBIDDEN", async () => {
    const off = async (w: World) => w.as("gm").mutation(api.campaigns.setPlayersSeeHands, { campaignId: w.campaignId, enabled: false });
    expect(await rows(async (w, _s, role) => (await off(w), w.as(role).query(api.combatCards.hand, { campaignId: w.campaignId, characterId: w.characterA })))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "FORBIDDEN",
      player: "ok",
      gm: "ok",
    });
  });

  it("hand hidden by its player: the character's player and the GM; another player FORBIDDEN", async () => {
    const hide = async (w: World) => w.as("player").mutation(api.combatCards.setHandHidden, { campaignId: w.campaignId, characterId: w.characterA, hidden: true });
    expect(await rows(async (w, _s, role) => (await hide(w), w.as(role).query(api.combatCards.hand, { campaignId: w.campaignId, characterId: w.characterA })))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "FORBIDDEN",
      player: "ok",
      gm: "ok",
    });
  });

  it("handSharing: every member", async () => {
    expect(await rows((w, _s, role) => w.as(role).query(api.combatCards.handSharing, { campaignId: w.campaignId }))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "ok",
      player: "ok",
      gm: "ok",
    });
  });

  it("setHandHidden: the character's player and the GM; another player FORBIDDEN", async () => {
    expect(await rows((w, _s, role) => w.as(role).mutation(api.combatCards.setHandHidden, { campaignId: w.campaignId, characterId: w.characterA, hidden: true }))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "FORBIDDEN",
      player: "ok",
      gm: "ok",
    });
  });

  it("campaigns.setPlayersSeeHands: the GM only", async () => {
    expect(await rows((w, _s, role) => w.as(role).mutation(api.campaigns.setPlayersSeeHands, { campaignId: w.campaignId, enabled: false }))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "FORBIDDEN",
      player: "FORBIDDEN",
      gm: "ok",
    });
  });

  it("sanction: the GM only", async () => {
    expect(
      await rows(async (w, s, role) => {
        const r = await w.as("player").mutation(api.combatCards.useCard, useArgs(w, s, s.archerToken));
        if (r.status !== "pending") throw new Error("expected a pending card use");
        return w.as(role).mutation(api.combatCards.sanction, { campaignId: w.campaignId, requestId: r.requestId, approve: false, idempotencyKey: key() });
      }),
    ).toEqual({ anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "FORBIDDEN", gm: "ok" });
  });

  it("pending: every member (each their own, the GM all)", async () => {
    expect(await rows((w, _s, role) => w.as(role).query(api.combatCards.pending, { campaignId: w.campaignId }))).toEqual({
      anon: "UNAUTHENTICATED",
      outsider: "NOT_FOUND",
      otherPlayer: "ok",
      player: "ok",
      gm: "ok",
    });
  });

  it("kept dice (CA4b) belong to the character: another player is FORBIDDEN and leaves them; the GM playing for the character answers with them", async () => {
    const w = await buildWorld();
    const s = await scene(w);
    await w.t.run(async (ctx) => {
      const sheet = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...sheet, stress: 0, domainCards: { owned: ["dark-whispers"], loadout: ["dark-whispers"] } });
    });
    const touched = { id: "situations", value: ["You've made physical contact with them"] };
    const base = useArgs(w, s, s.banditToken);
    const darkWhispers = (choices: { id: string; value: string[] }[]) => ({ ...base, idempotencyKey: key(), cardId: "dark-whispers", choices });
    const kept = () => w.t.run(async (ctx) => (await ctx.db.query("operations").collect()).filter((o) => o.kind === "card_dice").map((o) => o.result as { values: number[] }));

    expect((await w.as("player").mutation(api.combatCards.useCard, darkWhispers([touched]))).status).toBe("needsChoice");
    const [before] = await kept();
    expect(await code(w.as("otherPlayer").mutation(api.combatCards.useCard, darkWhispers([touched, { id: "opt:question", value: ["where"] }])))).toBe("FORBIDDEN");
    expect(await code(w.as("outsider").mutation(api.combatCards.useCard, darkWhispers([touched])))).toBe("NOT_FOUND");
    expect(await kept()).toEqual([before]);
    const r = await w.as("gm").mutation(api.combatCards.useCard, darkWhispers([touched, { id: "opt:question", value: ["where"] }]));
    if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
    expect(r.roll!.dice.map((d) => d.value)).toEqual(before!.values.slice(0, r.roll!.dice.length));
    expect(await kept()).toEqual([]);
  });

  it("another player sees none of characterA's pending card uses; a weapon sanction is not a card sanction", async () => {
    const w = await buildWorld();
    const s = await scene(w);
    const r = await w.as("player").mutation(api.combatCards.useCard, useArgs(w, s, s.archerToken));
    if (r.status !== "pending") throw new Error("expected a pending card use");
    expect(await w.as("otherPlayer").query(api.combatCards.pending, { campaignId: w.campaignId })).toEqual([]);
    expect(await w.as("gm").query(api.combatCards.pending, { campaignId: w.campaignId })).toHaveLength(1);
    // The weapon-attack sanction refuses a card request (CA3 leaves it to CA4).
    expect(await code(w.as("gm").mutation(api.combatRequests.sanction, { campaignId: w.campaignId, requestId: r.requestId, approve: true, idempotencyKey: key() }))).toBe("INVALID");
  });
});
