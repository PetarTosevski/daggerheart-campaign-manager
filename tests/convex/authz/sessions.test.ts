import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { api } from "../../../convex/_generated/api";
import { runMatrix } from "./harness";
import area from "./sessions.entries";
import { freshKey } from "./synth";
import { allowWorldEmails, buildWorld } from "./world";

runMatrix(area);

/** The code a refused call threw (TE1: asserted on `ConvexError.data.code`, never on message text). */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    if (e instanceof ConvexError && typeof e.data === "object" && e.data !== null) return (e.data as { code: string }).code;
    throw e;
  }
  return "ok";
}

/**
 * The players' view of sessions, for what a matrix outcome cannot state: a player's list holds the live and played
 * sessions (with recap, without the GM's times) and never a planned one, and on a live or played session every GM
 * read (prep, wrap) refuses a player. (The Journal's log, spotlight and tally reads have their own player rules:
 * journal-log.test.ts, journal-spotlight-players.test.ts.)
 */
describe("authz matrix: sessions, players' view", () => {
  allowWorldEmails();

  it("players read only live and played sessions; GM prep and wrap-up stay GM-only", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    const gm = w.as("gm");
    const create = async () => (await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: freshKey() })).sessionId;

    const played = await create();
    await gm.mutation(api.sessionWrap.setRecap, { campaignId, sessionId: played, recap: "They crossed the river." });
    await gm.mutation(api.sessionRecords.setPlayed, { campaignId, sessionId: played, played: true });
    const live = await create();
    await gm.mutation(api.sessionPrep.setHooks, { campaignId, sessionId: live, hooks: "GM secret hook" });
    await gm.mutation(api.sessions.start, { campaignId, sessionId: live, idempotencyKey: freshKey() });
    await gm.mutation(api.sessionPlay.addLog, { campaignId, sessionId: live, text: "GM log line", idempotencyKey: freshKey() });
    const planned = await create();

    expect((await gm.query(api.sessionRecords.list, { campaignId })).map((s) => s._id)).toEqual([planned, live, played]);

    for (const role of ["player", "otherPlayer"] as const) {
      const as = w.as(role);
      const list = await as.query(api.sessionRecords.list, { campaignId });
      expect(list.map((s) => [s._id, s.status])).toEqual([
        [live, "live"],
        [played, "played"],
      ]);
      expect(list.find((s) => s._id === played)?.recap).toBe("They crossed the river.");
      // Journal Q4: every member writes the recap of a session they can read; a planned one stays hidden.
      expect(await codeOf(as.mutation(api.sessionWrap.setRecap, { campaignId, sessionId: live, recap: `${role} was here` }))).toBe("ok");
      expect(await codeOf(as.mutation(api.sessionWrap.setRecap, { campaignId, sessionId: planned, recap: "x" }))).toBe("SESSION_NOT_FOUND");
      expect(list.every((s) => s.startedAt === undefined && s.endedAt === undefined)).toBe(true);
      expect(JSON.stringify(list)).not.toContain("GM secret hook");

      const dashboard = await as.query(api.sessionWrap.dashboard, { campaignId });
      expect(dashboard.live?.sessionId).toBe(live);
      expect(dashboard.lastPlayed?.sessionId).toBe(played);
      expect((await as.query(api.sessions.current, { campaignId })).sessionId).toBe(live);

      for (const sessionId of [live, played]) {
        expect(await codeOf(as.query(api.sessionPrep.get, { campaignId, sessionId }))).toBe("FORBIDDEN");
        expect(await codeOf(as.query(api.sessionWrap.get, { campaignId, sessionId }))).toBe("FORBIDDEN");
      }
    }
  });
});
