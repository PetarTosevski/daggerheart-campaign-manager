import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { assertMayAct, gmHoldsSpotlight, moveToGm, type ActKind } from "../../convex/lib/spotlight";
import { recordSeen } from "../../convex/lib/spotlightSeen";
import { allowWorldEmails, buildWorld, type Role, type World } from "./authz/world";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key } from "./helpers";

// Combat HUD H1.S (plan .omc/plans/combat-hud.yaml, user answer 1c; CB p.100, p.149): who holds the spotlight, the
// GM's take and hand-back, and the server helpers the engine calls (moveToGm on a roll with Fear or a failure,
// assertMayAct refusing a player's action or token move while the GM holds it). Access is in the authz matrix
// (tests/convex/authz/spotlight.entries.ts).

allowWorldEmails();

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
};

const state = (w: World, role: Role) => w.as(role).query(api.combatSpotlight.state, { campaignId: w.campaignId });
const take = (w: World) => w.as("gm").mutation(api.combatSpotlight.gmTake, { campaignId: w.campaignId, idempotencyKey: key() });
const handTo = (w: World, characterId: Id<"characters">) =>
  w.as("gm").mutation(api.combatSpotlight.handTo, { campaignId: w.campaignId, characterId, idempotencyKey: key() });

/** Runs `assertMayAct` as `role` for `characterId`; "ok" or the refusal's code. */
function mayAct(w: World, role: Exclude<Role, "anon">, characterId: Id<"characters">, kind: ActKind) {
  return code(
    w.t.run(async (ctx) => {
      const user = (await ctx.db.get("users", w.users[role]))!;
      const campaign = (await ctx.db.get("campaigns", w.campaignId))!;
      const character = (await ctx.db.get("characters", characterId))!;
      await assertMayAct({ ...ctx, user }, campaign, character, kind);
    }),
  );
}

/** A second campaign of the same GM, in the same world, with one GM-made character. */
async function secondCampaign(w: World) {
  const gm = w.as("gm");
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Elsewhere", idempotencyKey: key() });
  const { characterId } = await gm.mutation(api.characters.create, { campaignId, draft: characterDraft("Cass"), idempotencyKey: key() });
  return { campaignId, characterId };
}

const rows = (w: World) => w.t.run((ctx) => ctx.db.query("combatSpotlight").collect());

/**
 * A running encounter in the world's campaign: players wait on the GM's spotlight only during one (S2, plan rule-switches
 * RS2, user answer 2026-11-06).
 */
const fight = (w: World) =>
  w.t.run((ctx) => ctx.db.insert("encounters", { campaignId: w.campaignId, name: "Fight", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: 1, updatedAt: 1, startedAt: 1 }));

describe("combatSpotlight.state", () => {
  it("starts with nobody in particular: no holder, no reactions-only, only the GM may move it", async () => {
    const w = await buildWorld();
    const none = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, adversaryTokenId: null, adversaryName: null, adversaryPortrait: null };
    expect(await state(w, "gm")).toEqual({ ...none, canMove: true });
    expect(await state(w, "player")).toEqual({ ...none, canMove: false });
    expect(await state(w, "grantee")).toEqual({ ...none, canMove: false });
    expect(await rows(w)).toEqual([]);
  });

  it("the GM takes it: players read reactions only, the GM does not; taking it again writes nothing", async () => {
    const w = await buildWorld();
    await fight(w);
    expect(await take(w)).toEqual({ moved: true });
    const gm = await state(w, "gm");
    expect(gm).toMatchObject({ holder: { kind: "gm" }, reason: "gmTook", rollBy: null, reactionsOnly: false, canMove: true });
    expect(typeof gm.since).toBe("number");
    expect(await state(w, "player")).toMatchObject({ holder: { kind: "gm" }, reactionsOnly: true, canMove: false });
    expect(await state(w, "otherPlayer")).toMatchObject({ reactionsOnly: true });
    // An edit grant is not the GM: the grantee reacts only too.
    expect(await state(w, "grantee")).toMatchObject({ reactionsOnly: true, canMove: false });

    const [before] = await rows(w);
    expect(await take(w)).toEqual({ moved: false });
    expect(await rows(w)).toEqual([before]);
  });

  it("the GM hands it back to a PC: the state names the PC and nobody is reactions-only", async () => {
    const w = await buildWorld();
    await take(w);
    expect(await handTo(w, w.characterA)).toEqual({ moved: true });
    for (const role of ["gm", "player", "otherPlayer"] as const) {
      expect(await state(w, role)).toMatchObject({ holder: { kind: "pc", characterId: w.characterA, name: "Ash" }, reason: "handedBack", reactionsOnly: false });
    }
    expect(await handTo(w, w.characterA)).toEqual({ moved: false });
    expect(await handTo(w, w.characterB)).toEqual({ moved: true });
    expect(await state(w, "player")).toMatchObject({ holder: { kind: "pc", characterId: w.characterB, name: "Bryn" } });
    expect(await rows(w)).toHaveLength(1);
  });

  it("a keyed replay returns the first answer and moves nothing; a different request under the same key is refused", async () => {
    const w = await buildWorld();
    const args = { campaignId: w.campaignId, idempotencyKey: key() };
    const gm = w.as("gm");
    expect(await gm.mutation(api.combatSpotlight.handTo, { ...args, characterId: w.characterA })).toEqual({ moved: true });
    await take(w);
    expect(await gm.mutation(api.combatSpotlight.handTo, { ...args, characterId: w.characterA })).toEqual({ moved: true });
    expect(await state(w, "gm")).toMatchObject({ holder: { kind: "gm" } });
    expect(await code(gm.mutation(api.combatSpotlight.handTo, { ...args, characterId: w.characterB }))).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("refuses a character of another campaign (NOT_FOUND) and one that is not active (INVALID)", async () => {
    const w = await buildWorld();
    const other = await secondCampaign(w);
    expect(await code(handTo(w, other.characterId))).toBe("NOT_FOUND");
    await w.t.run((ctx) => ctx.db.patch("characters", w.characterB, { status: "retired" }));
    expect(await code(handTo(w, w.characterB))).toBe("INVALID");
    expect(await rows(w)).toEqual([]);
  });

  it("a holder whose character is gone reads as nobody in particular", async () => {
    const w = await buildWorld();
    await handTo(w, w.characterA);
    await w.t.run((ctx) => ctx.db.delete("characters", w.characterA));
    expect(await state(w, "player")).toMatchObject({ holder: null, since: null, reason: null, reactionsOnly: false });
  });

  it("one campaign's spotlight never shows in another", async () => {
    const w = await buildWorld();
    await fight(w);
    const other = await secondCampaign(w);
    await take(w);
    expect(await w.as("gm").query(api.combatSpotlight.state, { campaignId: other.campaignId })).toMatchObject({ holder: null });
    await w.as("gm").mutation(api.combatSpotlight.handTo, { campaignId: other.campaignId, characterId: other.characterId, idempotencyKey: key() });
    expect(await state(w, "player")).toMatchObject({ holder: { kind: "gm" }, reactionsOnly: true });
  });
});

describe("moveToGm (CB p.100, p.149)", () => {
  it("a PC's roll with Fear moves it to the GM and names the roller; a later failure keeps the first move", async () => {
    const w = await buildWorld();
    await fight(w);
    await handTo(w, w.characterA);
    const moved = await w.t.run(async (ctx) => moveToGm(ctx, (await ctx.db.get("campaigns", w.campaignId))!, "rollWithFear", w.characterA));
    expect(moved).toBe(true);
    const first = await state(w, "player");
    expect(first).toMatchObject({ holder: { kind: "gm" }, reason: "rollWithFear", rollBy: { characterId: w.characterA, name: "Ash" }, reactionsOnly: true });

    const again = await w.t.run(async (ctx) => moveToGm(ctx, (await ctx.db.get("campaigns", w.campaignId))!, "failedRoll", w.characterB));
    expect(again).toBe(false);
    expect(await state(w, "player")).toEqual(first);
  });

  it("a failed roll moves it with reason failedRoll; spotlighting an adversary keeps no roller", async () => {
    const w = await buildWorld();
    await w.t.run(async (ctx) => moveToGm(ctx, (await ctx.db.get("campaigns", w.campaignId))!, "failedRoll", w.characterB));
    expect(await state(w, "gm")).toMatchObject({ reason: "failedRoll", rollBy: { characterId: w.characterB, name: "Bryn" } });

    await handTo(w, w.characterA);
    await w.t.run(async (ctx) => moveToGm(ctx, (await ctx.db.get("campaigns", w.campaignId))!, "adversary", w.characterA));
    expect(await state(w, "gm")).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", rollBy: null });
    expect(await w.t.run((ctx) => gmHoldsSpotlight(ctx, w.campaignId))).toBe(true);
  });
});

/** A map in `campaignId` with two adversary tokens (the Knife, the Bandit) and Ash's PC token. */
async function tokens(w: World, campaignId: Id<"campaigns"> = w.campaignId) {
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  return w.t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const adversary = async (label: string, x: number) => {
      const adversaryId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: x,
        summoned: false,
        stats: { difficulty: 10, major: 5, severe: 10, hpMax: 6, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId }, side: "enemy", x, y: 2, face: 0 });
    };
    const knife = await adversary("Knife", 4);
    const bandit = await adversary("Bandit", 6);
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 1, y: 2, face: 0 });
    return { knife, bandit, ash };
  });
}

/** Records a token as seen by the party this scene (what `combatVision.markSeen` writes; spotlight-seen.test.ts covers it). */
const seen = (w: World, tokenId: Id<"combatTokens">) => w.t.run((ctx) => recordSeen(ctx, w.campaignId, [tokenId]));

const spotlight = (w: World, tokenId: string, idempotencyKey = key()) =>
  w.as("gm").mutation(api.combatSpotlight.gmTake, { campaignId: w.campaignId, tokenId, idempotencyKey });

describe("gmTake({ tokenId }): the GM spotlights an adversary, whose token the map lights (dcm-bxp.99.32.35)", () => {
  it("names the token for every member; the same adversary again writes nothing; another keeps `since`", async () => {
    const w = await buildWorld();
    const { knife, bandit } = await tokens(w);
    await handTo(w, w.characterA);
    expect(await spotlight(w, knife)).toEqual({ moved: true });
    // User 2026-11-03: the GM always learns which adversary; players only once the party saw it this scene.
    expect(await state(w, "gm")).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", rollBy: null, adversaryTokenId: knife, adversaryName: "Knife" });
    for (const role of ["player", "otherPlayer", "grantee"] as const) {
      expect(await state(w, role)).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", rollBy: null, adversaryTokenId: null, adversaryName: null });
    }
    await seen(w, knife);
    for (const role of ["player", "otherPlayer", "grantee"] as const) {
      expect(await state(w, role)).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", rollBy: null, adversaryTokenId: knife, adversaryName: "Knife" });
    }
    const [first] = await rows(w);
    expect(await spotlight(w, knife)).toEqual({ moved: false });
    expect(await rows(w)).toEqual([first]);

    expect(await spotlight(w, bandit)).toEqual({ moved: true });
    const next = await state(w, "gm");
    expect(next).toMatchObject({ reason: "adversary", adversaryTokenId: bandit, since: first!.since });
  });

  it("a general take keeps the lit adversary; a hand-back to a PC and a roll's move from a PC clear it", async () => {
    const w = await buildWorld();
    const { knife } = await tokens(w);
    await seen(w, knife);
    await spotlight(w, knife);
    expect(await take(w)).toEqual({ moved: false });
    expect(await state(w, "player")).toMatchObject({ adversaryTokenId: knife });

    await handTo(w, w.characterA);
    expect(await state(w, "player")).toMatchObject({ holder: { kind: "pc" }, adversaryTokenId: null });
    expect((await rows(w))[0]!.adversaryTokenId).toBeUndefined();

    await spotlight(w, knife);
    await handTo(w, w.characterB);
    await w.t.run(async (ctx) => moveToGm(ctx, (await ctx.db.get("campaigns", w.campaignId))!, "rollWithFear", w.characterB));
    expect(await state(w, "gm")).toMatchObject({ holder: { kind: "gm" }, reason: "rollWithFear", adversaryTokenId: null });
  });

  it("the GM taking it from the start with an adversary lights it; without one nothing is lit", async () => {
    const w = await buildWorld();
    const { knife } = await tokens(w);
    await take(w);
    expect(await state(w, "gm")).toMatchObject({ reason: "gmTook", adversaryTokenId: null });
    expect(await spotlight(w, knife)).toEqual({ moved: true });
    expect(await state(w, "gm")).toMatchObject({ reason: "adversary", adversaryTokenId: knife });
  });

  it("refuses a PC's token (INVALID), another campaign's or a made-up token (COMBAT_TOKEN_NOT_FOUND) and writes nothing", async () => {
    const w = await buildWorld();
    const { ash } = await tokens(w);
    const other = await secondCampaign(w);
    const elsewhere = await tokens(w, other.campaignId);
    expect(await code(spotlight(w, ash))).toBe("INVALID");
    expect(await code(spotlight(w, elsewhere.knife))).toBe("COMBAT_TOKEN_NOT_FOUND");
    expect(await code(spotlight(w, "not-a-token"))).toBe("COMBAT_TOKEN_NOT_FOUND");
    expect(await rows(w)).toEqual([]);
  });

  it("a keyed replay with another token is IDEMPOTENCY_MISMATCH", async () => {
    const w = await buildWorld();
    const { knife, bandit } = await tokens(w);
    const k = key();
    expect(await spotlight(w, knife, k)).toEqual({ moved: true });
    expect(await spotlight(w, knife, k)).toEqual({ moved: true });
    expect(await code(spotlight(w, bandit, k))).toBe("IDEMPOTENCY_MISMATCH");
    expect(await state(w, "gm")).toMatchObject({ adversaryTokenId: knife });
  });

  it("an older row without the field reads as nothing lit", async () => {
    const w = await buildWorld();
    await w.t.run((ctx) => ctx.db.insert("combatSpotlight", { campaignId: w.campaignId, holder: { kind: "gm" }, since: 1, reason: "adversary" }));
    expect(await state(w, "player")).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", adversaryTokenId: null });
  });
});

describe("assertMayAct (answer 1c; user answer 2026-11-01: token moves too)", () => {
  it("lets everyone act while nobody or a PC holds it", async () => {
    const w = await buildWorld();
    for (const kind of ["action", "move", "reaction"] as const) expect(await mayAct(w, "player", w.characterA, kind)).toBe("ok");
    await handTo(w, w.characterB);
    for (const kind of ["action", "move", "reaction"] as const) expect(await mayAct(w, "player", w.characterA, kind)).toBe("ok");
  });

  it("while the GM holds it a player may only react: actions and token moves are SPOTLIGHT_WITH_GM", async () => {
    const w = await buildWorld();
    await fight(w);
    await take(w);
    expect(await mayAct(w, "player", w.characterA, "action")).toBe("SPOTLIGHT_WITH_GM");
    expect(await mayAct(w, "player", w.characterA, "move")).toBe("SPOTLIGHT_WITH_GM");
    expect(await mayAct(w, "player", w.characterA, "reaction")).toBe("ok");
    expect(await mayAct(w, "otherPlayer", w.characterB, "action")).toBe("SPOTLIGHT_WITH_GM");
    expect(await mayAct(w, "grantee", w.characterA, "move")).toBe("SPOTLIGHT_WITH_GM");
    // The GM is never refused, also when playing for a PC.
    for (const kind of ["action", "move", "reaction"] as const) expect(await mayAct(w, "gm", w.characterA, kind)).toBe("ok");

    await handTo(w, w.characterA);
    expect(await mayAct(w, "player", w.characterA, "action")).toBe("ok");
  });

  it("a character of another campaign is a programming error, not a refusal", async () => {
    const w = await buildWorld();
    const other = await secondCampaign(w);
    await take(w);
    const result = await w.t
      .run(async (ctx) => {
        const user = (await ctx.db.get("users", w.users.player))!;
        const campaign = (await ctx.db.get("campaigns", w.campaignId))!;
        await assertMayAct({ ...ctx, user }, campaign, { _id: other.characterId, campaignId: other.campaignId }, "action");
      })
      .then(
        () => "ok",
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
    expect(result).toMatch(/not in this campaign/);
  });
});
