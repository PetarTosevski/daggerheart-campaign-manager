import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const PLAYER = "player@example.com";
const PLAYER2 = "player2@example.com";

async function setup(frameId: "reign-of-the-weredragon" | "witherwild" = "reign-of-the-weredragon") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    player: await ctx.db.insert("users", { email: PLAYER, name: "Ana" }),
    player2: await ctx.db.insert("users", { email: PLAYER2, name: "Bo" }),
    stranger: await ctx.db.insert("users", { email: "other@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|session` });
  const gm = as(ids.gm);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Whelvia", idempotencyKey: key() });
  await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
  await gm.mutation(api.members.invite, { campaignId, email: PLAYER2 });
  return { t, gm, player: as(ids.player), player2: as(ids.player2), stranger: as(ids.stranger), campaignId };
}

const w = api.trackers.weredragon;

describe("weredragon revelations", () => {
  useAllowlist(`gm@example.com,${PLAYER},${PLAYER2},other@example.com`);

  it("starts with five hidden revelations in book order", async () => {
    const { gm, campaignId } = await setup();
    const state = await gm.query(w.get, { campaignId });
    expect(state.revelations.map((r) => [r.kind, r.status])).toEqual([
      ["secret", "hidden"],
      ["ally", "hidden"],
      ["key1", "hidden"],
      ["key2", "hidden"],
      ["showdown", "hidden"],
    ]);
    expect(state.showdownReady).toBe(false);
  });

  it("rolls 5d6 on the server, replays a retried read, and applies the GM's assignment", async () => {
    const { gm, campaignId } = await setup();
    const k = key();
    const { roll } = await gm.mutation(w.readNightSky, { campaignId, idempotencyKey: k });
    expect(roll).toHaveLength(5);
    roll.forEach((d) => expect(d >= 1 && d <= 6 && Number.isInteger(d)).toBe(true));
    expect((await gm.mutation(w.readNightSky, { campaignId, idempotencyKey: k })).roll).toEqual(roll);
    expect((await gm.query(w.get, { campaignId })).pendingRoll).toEqual(roll);

    const bad = await gm.mutation(w.assignReading, { campaignId, assignment: [0, 0, 1, 2, 3], idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(bad)).toBe("INVALID");

    const assignment = [4, 3, 2, 1, 0];
    const result = await gm.mutation(w.assignReading, { campaignId, assignment, idempotencyKey: key() });
    expect(Array.isArray(result.clashes)).toBe(true);
    const state = await gm.query(w.get, { campaignId });
    expect(state.pendingRoll).toBeNull();
    expect(state.revelations.map((r) => r.die)).toEqual(assignment.map((i) => roll[i]));
    state.revelations.forEach((r) => expect(r.text).not.toBe(""));

    const again = await gm.mutation(w.assignReading, { campaignId, assignment, idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(again)).toBe("INVALID");
  });

  it("warns when two revelations land in the same place", async () => {
    const { t, gm, campaignId } = await setup();
    await gm.mutation(w.readNightSky, { campaignId, idempotencyKey: key() });
    // Force a known roll: Secret 1 (Nightshade) and Key to Victory 2 die 2 (Scepter in Nightshade).
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("frameTrackers")
        .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).eq("key", "weredragon"))
        .unique();
      await ctx.db.patch(row!._id, { data: { ...row!.data, pendingRoll: [1, 2, 3, 2, 4] } });
    });
    const { clashes } = await gm.mutation(w.assignReading, { campaignId, assignment: [0, 1, 2, 3, 4], idempotencyKey: key() });
    expect(clashes).toEqual([{ place: "Nightshade", kinds: ["secret", "key2"] }]);
  });

  it("hides each revelation from players until it is revealed", async () => {
    const { gm, player, campaignId } = await setup();
    await gm.mutation(w.updateRevelation, { campaignId, kind: "ally", die: 6, idempotencyKey: key() });
    await gm.mutation(w.updateRevelation, { campaignId, kind: "secret", die: 2, idempotencyKey: key() });

    let view = await player.query(w.get, { campaignId });
    expect(view.role).toBe("player");
    expect(JSON.stringify(view.revelations)).not.toMatch(/Harrowyrr|Elevarne/);

    await gm.mutation(w.updateRevelation, { campaignId, kind: "ally", status: "revealed", idempotencyKey: key() });
    view = await player.query(w.get, { campaignId });
    expect(view.revelations[1]).toMatchObject({ die: 6, status: "revealed" });
    expect(view.revelations[1].text).toContain("Harrowyrr");
    expect(view.revelations[0]).toEqual({ kind: "secret", die: null, text: "", status: "hidden" });
  });

  it("derives showdownReady from revelations 1–4 achieved", async () => {
    const { gm, player, campaignId } = await setup();
    for (const kind of ["secret", "ally", "key1", "key2"]) {
      expect((await gm.query(w.get, { campaignId })).showdownReady).toBe(false);
      await gm.mutation(w.updateRevelation, { campaignId, kind, status: "achieved", idempotencyKey: key() });
    }
    expect((await gm.query(w.get, { campaignId })).showdownReady).toBe(true);
    expect((await player.query(w.get, { campaignId })).showdownReady).toBe(true);
  });

  it("validates revelation edits", async () => {
    const { gm, campaignId } = await setup();
    for (const args of [
      { kind: "nope", status: "revealed" },
      { kind: "ally", status: "maybe" },
      { kind: "ally", die: 7 },
      { kind: "ally", text: "x".repeat(1001) },
    ]) {
      const error = await gm.mutation(w.updateRevelation, { campaignId, ...args, idempotencyKey: key() }).catch((e) => e);
      expect(errorCode(error)).toBe("INVALID");
    }
  });

  it("keeps Forlorne secrets private: players see only their own, the GM sees all and marks them used", async () => {
    const { gm, player, player2, campaignId } = await setup();
    const k = key();
    const { secretId } = await player.mutation(w.submitSecret, { campaignId, text: "She fears the stars", idempotencyKey: k });
    // A retried submission does not duplicate.
    expect((await player.mutation(w.submitSecret, { campaignId, text: "She fears the stars", idempotencyKey: k })).secretId).toBe(secretId);
    await player2.mutation(w.submitSecret, { campaignId, text: "Schon is a traitor", idempotencyKey: key() });

    const mine = await player.query(w.get, { campaignId });
    expect(mine.secrets.map((s) => s.text)).toEqual(["She fears the stars"]);
    expect(JSON.stringify(mine)).not.toContain("Schon");
    const theirs = await player2.query(w.get, { campaignId });
    expect(theirs.secrets.map((s) => s.text)).toEqual(["Schon is a traitor"]);

    const all = await gm.query(w.get, { campaignId });
    expect(all.secrets.map((s) => [s.text, s.authorName])).toEqual([
      ["She fears the stars", "Ana"],
      ["Schon is a traitor", "Bo"],
    ]);

    await gm.mutation(w.setSecretUsed, { campaignId, secretId, used: true, idempotencyKey: key() });
    expect((await gm.query(w.get, { campaignId })).secrets[0].used).toBe(true);
    // The author never learns which secret the GM picked.
    expect((await player.query(w.get, { campaignId })).secrets[0].used).toBe(false);

    const forbidden = await player.mutation(w.setSecretUsed, { campaignId, secretId, used: false, idempotencyKey: key() }).catch((e) => e);
    expect(errorData(forbidden)).toBe("FORBIDDEN");
    const empty = await player.mutation(w.submitSecret, { campaignId, text: "   ", idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(empty)).toBe("INVALID");
  });

  it("only the GM changes revelations; strangers and anonymous users see nothing", async () => {
    const { t, player, stranger, campaignId } = await setup();
    for (const call of [
      () => player.mutation(w.readNightSky, { campaignId, idempotencyKey: key() }),
      () => player.mutation(w.assignReading, { campaignId, assignment: [0, 1, 2, 3, 4], idempotencyKey: key() }),
      () => player.mutation(w.updateRevelation, { campaignId, kind: "ally", status: "revealed", idempotencyKey: key() }),
    ]) {
      expect(errorData(await call().catch((e) => e))).toBe("FORBIDDEN");
    }
    expect(errorData(await stranger.query(w.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await stranger.mutation(w.submitSecret, { campaignId, text: "x", idempotencyKey: key() }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await t.query(w.get, { campaignId }).catch((e) => e))).toBe("UNAUTHENTICATED");
  });

  it("rejects a reused idempotency key with a different request", async () => {
    const { gm, campaignId } = await setup();
    const k = key();
    await gm.mutation(w.updateRevelation, { campaignId, kind: "ally", status: "revealed", idempotencyKey: k });
    const mismatch = await gm.mutation(w.updateRevelation, { campaignId, kind: "ally", status: "achieved", idempotencyKey: k }).catch((e) => e);
    expect(errorData(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("is disabled in other frames", async () => {
    const { gm, player, campaignId } = await setup("witherwild");
    for (const call of [
      () => gm.query(w.get, { campaignId }),
      () => gm.mutation(w.readNightSky, { campaignId, idempotencyKey: key() }),
      () => gm.mutation(w.updateRevelation, { campaignId, kind: "ally", status: "revealed", idempotencyKey: key() }),
      () => player.mutation(w.submitSecret, { campaignId, text: "x", idempotencyKey: key() }),
    ]) {
      expect(errorData(await call().catch((e) => e))).toBe("MECHANIC_DISABLED");
    }
  });
});
