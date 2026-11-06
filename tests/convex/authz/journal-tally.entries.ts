import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: the Journal's session tally (plan .omc/plans/journal.yaml, tracer JD3a; convex/journalTally.ts).
 * Every member reads the tally (dcm-z9rz.25, user 2026-11-05): anonymous UNAUTHENTICATED, outsider NOT_FOUND, player,
 * other player, the edit-grant member and the GM ok (a planned session is SESSION_NOT_FOUND for players, checked in
 * tests/convex/journal-tally.test.ts). Every world gets
 * one session, started by the GM, which the `sessionId` hint picks. The numbers are checked in
 * tests/convex/journal-tally.test.ts.
 */
const area: Area = {
  area: "journal-tally",
  setup: async (w) => {
    await w.as("gm").mutation(api.sessionRecords.create, { campaignId: w.campaignId, idempotencyKey: freshKey() });
    await w.as("gm").mutation(api.sessions.start, { campaignId: w.campaignId, idempotencyKey: freshKey() });
  },
  entries: [
    { fn: api.journalTally.tally, access: "view", expect: { otherPlayer: "ok", grantee: "ok" } },
    // Config JO3 (Q5 a): any member may read; a player gets null while `spotlightToPlayers` is off (the default here),
    // the GM and co-GM the bars. Setting on / off per role: tests/convex/journal-spotlight-players.test.ts.
    { fn: api.journalTally.spotlight, access: "view", expect: { player: "null", otherPlayer: "null", grantee: "null" } },
  ],
};

export default area;
