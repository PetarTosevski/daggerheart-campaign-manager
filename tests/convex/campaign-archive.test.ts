import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key } from "./helpers";
import { buildWorld, type World } from "./authz/world";

/**
 * Config S3 (docs/tasks/TASK-CONFIG-S3.md): the creator archives and restores a campaign (Q9 a, Q7 a). Archived means
 * read-only for everyone (G1's guard; tests/convex/archived-guard.test.ts covers every wrapper), never while a session
 * is live, and Load Campaign still lists it, flagged. Every refusal asserts `ConvexError.data.code`.
 */

const fail = (p: Promise<unknown>) => p.then(() => "resolved", errorCode);

async function archivedAt(w: World) {
  return w.t.run(async (ctx) => (await ctx.db.get("campaigns", w.campaignId))?.archivedAt ?? null);
}

describe("archive a campaign (config S3)", () => {
  it("the creator archives: writes are refused for everyone, reads go on; restore opens writes again", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    await w.as("gm").mutation(api.campaignSettings.archive, { campaignId });
    expect(await archivedAt(w)).toBeTypeOf("number");

    const draft = { campaignId, draft: characterDraft("Cael"), idempotencyKey: key() };
    expect(await fail(w.as("player").mutation(api.characters.create, draft))).toBe("CAMPAIGN_ARCHIVED");
    expect(await fail(w.as("gm").mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() }))).toBe(
      "CAMPAIGN_ARCHIVED",
    );
    expect(await w.as("player").query(api.campaigns.get, { campaignId })).toMatchObject({ archived: true });

    await w.as("gm").mutation(api.campaignSettings.unarchive, { campaignId });
    expect(await archivedAt(w)).toBeNull();
    expect(await w.as("player").query(api.campaigns.get, { campaignId })).toMatchObject({ archived: false });
    await w.as("gm").mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() });
  });

  it("archive and unarchive are idempotent", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    await w.as("gm").mutation(api.campaignSettings.archive, { campaignId });
    const first = await archivedAt(w);
    await w.as("gm").mutation(api.campaignSettings.archive, { campaignId });
    expect(await archivedAt(w)).toBe(first);
    await w.as("gm").mutation(api.campaignSettings.unarchive, { campaignId });
    await w.as("gm").mutation(api.campaignSettings.unarchive, { campaignId });
    expect(await archivedAt(w)).toBeNull();
  });

  it("refuses to archive while a session is live, with 'End the session first.'", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    await w.as("gm").mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    expect(await fail(w.as("gm").mutation(api.campaignSettings.archive, { campaignId }))).toBe("INVALID");
    expect(await archivedAt(w)).toBeNull();
  });

  it("only the creator archives or restores: a co-GM and a player are FORBIDDEN", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    for (const role of ["coGm", "player"] as const) {
      expect(await fail(w.as(role).mutation(api.campaignSettings.archive, { campaignId }))).toBe("FORBIDDEN");
    }
    await w.as("gm").mutation(api.campaignSettings.archive, { campaignId });
    for (const role of ["coGm", "player"] as const) {
      expect(await fail(w.as(role).mutation(api.campaignSettings.unarchive, { campaignId }))).toBe("FORBIDDEN");
    }
    expect(await archivedAt(w)).toBeTypeOf("number");
  });

  it("campaigns.list keeps an archived campaign, flagged, for the creator and its players", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    await w.as("gm").mutation(api.campaignSettings.archive, { campaignId });
    for (const role of ["gm", "player"] as const) {
      const listed = await w.as(role).query(api.campaigns.list, {});
      expect(listed.find((c) => c._id === campaignId)).toMatchObject({ archived: true });
    }
    await w.as("gm").mutation(api.campaignSettings.unarchive, { campaignId });
    const listed = await w.as("gm").query(api.campaigns.list, {});
    expect(listed.find((c) => c._id === campaignId)).toMatchObject({ archived: false });
  });
});
