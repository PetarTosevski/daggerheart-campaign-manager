import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode } from "./helpers";

/**
 * DA6 (plan drawer-answers, user answers 2026-10-30): the GM's "Play for this character" switch, one per PC, stored on
 * the server so it follows the GM to every device; on until the GM turns it off. GM only.
 */

allowWorldEmails();

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
};

describe("playFor", () => {
  it("turns a PC's switch on and off; setting it twice keeps one row; other PCs keep theirs", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const campaignId = w.campaignId;
    expect(await gm.query(api.playFor.list, { campaignId })).toEqual([]);

    await gm.mutation(api.playFor.set, { campaignId, characterId: w.characterA, on: true });
    await gm.mutation(api.playFor.set, { campaignId, characterId: w.characterA, on: true });
    await gm.mutation(api.playFor.set, { campaignId, characterId: w.characterB, on: true });
    expect((await gm.query(api.playFor.list, { campaignId })).sort()).toEqual([w.characterA, w.characterB].sort());
    const rows = await w.t.run((ctx) => ctx.db.query("playFor").collect());
    expect(rows.filter((r) => r.characterId === w.characterA)).toHaveLength(1);
    expect(rows.every((r) => r.userId === w.users.gm && r.campaignId === campaignId)).toBe(true);

    await gm.mutation(api.playFor.set, { campaignId, characterId: w.characterA, on: false });
    await gm.mutation(api.playFor.set, { campaignId, characterId: w.characterA, on: false });
    expect(await gm.query(api.playFor.list, { campaignId })).toEqual([w.characterB]);
  });

  it("is the GM's only: players and outsiders are refused, anonymous callers too", async () => {
    const w = await buildWorld();
    const args = { campaignId: w.campaignId, characterId: w.characterA, on: true };
    expect(await code(w.as("player").mutation(api.playFor.set, args))).toBe("FORBIDDEN");
    expect(await code(w.as("player").query(api.playFor.list, { campaignId: w.campaignId }))).toBe("FORBIDDEN");
    expect(await code(w.as("outsider").mutation(api.playFor.set, args))).toBe("NOT_FOUND");
    expect(await code(w.as("anon").query(api.playFor.list, { campaignId: w.campaignId }))).toBe("UNAUTHENTICATED");
    expect(await w.t.run((ctx) => ctx.db.query("playFor").collect())).toEqual([]);
  });
});
