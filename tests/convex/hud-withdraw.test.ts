/**
 * Combat HUD HD3 (plan .omc/plans/combat-hud.yaml; user answer 8a 2026-11-01): `combatWithdraw.withdraw`, a player
 * withdraws their own use waiting on the GM's approval. Nothing was rolled or paid; the GM's queue item disappears; a
 * public feed line says so. Access per role is in the authz matrix (tests/convex/authz/hud.entries.ts).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { SanctionAction } from "../../convex/lib/validators/combatRequests";
import { allowWorldEmails, buildWorld, type World } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

const CARD: SanctionAction = { kind: "card", cardId: "cinder-grasp", useId: "main", targetTokenIds: [], choices: [] };
const ATTACK: SanctionAction = { kind: "attack", slot: "primary", targetTokenIds: [], roll: {} };
const FEATURE: SanctionAction = { kind: "feature", featureId: "hope:warrior", useId: "main", targetTokenIds: [], choices: [] };

/** An open sanction of characterA asked by its player (no encounter: it counts as running). */
function sanction(w: World, action: SanctionAction, campaignId: Id<"campaigns"> = w.campaignId) {
  return w.t.run((ctx) =>
    ctx.db.insert("combatRequests", {
      campaignId,
      kind: "sanction",
      status: "open",
      createdBy: w.users.player,
      createdAt: Date.now(),
      responses: [],
      payload: { schemaVersion: 1, kind: "sanction", characterId: w.characterA, action, outOfRange: [] },
    }),
  );
}

const rowOf = (w: World, id: Id<"combatRequests">) => w.t.run((ctx) => ctx.db.get("combatRequests", id));

const feed = (w: World) =>
  w.t.run((ctx) =>
    ctx.db
      .query("actionLog")
      .withIndex("by_campaign_at", (q) => q.eq("campaignId", w.campaignId))
      .order("desc")
      .take(10),
  );

async function codeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return errorCode(error);
  }
  return "resolved";
}

const withdraw = (w: World, requestId: Id<"combatRequests">, idempotencyKey = key(), role: "player" | "otherPlayer" | "gm" | "grantee" = "player") =>
  w.as(role).mutation(api.combatWithdraw.withdraw, { campaignId: w.campaignId, idempotencyKey, requestId });

describe("combatWithdraw.withdraw", () => {
  it("closes the player's card use: the GM's queue loses it, nothing is paid, the feed says so", async () => {
    const w = await buildWorld();
    const requestId = await sanction(w, CARD);
    const sheetBefore = await w.t.run(async (ctx) => (await ctx.db.get("characters", w.characterA))!.sheet);
    expect(await w.as("gm").query(api.combatCards.pending, { campaignId: w.campaignId })).toHaveLength(1);

    expect(await withdraw(w, requestId)).toEqual({ status: "withdrawn", requestId });

    const row = await rowOf(w, requestId);
    expect(row).toMatchObject({ status: "declined", resolvedBy: w.users.player });
    expect(row!.resolvedAt).toBeTypeOf("number");
    expect(await w.as("gm").query(api.combatCards.pending, { campaignId: w.campaignId })).toEqual([]);
    expect(await w.as("player").query(api.combatCards.pending, { campaignId: w.campaignId })).toEqual([]);
    const sheetAfter = await w.t.run(async (ctx) => (await ctx.db.get("characters", w.characterA))!.sheet);
    expect(sheetAfter).toEqual(sheetBefore);

    const [line] = await feed(w);
    expect(line).toMatchObject({ kind: "combat", visibility: "public", undoable: false, actorId: w.users.player, summary: "Ash withdrew Cinder Grasp waiting for the GM" });
    expect(line!.characterId).toBeUndefined();
    // The GM's answer comes too late.
    expect(await codeOf(w.as("gm").mutation(api.combatCards.sanction, { campaignId: w.campaignId, idempotencyKey: key(), requestId, approve: true }))).toBe(
      "REQUEST_NOT_OPEN",
    );
  });

  it("withdraws an attack and a feature use, each leaving the GM's list", async () => {
    const w = await buildWorld();
    const attack = await sanction(w, ATTACK);
    const feature = await sanction(w, FEATURE);
    expect(await w.as("gm").query(api.combatRequests.mine, { campaignId: w.campaignId })).toHaveLength(1);
    expect(await w.as("gm").query(api.combatFeatures.pending, { campaignId: w.campaignId })).toHaveLength(1);

    await withdraw(w, attack);
    await withdraw(w, feature);

    expect(await w.as("gm").query(api.combatRequests.mine, { campaignId: w.campaignId })).toEqual([]);
    expect(await w.as("gm").query(api.combatFeatures.pending, { campaignId: w.campaignId })).toEqual([]);
    const summaries = (await feed(w)).map((r) => r.summary);
    expect(summaries).toContain("Ash withdrew an attack waiting for the GM");
    expect(summaries).toContain("Ash withdrew No Mercy waiting for the GM");
  });

  it("is idempotent per key; a second withdraw with a new key is REQUEST_NOT_OPEN", async () => {
    const w = await buildWorld();
    const requestId = await sanction(w, CARD);
    const k = key();
    const first = await withdraw(w, requestId, k);
    expect(await withdraw(w, requestId, k)).toEqual(first);
    expect(await codeOf(withdraw(w, requestId))).toBe("REQUEST_NOT_OPEN");
    expect((await feed(w)).filter((r) => r.summary.includes("withdrew"))).toHaveLength(1);
  });

  it("refuses a request the GM already answered", async () => {
    const w = await buildWorld();
    const requestId = await sanction(w, CARD);
    await w.as("gm").mutation(api.combatCards.sanction, { campaignId: w.campaignId, idempotencyKey: key(), requestId, approve: false });
    expect(await codeOf(withdraw(w, requestId))).toBe("REQUEST_NOT_OPEN");
    expect((await rowOf(w, requestId))!.resolvedBy).toBe(w.users.gm);
  });

  it("lets the edit grantee and the GM withdraw; refuses another player before saying whether it is open", async () => {
    const w = await buildWorld();
    const a = await sanction(w, CARD);
    expect(await codeOf(withdraw(w, a, key(), "otherPlayer"))).toBe("FORBIDDEN");
    expect(await withdraw(w, a, key(), "grantee")).toEqual({ status: "withdrawn", requestId: a });
    expect(await codeOf(withdraw(w, a, key(), "otherPlayer"))).toBe("FORBIDDEN");
    const b = await sanction(w, ATTACK);
    expect(await withdraw(w, b, key(), "gm")).toEqual({ status: "withdrawn", requestId: b });
  });

  it("is NOT_FOUND for another campaign's request and for a request that is not a sanction", async () => {
    const w = await buildWorld();
    // A request of another campaign (the GM's second table) named under this one.
    const { campaignId: otherCampaign } = await w.as("gm").mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const foreign = await sanction(w, CARD, otherCampaign);
    expect(await codeOf(withdraw(w, foreign))).toBe("NOT_FOUND");
    expect((await rowOf(w, foreign))!.status).toBe("open");

    const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: key() });
    const move = await w.t.run(async (ctx) => {
      const tokenId = await ctx.db.insert("combatTokens", {
        campaignId: w.campaignId,
        mapId,
        size: 1,
        face: 0,
        light: "none",
        revealedTo: [],
        ref: { kind: "pc", characterId: w.characterA },
        side: "pc",
        x: 5,
        y: 10,
      });
      return ctx.db.insert("combatRequests", {
        campaignId: w.campaignId,
        kind: "serverMove",
        status: "open",
        createdBy: w.users.player,
        createdAt: Date.now(),
        responses: [],
        payload: { schemaVersion: 1, kind: "serverMove", characterId: w.characterA, groupId: "g", tokenId, from: { x: 1, y: 1, face: 0 }, to: { x: 5, y: 10, face: 0 } },
      });
    });
    expect(await codeOf(withdraw(w, move))).toBe("NOT_FOUND");
    expect((await rowOf(w, move))!.status).toBe("open");
  });
});
