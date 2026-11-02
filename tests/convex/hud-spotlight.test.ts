import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { assertMayAct, gmHoldsSpotlight, moveToGm, type ActKind } from "../../convex/lib/spotlight";
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

describe("combatSpotlight.state", () => {
  it("starts with nobody in particular: no holder, no reactions-only, only the GM may move it", async () => {
    const w = await buildWorld();
    const none = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false };
    expect(await state(w, "gm")).toEqual({ ...none, canMove: true });
    expect(await state(w, "player")).toEqual({ ...none, canMove: false });
    expect(await state(w, "grantee")).toEqual({ ...none, canMove: false });
    expect(await rows(w)).toEqual([]);
  });

  it("the GM takes it: players read reactions only, the GM does not; taking it again writes nothing", async () => {
    const w = await buildWorld();
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

describe("assertMayAct (answer 1c; user answer 2026-11-01: token moves too)", () => {
  it("lets everyone act while nobody or a PC holds it", async () => {
    const w = await buildWorld();
    for (const kind of ["action", "move", "reaction"] as const) expect(await mayAct(w, "player", w.characterA, kind)).toBe("ok");
    await handTo(w, w.characterB);
    for (const kind of ["action", "move", "reaction"] as const) expect(await mayAct(w, "player", w.characterA, kind)).toBe("ok");
  });

  it("while the GM holds it a player may only react: actions and token moves are SPOTLIGHT_WITH_GM", async () => {
    const w = await buildWorld();
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
