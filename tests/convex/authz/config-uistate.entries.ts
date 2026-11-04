import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: account UI state and drafts (plan config P2, Q15 b). Every function is a userQuery / userMutation on the
 * caller's own rows, so every signed-in role is ok. A character-wizard draft also needs view on its campaign:
 * `drafts.get` and `drafts.save` with the world's campaign are NOT_FOUND for the outsider. `drafts.clear` only
 * deletes the caller's own row and reveals nothing, so it has no campaign check. The imports skip what the caller
 * cannot see instead of failing.
 */
const wizard = (w: { campaignId: string }) => ({ kind: "characterWizard", campaignId: w.campaignId });
const memberOk = { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "ok", player: "ok", grantee: "ok", gm: "ok" } as const;

const area: Area = {
  area: "config-uistate",
  entries: [
    { fn: api.uiState.get, access: "user" },
    { fn: api.uiState.set, access: "user", args: () => ({ change: { key: "tokenNames", value: true } }) },
    { fn: api.uiState.importLegacy, access: "user", args: () => ({ uiState: { tokenNames: true } }) },
    { fn: api.drafts.get, access: "scoped", args: wizard, expect: memberOk },
    {
      fn: api.drafts.save,
      access: "scoped",
      args: (w) => ({ ...wizard(w), schemaVersion: 1, data: "{}" }),
      expect: memberOk,
    },
    { fn: api.drafts.clear, access: "user", args: wizard },
    {
      fn: api.drafts.importLegacy,
      access: "user",
      args: (w) => ({ drafts: [{ ...wizard(w), data: "{}" }] }),
      note: "an outsider's draft for a campaign they cannot see is skipped, not refused",
    },
  ],
};

export default area;
