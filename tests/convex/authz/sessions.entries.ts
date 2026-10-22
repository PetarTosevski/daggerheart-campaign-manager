import { api } from "../../../convex/_generated/api";
import type { Area, Entry, Outcome, Role, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: sessions (sessions, sessionRecords, sessionPrep, sessionPlay, sessionWrap). Filled by tracer H12
 * (.omc/plans/d12-hardening.yaml); bead dcm-bxp.57 (and .64 for sessions.start / end).
 *
 * Every world gets one planned session (`sessionRecords.create`), the row the `sessionId` hint picks. Three reads are
 * for every member (`sessions.current`, `sessionRecords.list`, `sessionWrap.dashboard`); everything else is GM-only
 * (`need: "owner"`), so a player never reads GM prep, the session log, the spotlight counts or the tally. The GM
 * entries add a grantee row: a campaign edit grant does not reach the GM's session tools. `sessionRecords.list` runs
 * on the planned session alone, so both players get an empty list (players read only live and played sessions);
 * sessions.test.ts checks the players' view of live and played sessions.
 *
 * `combatTokens.sessionEncounter` and `combatTokens.placeSessionEncounter` (also bead .57) are in combat.entries.ts (H11).
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

/** An encounter not linked to any session (the `encounterId` hint picks it). */
async function encounter(w: World) {
  await w.as("gm").mutation(api.encounters.create, { campaignId: w.campaignId, name: "Ambush", idempotencyKey: freshKey() });
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
  gm({ fn: api.sessionPrep.createEncounter }),
  gm({ fn: api.sessionPrep.linkEncounter, setup: encounter }),
  gm({ fn: api.sessionPrep.unlinkEncounter }),
];

const play: Entry[] = [
  gm({ fn: api.sessionPlay.spotlight }),
  gm({ fn: api.sessionPlay.bumpSpotlight }),
  gm({ fn: api.sessionPlay.resetSpotlight }),
  gm({ fn: api.sessionPlay.tally }),
  gm({ fn: api.sessionPlay.log, setup: logLine }),
  gm({ fn: api.sessionPlay.addLog, args: () => ({ text: "The party crossed the river." }) }),
  gm({ fn: api.sessionPlay.removeLog, setup: logLine }),
];

const wrap: Entry[] = [
  gm({ fn: api.sessionWrap.get }),
  gm({ fn: api.sessionWrap.setRecap, args: () => ({ recap: "They crossed the river." }) }),
  gm({ fn: api.sessionWrap.setLoot, args: () => ({ loot: "A silver key." }) }),
  gm({ fn: api.sessionWrap.setThreads, args: () => ({ threads: "Who burned the bridge?" }) }),
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
