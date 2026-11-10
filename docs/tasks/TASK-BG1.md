# TASK-BG1: only the creator revokes a pending co-GM invite (dcm-0jdy)

Plan `.omc/plans/p2-bugs-perf4.yaml`, tracer BG1.

## Fix

- `convex/members.ts` `revokeInvite`: after the access (`owner`) and archived checks, an invite with `role: "coGm"`
  throws `CO_GM_CREATOR_ONLY` unless the caller is the creator (`isCreator`, as `invite` and `removePlayer`). Player
  invites stay revocable by the GM or a co-GM.
- `src/components/config/sections/players/invite.tsx` `EmailInvites`: no Revoke on a co-GM invite unless
  `canInviteCoGm` (the campaign's `isCreator`, passed by the Players section).
- Tests: `tests/convex/co-gm.test.ts` (co-GM refused by code, invite stays; creator revokes; co-GM revokes a player
  invite), `tests/unit/config/players.test.tsx` (co-GM sees no Revoke on the co-GM invite; creator does). The authz
  matrix entry (`tests/convex/authz/core.entries.ts`) now states `coGm: "ok"` for its player-invite setup; the matrix
  allows one entry per function, so the co-GM-invite refusal lives in `co-gm.test.ts`.

## Audit (no change): direct `permissionFor` / `campaignAccess` callers and the archived guard

The campaign wrappers (`campaignMutation`, `gmMutation`, `creatorMutation` and their keyed forms) call
`refuseArchived` after the access check. The callers below load access themselves. Callers inside a campaign wrapper
(`ctx.campaign`: combatTokens, combatVision, combatAreas, notesEntries, notesSharing, notesJournals, lib/notes,
lib/combatTokenViews, lib/spotlight) are already guarded by the wrapper and are not listed. Queries are listed only
where they matter: reads of an archived campaign are allowed by design (Q9 a).

| Function (file) | Kind | Refuses archived? | Should it? |
| --- | --- | --- | --- |
| `members.revokeInvite` | mutation | Yes (`refuseArchived`) | Yes; done |
| `members.joinByCode` | mutation | **No**: a valid code joins an archived campaign (inserts a member row, accepts a pending co-GM invite) | Open question. Consistent with `markOpened` (`archived: "allow"`, accepts invites). Joining changes the roster, not the campaign's content; but an archived campaign is "read-only for everyone". Suggest asking the user; if it should refuse, return/throw `CAMPAIGN_ARCHIVED` after the code lookup |
| Character writes via `loadCharacter` (`lib/characterSheet.ts`) | mutations | Yes (`refuseArchivedWrite`) | Yes |
| `findCharacter` callers (`rolls.tagTeamApply`) | mutation | Yes (`refuseArchived` in the caller) | Yes. Other `findCharacter` callers must remember to; the helper does not guard |
| `characterExtras` cookbook `permissionFor` | query | n/a (read) | No |
| Codex writes via `loadEntryForGm` (`codex.ts`; `dropPin`, `renamePin` path) | mutations | Yes (`refuseArchivedWrite`) | Yes |
| World map writes via `writableMap` (`maps.ts`) | mutations | Yes (`refuseArchivedWrite`) | Yes |
| `countdowns` (by countdown id, line ~426) | mutation | Yes | Yes |
| `trackers/fiveBanners` (by row id) | mutation | Yes | Yes |
| `photoImport` (owner access) | action-side mutation | Yes | Yes |
| `combatMapGenerate` (owner access) | mutation | Yes | Yes |
| `lib/actionLog.undoEntry` (undo) and `deathMoves.undo` (calls it) | mutations | Yes | Yes |
| `presence.heartbeat` / `presence.disconnect` | mutations | No | No: presence records on any campaign the caller can view (it writes the presence component, not the campaign) |
| `preferences` hand-fold import (`campaignAccess` view) | mutation | No | No: writes the caller's own `handFolds` rows |
| `drafts` (character-wizard drafts, `campaignAccess` view) | mutations | No | Probably no: a user's own draft rows. A character created from the draft is refused later by the character create path |
| `campaigns.restore` / `campaigns.purge` (creator) | mutations | No | No: lifecycle of a deleted campaign; archive state is irrelevant |
| `campaigns.get` (`campaignAccess`, ownerView) | query | n/a | No |
| `lib/fearVisibility`, `lib/lorekeeper/caps.gmOf`, `deathMoves.isGmOf`, `lib/lorekeeper/context` | helpers (permission tests only) | n/a | Their mutation callers decide; not audited further here |

Summary: every direct-access write that changes campaign content already refuses an archived campaign
(dcm-jh6d.64). The one open case is `members.joinByCode`, which adds a member to an archived campaign; it matches
`markOpened` accepting an invite, so whether it should refuse is a product question for the user.
