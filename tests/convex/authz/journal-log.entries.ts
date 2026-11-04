import { api } from "../../../convex/_generated/api";
import type { Area, Outcome, Role } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: journal-log (convex/journalLog.ts, plan .omc/plans/journal.yaml JD2). Every world has one session the
 * GM started (live), so its log holds the automatic 'Session started.' line; `sourceId` names that line (source
 * 'auto'). `list` is every member's (user Q5: players read the session log without the GM-hidden lines): anonymous
 * UNAUTHENTICATED, outsider NOT_FOUND, both players and the grantee ok. `hide`, `unhide` and `setText` are the GM's:
 * players and the edit grantee FORBIDDEN. What players see and the domain refusals are in tests/convex/journal-log.test.ts.
 */

/** GM-only, with the edit-grant member refused too. */
const GM_ONLY: Partial<Record<Role, Outcome>> = { grantee: "FORBIDDEN" };
const autoLine = () => ({ source: "auto" });

const area: Area = {
  area: "journal-log",
  setup: async (w) => {
    const { sessionId } = await w.as("gm").mutation(api.sessionRecords.create, { campaignId: w.campaignId, idempotencyKey: freshKey() });
    await w.as("gm").mutation(api.sessions.start, { campaignId: w.campaignId, sessionId, idempotencyKey: freshKey() });
  },
  nameHints: { sourceId: "sessionLog" },
  entries: [
    { fn: api.journalLog.list, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
    { fn: api.journalLog.hide, access: "gm", args: autoLine, expect: GM_ONLY },
    { fn: api.journalLog.unhide, access: "gm", args: autoLine, expect: GM_ONLY },
    { fn: api.journalLog.setText, access: "gm", args: () => ({ source: "auto", text: "The party set out." }), expect: GM_ONLY },
  ],
};

export default area;
