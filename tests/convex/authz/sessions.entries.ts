import { api } from "../../../convex/_generated/api";
import type { Area, Entry, Outcome, Role, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: sessions (sessions, sessionRecords, sessionPrep, sessionPlay, sessionWrap). Filled by tracer H12
 * (.omc/plans/d12-hardening.yaml); bead dcm-bxp.57 (and .64 for sessions.start / end).
 *
 * Every world gets one planned session (`sessionRecords.create`), the row the `sessionId` hint picks. Three reads are
 * for every member (`sessions.current`, `sessionRecords.list`, `sessionWrap.dashboard`); everything else is GM-only
 * (`need: "owner"`), so a player never reads GM prep or wrap-up. The old Play-stage reads (`sessionPlay.spotlight`,
 * `tally`, `log`), `bumpSpotlight`, `sessionPrep.unlinkEncounter` and `sessionWrap.setThreads` were removed (JF3);
 * `sessionPrep.createEncounter` / `linkEncounter` are internal seeding functions now. The GM
 * entries add a grantee row: a campaign edit grant does not reach the GM's session tools. `sessionRecords.list` runs
 * on the planned session alone, so both players get an empty list (players read only live and played sessions);
 * sessions.test.ts checks the players' view of live and played sessions.
 *
 * `combatTokensReads.sessionEncounter` and `combatTokens.placeSessionEncounter` (also bead .57) are in combat.entries.ts (H11).
 */

/** GM-only, with the edit-grant member refused too. */
const GM_ONLY: Partial<Record<Role, Outcome>> = { grantee: "FORBIDDEN" };

/** The world's planned session, started by the GM (live). */
async function liveSession(w: World) {
  await w.as("gm").mutation(api.sessions.start, { campaignId: w.campaignId, idempotencyKey: freshKey() });
}

/** A combat scene on the session's prep, registered as `sceneId`. */
async function scene(w: World) {
  const { sceneId } = await w.as("gm").mutation(api.sessionPrep.addScene, { campaignId: w.campaignId, sessionId: await w.idOf("sessions") });
  w.set("sceneId", sceneId);
}

/** A typed log line on the session, registered as `logId` (the hint picks it). */
async function logLine(w: World) {
  const { logId } = await w.as("gm").mutation(api.sessionPlay.addLog, {
    campaignId: w.campaignId,
    sessionId: await w.idOf("sessions"),
    text: "The party crossed the river.",
    idempotencyKey: freshKey(),
  });
  w.use("sessionLog", logId);
}

const gm = (entry: Omit<Entry, "access">): Entry => ({ ...entry, access: "gm", expect: { ...GM_ONLY, ...entry.expect } });

const sessions: Entry[] = [
  { fn: api.sessions.current, access: "view" },
  gm({ fn: api.sessions.allowExtraCharacters, setup: liveSession, args: () => ({ allow: true }) }),
  gm({ fn: api.sessions.start }),
  gm({ fn: api.sessions.end, setup: liveSession }),
];

const records: Entry[] = [
  // Only a planned session exists: the GM's list holds it, the players' lists are empty.
  { fn: api.sessionRecords.list, access: "view", expect: { otherPlayer: "empty", player: "empty" } },
  gm({ fn: api.sessionRecords.create }),
  gm({ fn: api.sessionRecords.setTitle, args: () => ({ title: "The river" }) }),
  gm({ fn: api.sessionRecords.setDate, args: () => ({ date: "2026-10-21" }) }),
  gm({ fn: api.sessionRecords.setPlayed, args: () => ({ played: true }) }),
  gm({ fn: api.sessionRecords.remove }),
];

const prep: Entry[] = [
  gm({ fn: api.sessionPrep.get }),
  gm({ fn: api.sessionPrep.current }),
  gm({ fn: api.sessionPrep.addScene }),
  gm({ fn: api.sessionPrep.setScene, setup: scene, args: (w) => ({ sceneId: w.ids.sceneId, text: "Ambush at the ford" }) }),
  gm({ fn: api.sessionPrep.removeScene, setup: scene, args: (w) => ({ sceneId: w.ids.sceneId }) }),
  gm({ fn: api.sessionPrep.setHooks, args: () => ({ hooks: "The bridge is out." }) }),
];

const play: Entry[] = [
  gm({ fn: api.sessionPlay.resetSpotlight }),
  gm({ fn: api.sessionPlay.addLog, args: () => ({ text: "The party crossed the river." }) }),
  gm({ fn: api.sessionPlay.removeLog, setup: logLine }),
];

const wrap: Entry[] = [
  gm({ fn: api.sessionWrap.get }),
  // sessionWrap.setRecap is every member's since Journal Q4: journal-recap.entries.ts.
  gm({ fn: api.sessionWrap.setLoot, args: () => ({ loot: "A silver key." }) }),
  gm({ fn: api.sessionWrap.callMilestone }),
  { fn: api.sessionWrap.dashboard, access: "view" },
];

const area: Area = {
  area: "sessions",
  setup: async (w) => {
    await w.as("gm").mutation(api.sessionRecords.create, { campaignId: w.campaignId, idempotencyKey: freshKey() });
  },
  entries: [...sessions, ...records, ...prep, ...play, ...wrap],
};

export default area;
