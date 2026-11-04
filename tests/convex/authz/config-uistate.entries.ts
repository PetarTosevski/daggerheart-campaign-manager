import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: account UI state and drafts (plan config P2, Q15 b; config N4 b). Every function is a userQuery /
 * userMutation on the caller's own rows. A character-wizard draft needs view on its campaign (NOT_FOUND for an
 * outsider, tests/convex/drafts.test.ts); a level-up draft needs edit on its character, which only the character's
 * owner, the GM, a co-GM and an edit grant hold (`permissionFor` through `loadCharacter`). The matrix lists each
 * function once, so `drafts.get` and `drafts.save` run with the stricter level-up scope on playerA's character:
 * another player is FORBIDDEN, an outsider NOT_FOUND. `drafts.clear` only deletes the caller's own row and reveals
 * nothing, so it has no campaign or character check. The imports skip what the caller cannot see instead of failing.
 */
const wizard = (w: { campaignId: string }) => ({ kind: "characterWizard", campaignId: w.campaignId });
const levelUp = (w: { characterA: string }) => ({ kind: "levelUp", characterId: w.characterA });
const editorsOk = { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "ok", grantee: "ok", gm: "ok" } as const;

const area: Area = {
  area: "config-uistate",
  entries: [
    { fn: api.uiState.get, access: "user" },
    { fn: api.uiState.set, access: "user", args: () => ({ change: { key: "tokenNames", value: true } }) },
    { fn: api.uiState.importLegacy, access: "user", args: () => ({ uiState: { tokenNames: true } }) },
    { fn: api.drafts.get, access: "scoped", args: levelUp, expect: editorsOk },
    {
      fn: api.drafts.save,
      access: "scoped",
      args: (w) => ({ ...levelUp(w), schemaVersion: 1, data: "{}" }),
      expect: editorsOk,
    },
    { fn: api.drafts.clear, access: "user", args: levelUp },
    {
      fn: api.drafts.importLegacy,
      access: "user",
      args: (w) => ({ drafts: [{ ...wizard(w), data: "{}" }] }),
      note: "an outsider's draft for a campaign they cannot see is skipped, not refused",
    },
  ],
};

export default area;
