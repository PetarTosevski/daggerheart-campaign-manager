/**
 * Errors of the Sessions board (D10: session records, prep, play, wrap-up, live start and end, the session
 * encounter). Contract: see `actionLog.ts`; add this domain's codes here only. Every D10 tracer throws only these
 * codes (plus the common ones and the encounter / combat map codes it reuses: ENCOUNTER_LIMIT, ENCOUNTER_RUNNING,
 * COMBAT_TOKEN_LIMIT); a code missing here means stop and ask the orchestrator (plan `.omc/plans/d10-sessions.yaml`).
 */
export const sessionMessages = {
  /** A session id that is not in this campaign (bad id, other campaign, deleted), or a planned one asked for by a player (Q4). */
  SESSION_NOT_FOUND: "That session isn't in this campaign anymore.",
  /** MAX_SESSIONS per campaign. */
  SESSION_LIMIT: "This campaign already has 300 sessions. Delete one first.",
  /** Deleting, or marking played / not played, the session that is running (Q10, B1). */
  SESSION_LIVE: "That session is running. End the session first.",
  /** MAX_LOG_ENTRIES per session. */
  SESSION_LOG_LIMIT: "This session's log already has 500 entries. Remove one first.",
  /** A log entry id that is not in this session's log. */
  SESSION_LOG_NOT_FOUND: "That log entry isn't there anymore.",
  /** MAX_SCENES per session. */
  SESSION_SCENE_LIMIT: "This session already has 20 planned scenes. Remove one first.",
  /** A scene id that is not in this session's prep. */
  SESSION_SCENE_NOT_FOUND: "That scene isn't there anymore.",
  /** Placing or reading the session encounter when the session has none linked (Q1, Q2). */
  SESSION_NO_ENCOUNTER: "No planned session with an encounter.",
  /** Creating or linking an encounter for a session that already has one (one encounter per session, Q1). */
  SESSION_HAS_ENCOUNTER: "This session already has an encounter. Unlink it first.",
  /** Journal: hiding or editing a log line whose source row (feed, Fear, encounter, stamp) is not in this session's log. */
  SESSION_LOG_SOURCE_NOT_FOUND: "That log line isn't in this session's log anymore.",
  /** Journal: MAX_LOG_OVERRIDES hidden or edited lines per session. */
  SESSION_LOG_OVERRIDE_LIMIT: "This session already has 500 hidden or edited log lines. Show one again first.",
  /** Journal (Q7): a scene state change that is not allowed (e.g. 'Playing now' on a session that is not live or planned). */
  SESSION_SCENE_STATE: "That scene can't change to that state now.",
} as const satisfies Record<string, string>;
