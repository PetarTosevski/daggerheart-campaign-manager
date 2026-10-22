/**
 * Roles on adversary actions (plan combat-actions AA2): anonymous, outsider, the hit PC's player (target), an ally's
 * player holding I Am Your Shield, another player with no part in the hit, and the GM, for attack, useFeature, respond,
 * resolve, pending, windows and (AA2c) featureAsk. Every refusal is asserted on ConvexError.data.code. Each role runs on a fresh world.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { allowWorldEmails, buildWorld, type Client, type Role } from "./authz/world";
import { errorCode, key } from "./helpers";
import { setup } from "./authz/adversary-actions.entries";

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/**
 * The matrix setup (a Bear, an open hit on Ash with Ash as its target responder) plus Bryn holding I Am Your Shield and
 * listed as an ally responder, so Bryn's player is the "ally" role.
 */
async function world() {
  const w = await buildWorld();
  await setup(w);
  const requestId = w.ids.requestId as Id<"combatRequests">;
  await w.t.run(async (ctx) => {
    const s = readSheet((await ctx.db.get("characters", w.characterB))!.sheet);
    await saveSheet(ctx, w.characterB, { ...s, armorId: "chainmail-armor", domainCards: { owned: ["i-am-your-shield"], loadout: ["i-am-your-shield"] } });
    const row = (await ctx.db.get("combatRequests", requestId))!;
    if (row.payload.kind !== "incomingHit") throw new Error("expected a hit");
    await ctx.db.patch(requestId, { payload: { ...row.payload, responders: [...row.payload.responders, { characterId: w.characterB, role: "ally", cardIds: ["i-am-your-shield"] }] } });
  });
  // "Other": each player acting for the character that isn't theirs (Ash's player on Bryn's answer and vice versa).
  return { w, requestId, bear: w.ids.bear as Id<"encounterAdversaries"> };
}

type Call = (c: Client, x: Awaited<ReturnType<typeof world>>) => Promise<unknown>;

const calls: Record<string, Call> = {
  attack: (c, x) => c.mutation(api.adversaryActions.attack, { campaignId: x.w.campaignId, instanceId: x.bear, targets: [x.w.characterA], idempotencyKey: key() }),
  useFeature: (c, x) => c.mutation(api.adversaryActions.useFeature, { campaignId: x.w.campaignId, instanceId: x.bear, feature: "Bite", targets: [x.w.characterA], idempotencyKey: key() }),
  respondAsAsh: (c, x) => c.mutation(api.adversaryActions.respond, { campaignId: x.w.campaignId, requestId: x.requestId, characterId: x.w.characterA, choice: { kind: "noArmor" }, idempotencyKey: key() }),
  respondAsBryn: (c, x) => c.mutation(api.adversaryActions.respond, { campaignId: x.w.campaignId, requestId: x.requestId, characterId: x.w.characterB, choice: { kind: "pass" }, idempotencyKey: key() }),
  resolve: (c, x) => c.mutation(api.adversaryActions.resolve, { campaignId: x.w.campaignId, requestId: x.requestId, idempotencyKey: key() }),
  pendingAsh: (c, x) => c.query(api.adversaryActions.pending, { campaignId: x.w.campaignId, characterId: x.w.characterA }),
  pendingBryn: (c, x) => c.query(api.adversaryActions.pending, { campaignId: x.w.campaignId, characterId: x.w.characterB }),
  windows: (c, x) => c.query(api.adversaryActions.windows, { campaignId: x.w.campaignId }),
  featureAsk: (c, x) => c.query(api.adversaryActions.featureAsk, { campaignId: x.w.campaignId, instanceId: x.bear, feature: "Bite" }),
};

// player = Ash's player (the target); otherPlayer = Bryn's player (the ally with I Am Your Shield).
const expected: Record<string, Partial<Record<Role, string>>> = {
  attack: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", otherPlayer: "FORBIDDEN", gm: "ok" },
  useFeature: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", otherPlayer: "FORBIDDEN", gm: "ok" },
  respondAsAsh: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "ok", otherPlayer: "FORBIDDEN", gm: "ok" },
  respondAsBryn: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", otherPlayer: "ok", gm: "ok" },
  resolve: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", otherPlayer: "FORBIDDEN", gm: "ok" },
  pendingAsh: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "ok", otherPlayer: "FORBIDDEN", gm: "ok" },
  pendingBryn: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", otherPlayer: "ok", gm: "ok" },
  windows: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", otherPlayer: "FORBIDDEN", gm: "ok" },
  // AA2c: the stat block's numbers stay with the GM; the target's and the ally's players are refused alike.
  featureAsk: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", otherPlayer: "FORBIDDEN", gm: "ok" },
};

describe("adversaryActions roles: target, ally, other, GM", () => {
  allowWorldEmails();

  for (const [name, roles] of Object.entries(expected)) {
    it(name, async () => {
      for (const [role, want] of Object.entries(roles)) {
        const x = await world();
        expect([role, await code(calls[name]!(x.w.as(role as Role), x))]).toEqual([role, want]);
      }
    }, 120_000);
  }

  it("the ally sees only who was hit; the target sees their damage; a responder who already answered is refused", async () => {
    const x = await world();
    const [allyView] = await x.w.as("otherPlayer").query(api.adversaryActions.pending, { campaignId: x.w.campaignId, characterId: x.w.characterB });
    expect(allyView).toMatchObject({ role: "ally", targetName: "Ash", cardIds: ["i-am-your-shield"] });
    expect(allyView!.damage).toBeUndefined();
    const [targetView] = await x.w.as("player").query(api.adversaryActions.pending, { campaignId: x.w.campaignId, characterId: x.w.characterA });
    expect(targetView).toMatchObject({ role: "target", damage: 6 });
    await calls.respondAsBryn!(x.w.as("otherPlayer"), x);
    expect(await code(calls.respondAsBryn!(x.w.as("otherPlayer"), x))).toBe("NOT_A_RESPONDER");
  }, 60_000);
});
