import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { applyTrackerRule } from "../../convex/lib/trackers";
import { RuleError } from "../../src/lib/errors/app-error";
import { huntTitleSchema } from "../../src/lib/frames/trackers/andaluria";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const PLAYER = "player@example.com";

async function setup(frameId: "dark-heart-of-andaluria" | "witherwild" = "dark-heart-of-andaluria") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }),
    player: await ctx.db.insert("users", { email: PLAYER, emailVerificationTime: 1 }),
    stranger: await ctx.db.insert("users", { email: "other@example.com", emailVerificationTime: 1 }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|session` });
  const gm = as(ids.gm);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Jesaña", idempotencyKey: key() });
  await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
  return { t, gm, player: as(ids.player), stranger: as(ids.stranger), campaignId };
}

const a = api.trackers.andaluria;

describe("andaluria hunts", () => {
  useAllowlist(`gm@example.com,${PLAYER},other@example.com`);

  it("creates hunts in order and replays a retried create", async () => {
    const { gm, campaignId } = await setup();
    const k = key();
    const { huntId } = await gm.mutation(a.createHunt, { campaignId, title: "The Drowned Bell", idempotencyKey: k });
    expect((await gm.mutation(a.createHunt, { campaignId, title: "The Drowned Bell", idempotencyKey: k })).huntId).toBe(huntId);
    await gm.mutation(a.createHunt, { campaignId, title: "Wolf of Serracorte", idempotencyKey: key() });
    const { hunts } = await gm.query(a.get, { campaignId });
    expect(hunts.map((h) => [h.title, h.beat])).toEqual([
      ["The Drowned Bell", "arrival"],
      ["Wolf of Serracorte", "arrival"],
    ]);
    const mismatch = await gm.mutation(a.createHunt, { campaignId, title: "Other", idempotencyKey: k }).catch((e) => e);
    expect(errorCode(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("players see title, beat and revealed clues only; the monster after the GM reveals it", async () => {
    const { gm, player, campaignId } = await setup();
    const { huntId } = await gm.mutation(a.createHunt, { campaignId, title: "The Drowned Bell", idempotencyKey: key() });
    await gm.mutation(a.updateHunt, {
      campaignId,
      huntId,
      patch: { monster: "Siren", what: "A grieving siren", wants: "Banish sorrow", where: "The bay", defeat: "Church bells", beat: "investigation", underlings: ["Drowned sailors"], bystanders: ["Fisher Ana"] },
      idempotencyKey: key(),
    });
    const { clueId: c1 } = await gm.mutation(a.createClue, { campaignId, huntId, text: "Wet footprints", idempotencyKey: key() });
    const { clueId: c2 } = await gm.mutation(a.createClue, { campaignId, huntId, text: "Children hum a song", idempotencyKey: key() });

    let view = await player.query(a.get, { campaignId });
    expect(view).toEqual({
      role: "player",
      hunts: [{ id: huntId, title: "The Drowned Bell", beat: "investigation", archived: false, clues: [], allCluesRevealed: false }],
    });

    await gm.mutation(a.updateClue, { campaignId, huntId, clueId: c1, patch: { revealed: true, note: "At the chapel" }, idempotencyKey: key() });
    view = await player.query(a.get, { campaignId });
    expect(view.hunts[0].clues).toEqual([{ id: c1, text: "Wet footprints" }]);
    expect(JSON.stringify(view)).not.toMatch(/Siren|bells|sailors|Fisher|chapel|hum a song/);

    await gm.mutation(a.updateClue, { campaignId, huntId, clueId: c2, patch: { revealed: true }, idempotencyKey: key() });
    expect((await player.query(a.get, { campaignId })).hunts[0].allCluesRevealed).toBe(true);
    expect((await gm.query(a.get, { campaignId })).hunts[0].allCluesRevealed).toBe(true);

    await gm.mutation(a.updateHunt, { campaignId, huntId, patch: { monsterRevealed: true }, idempotencyKey: key() });
    const revealed = await player.query(a.get, { campaignId });
    expect(revealed.hunts[0]).toMatchObject({ monster: { monster: "Siren", defeat: "Church bells" } });
    expect(JSON.stringify(revealed)).not.toMatch(/sailors|Fisher|chapel/);
  });

  it("edits, archives and deletes; validates input", async () => {
    const { gm, campaignId } = await setup();
    const { huntId } = await gm.mutation(a.createHunt, { campaignId, title: "Hunt", idempotencyKey: key() });
    const { clueId } = await gm.mutation(a.createClue, { campaignId, huntId, text: "clue", idempotencyKey: key() });
    await gm.mutation(a.updateClue, { campaignId, huntId, clueId, patch: { text: "better clue" }, idempotencyKey: key() });
    await gm.mutation(a.updateHunt, { campaignId, huntId, patch: { archived: true }, idempotencyKey: key() });
    let hunt = (await gm.query(a.get, { campaignId })).hunts[0];
    expect(hunt).toMatchObject({ archived: true, clues: [{ text: "better clue", revealed: false }] });

    for (const call of [
      () => gm.mutation(a.createHunt, { campaignId, title: "  ", idempotencyKey: key() }),
      () => gm.mutation(a.updateHunt, { campaignId, huntId, patch: { beat: "finale" }, idempotencyKey: key() }),
      () => gm.mutation(a.updateHunt, { campaignId, huntId: "missing", patch: { monster: "x" }, idempotencyKey: key() }),
      () => gm.mutation(a.createClue, { campaignId, huntId, text: "", idempotencyKey: key() }),
      () => gm.mutation(a.updateClue, { campaignId, huntId, clueId: "missing", patch: { revealed: true }, idempotencyKey: key() }),
    ]) {
      expect(errorCode(await call().catch((e) => e))).toBe("INVALID");
    }

    await gm.mutation(a.deleteClue, { campaignId, huntId, clueId, idempotencyKey: key() });
    hunt = (await gm.query(a.get, { campaignId })).hunts[0];
    expect(hunt.clues).toEqual([]);
    await gm.mutation(a.deleteHunt, { campaignId, huntId, idempotencyKey: key() });
    expect((await gm.query(a.get, { campaignId })).hunts).toEqual([]);
  });

  it("only the GM changes hunts; strangers and anonymous users are refused", async () => {
    const { t, gm, player, stranger, campaignId } = await setup();
    const { huntId } = await gm.mutation(a.createHunt, { campaignId, title: "Hunt", idempotencyKey: key() });
    for (const call of [
      () => player.mutation(a.createHunt, { campaignId, title: "Mine", idempotencyKey: key() }),
      () => player.mutation(a.updateHunt, { campaignId, huntId, patch: { monsterRevealed: true }, idempotencyKey: key() }),
      () => player.mutation(a.createClue, { campaignId, huntId, text: "x", idempotencyKey: key() }),
    ]) {
      expect(errorCode(await call().catch((e) => e))).toBe("FORBIDDEN");
    }
    expect(errorCode(await stranger.query(a.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorCode(await t.query(a.get, { campaignId }).catch((e) => e))).toBe("UNAUTHENTICATED");
  });

  it("is disabled in other frames", async () => {
    const { gm, campaignId } = await setup("witherwild");
    for (const call of [
      () => gm.query(a.get, { campaignId }),
      () => gm.mutation(a.createHunt, { campaignId, title: "Hunt", idempotencyKey: key() }),
    ]) {
      expect(errorCode(await call().catch((e) => e))).toBe("MECHANIC_DISABLED");
    }
  });

  it("refuses corrupt saved data with TRACKER_CORRUPT", async () => {
    const { t, gm, player, campaignId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("frameTrackers", { campaignId, key: "andaluria", data: { hunts: [{ id: "h1", title: "No beat" }] }, updatedAt: 0 }),
    );
    expect(errorCode(await gm.query(a.get, { campaignId }).catch((e) => e))).toBe("TRACKER_CORRUPT");
    expect(errorCode(await player.query(a.get, { campaignId }).catch((e) => e))).toBe("TRACKER_CORRUPT");
    const error = await gm.mutation(a.createHunt, { campaignId, title: "Hunt", idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(error)).toBe("TRACKER_CORRUPT");
  });
});

describe("applyTrackerRule", () => {
  it("turns a plain domain Error into a RuleError with the tracker's code", async () => {
    const error = await applyTrackerRule("TRACKER_RULE", () => {
      throw new Error("That Sacred Pyre is gone.");
    }).catch((e) => e);
    expect(error).toBeInstanceOf(RuleError);
    expect(error).toMatchObject({ code: "TRACKER_RULE", message: "That Sacred Pyre is gone." });
  });

  it("passes RuleError and ZodError through to the wrapper and rethrows bugs unchanged", async () => {
    const rule = new RuleError("DOOM_RULE", "No.");
    expect(await applyTrackerRule("TRACKER_RULE", () => Promise.reject(rule)).catch((e) => e)).toBe(rule);
    const zod = huntTitleSchema.safeParse("");
    expect(await applyTrackerRule("TRACKER_RULE", () => Promise.reject(zod.error)).catch((e) => e)).toBe(zod.error);
    const bug = new TypeError("Cannot read properties of undefined");
    expect(await applyTrackerRule("TRACKER_RULE", () => Promise.reject(bug)).catch((e) => e)).toBe(bug);
  });
});
