import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key } from "./helpers";
import { buildWorld, type World } from "./authz/world";

/**
 * Config G1 (docs/tasks/TASK-CONFIG-G1.md): an archived campaign is read-only for everyone (Q9 a). Every campaign
 * mutation wrapper refuses with CAMPAIGN_ARCHIVED after the access check (so a stranger still gets NOT_FOUND), unless
 * the function passes `archived: "allow"` (markOpened, leave, remove). Queries keep reading it.
 */

const fail = (p: Promise<unknown>) => p.then(() => "resolved", errorCode);

async function archivedWorld(): Promise<World> {
  const w = await buildWorld();
  await w.t.run((ctx) => ctx.db.patch("campaigns", w.campaignId, { archivedAt: Date.now() }));
  return w;
}

describe("archived campaign write guard (config G1)", () => {
  it("refuses writes through every kind of campaign mutation wrapper with CAMPAIGN_ARCHIVED", async () => {
    const w = await archivedWorld();
    const campaignId = w.campaignId;
    // keyedGmMutation, for the creator and a co-GM.
    for (const role of ["gm", "coGm"] as const) {
      expect(await fail(w.as(role).mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() }))).toBe(
        "CAMPAIGN_ARCHIVED",
      );
    }
    // gmMutation.
    expect(await fail(w.as("gm").mutation(api.campaigns.setPlayersSeeHands, { campaignId, enabled: false }))).toBe("CAMPAIGN_ARCHIVED");
    // campaignMutation (need edit).
    expect(await fail(w.as("gm").mutation(api.campaigns.setTimeOfDay, { campaignId, timeOfDay: "night" }))).toBe("CAMPAIGN_ARCHIVED");
    // creatorMutation.
    expect(await fail(w.as("gm").mutation(api.members.setCoGm, { campaignId, userId: w.users.player, coGm: true }))).toBe(
      "CAMPAIGN_ARCHIVED",
    );
    // keyedCampaignMutation: a player's character creation.
    expect(
      await fail(w.as("player").mutation(api.characters.create, { campaignId, draft: characterDraft("Cael"), idempotencyKey: key() })),
    ).toBe("CAMPAIGN_ARCHIVED");
    // A co-GM's removal of a player (gmMutation, no allow).
    expect(await fail(w.as("coGm").mutation(api.members.removePlayer, { campaignId, userId: w.users.player }))).toBe("CAMPAIGN_ARCHIVED");
  });

  it("checks access first: a stranger gets NOT_FOUND and a player FORBIDDEN, never CAMPAIGN_ARCHIVED", async () => {
    const w = await archivedWorld();
    const args = { campaignId: w.campaignId, direction: "increase" as const };
    expect(await fail(w.as("outsider").mutation(api.fear.adjust, { ...args, idempotencyKey: key() }))).toBe("NOT_FOUND");
    expect(await fail(w.as("player").mutation(api.fear.adjust, { ...args, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await fail(w.as("coGm").mutation(api.campaigns.remove, { campaignId: w.campaignId }))).toBe("FORBIDDEN");
  });

  it("markOpened, queries, leaving and deleting still work", async () => {
    const w = await archivedWorld();
    const campaignId = w.campaignId;
    await w.as("player").mutation(api.campaigns.markOpened, { campaignId });
    await w.as("gm").mutation(api.campaigns.markOpened, { campaignId });
    expect(await w.as("player").query(api.campaigns.get, { campaignId })).toMatchObject({ archived: true });
    expect(await w.as("coGm").query(api.campaigns.fear, { campaignId })).toBe(0);
    expect((await w.as("player").query(api.members.roster, { campaignId })).players.length).toBeGreaterThan(0);
    await w.as("otherPlayer").mutation(api.members.leave, { campaignId });
    await w.as("gm").mutation(api.campaigns.remove, { campaignId });
    expect(await w.as("gm").query(api.campaigns.get, { campaignId })).toBeNull();
  });

  it("an invite is still accepted when its invitee opens the archived campaign", async () => {
    const w = await buildWorld();
    await w.as("gm").mutation(api.members.invite, { campaignId: w.campaignId, email: "late@example.com", asCoGm: true });
    await w.t.run((ctx) => ctx.db.patch("campaigns", w.campaignId, { archivedAt: Date.now() }));
    const id = await w.t.run((ctx) => ctx.db.insert("users", { email: "late@example.com", emailVerificationTime: 1 }));
    await w.t.withIdentity({ subject: `${id}|session` }).mutation(api.campaigns.markOpened, { campaignId: w.campaignId });
    const row = await w.t.run((ctx) =>
      ctx.db
        .query("campaignMembers")
        .withIndex("by_campaign_user", (q) => q.eq("campaignId", w.campaignId).eq("userId", id))
        .unique(),
    );
    expect(row?.role).toBe("coGm");
  });
});
