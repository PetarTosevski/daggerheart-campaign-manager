import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: the Journal's session tally (plan .omc/plans/journal.yaml, tracer JD3a; convex/journalTally.ts).
 * GM only (user Q5: players see the session list, heading, recap and log, never the tally): anonymous
 * UNAUTHENTICATED, outsider NOT_FOUND, player, other player and the edit-grant member FORBIDDEN, GM ok. Every world gets
 * one session, started by the GM, which the `sessionId` hint picks. The numbers are checked in
 * tests/convex/journal-tally.test.ts.
 */
const area: Area = {
  area: "journal-tally",
  setup: async (w) => {
    await w.as("gm").mutation(api.sessionRecords.create, { campaignId: w.campaignId, idempotencyKey: freshKey() });
    await w.as("gm").mutation(api.sessions.start, { campaignId: w.campaignId, idempotencyKey: freshKey() });
  },
  entries: [{ fn: api.journalTally.tally, access: "gm", expect: { grantee: "FORBIDDEN" } }],
};

export default area;
