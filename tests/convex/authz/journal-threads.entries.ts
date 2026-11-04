import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: journal threads (convex/journalThreads.ts, plan journal JD6). `raised` is a campaign query with
 * `need: "view"` over the caller's OWN journal: anonymous UNAUTHENTICATED, outsider NOT_FOUND, every member ok
 * (player, other player, edit grantee, GM), each reading their own journal's pages linked to the session. The world
 * gets one played session (so players may read it) and a session log of playerA linked to it with one open task.
 * Who sees which line (per viewer, torn-out pages, planned sessions) is checked in tests/convex/journal-threads.test.ts.
 */
const area: Area = {
  area: "journal-threads",
  setup: async (w) => {
    const gm = w.as("gm");
    const campaignId = w.campaignId;
    const { sessionId } = await gm.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: freshKey() });
    await gm.mutation(api.sessionRecords.setPlayed, { campaignId, sessionId, played: true });
    const player = w.as("player");
    const page = await player.mutation(api.notes.createPage, { campaignId, kind: "log", sessionId });
    await player.mutation(api.notesEntries.add, { campaignId, page, kind: "task", text: "Find the key" });
    w.set("sessionId", sessionId);
  },
  entries: [
    {
      fn: api.journalThreads.raised,
      access: "view",
      args: (w) => ({ sessionId: w.ids.sessionId }),
      expect: { otherPlayer: "ok", grantee: "ok" },
    },
  ],
};

export default area;
