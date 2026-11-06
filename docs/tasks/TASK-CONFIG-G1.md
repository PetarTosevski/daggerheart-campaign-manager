# TASK-CONFIG-G1: co-GM permission core

Plan `.omc/plans/config.yaml`, tracer G1 (bead dcm-jh6d.5). Built on S0 (`campaignMembers.role?` and
`campaignInvites.role?` set to `"coGm"`, plus the config error codes). Binding answers: Q6 a, Q7 a, Q8 b, Q9 a.

## Permission model

- **`convex/lib/permissions.ts`** (the only place that compares roles, rule 2):
  - `Role = "gm" | "coGm" | "player"`. `campaignRole` / `campaignRoleOf` return `"coGm"` for a member row with
    `role: "coGm"`. Every invite, co-GM invites included, is still `"player"` until it is accepted, so an invitee has
    no GM rights before joining (Q8 b).
  - `rolePermission("coGm") = "owner"`. A co-GM therefore passes every `gm*` wrapper and every `need: "owner"` check
    without changes.
  - `CampaignPermission = Permission | "creator"`. `RANK` gives `creator` the value 4. `atLeast` accepts it. It is
    never stored (the `grants` validator doesn't allow it).
  - `permissionFor(ctx, user, resource, "creator")` (an overload, campaign resources only; any other resource throws)
    returns `"creator"` only when the caller has `owner` and is `campaign.ownerId`. Otherwise it returns exactly what
    `need: "owner"` gives. `campaignAccess(..., "creator")` works the same way. Existing callers keep their
    `Permission` types.
  - `removalNeed(ctx, campaign, userId)`: `"creator"` to remove a co-GM, `"owner"` to remove a player or invitee,
    `null` for the creator (nobody can remove them).
  - Journal pages (Q6 a): `readsJournalPage` passes `viewer: "gm"` for a co-GM. The rest of Notes (`lib/notes.ts`
    `notesRole`, journals) belongs to G2.
- **`convex/lib/functions.ts`**:
  - `need` accepts `"creator"`.
  - New wrappers `creatorQuery`, `creatorMutation` and `keyedCreatorMutation` fix `need` to `"creator"`.
  - `ctx.permission` is never higher than `"owner"`, because `creator` is a check, not a ctx value.
  - Archived guard: every campaign mutation wrapper (`campaignMutation`, `keyedCampaignMutation`, `gmMutation`,
    `keyedGmMutation`, `creatorMutation`, `keyedCreatorMutation`) throws `CAMPAIGN_ARCHIVED` when
    `campaign.archivedAt` is set. The option `archived: "allow"` turns it off. The guard runs after the access check,
    so a stranger still gets NOT_FOUND and a player FORBIDDEN, and before the rate limit. Queries are not guarded.
  - The table in the file header lists the new wrappers and options.

## API

- `campaigns.get`: `role` is `"gm"` for owner or better (the creator and every co-GM) and adds `isCreator`
  (boolean). `campaigns.list` also adds `isCreator` (true only for owned campaigns). Joined campaigns, co-GM ones
  included, still list as `"player"` there, because the cards' Delete / Leave choice reads `role`.
- `campaigns.remove`: `creatorMutation`, `archived: "allow"`.
- `campaigns.restore` and `campaigns.purge`: `permissionFor(..., "creator")`. On a deleted campaign, everyone but the
  creator gets NOT_FOUND, co-GMs included. On a live campaign, a co-GM gets FORBIDDEN.
- `campaigns.markOpened`: `archived: "allow"`. Accepting a co-GM invite creates the member row with `role: "coGm"`.
- `members.setCoGm`: `creatorMutation { userId, coGm: boolean }`, returns null. A non-member (an invitee, the creator,
  a stranger) gets `CO_GM_NOT_MEMBER`. Calling it again with the role the member already has is a no-op.
- `members.invite`: gains `asCoGm?: boolean`.
  - `asCoGm: true` needs the creator (`CO_GM_CREATOR_ONLY` otherwise) and stores the invite with `role: "coGm"`.
  - Re-inviting a pending address with a different role changes the pending invite. Only the creator may do that
    (`CO_GM_CREATOR_ONLY`).
  - Inviting the creator's own address is INVALID.
- `members.access`: each invite gains `asCoGm`.
- `members.roster`: every player row gains `coGm` (boolean).
- `members.removePlayer`: goes through `removalNeed`. The GM or a co-GM removes a player. Removing a co-GM needs the
  creator (`CO_GM_CREATOR_ONLY` otherwise). The creator can't be removed (INVALID).
- `members.leave`: `archived: "allow"`. The creator check is `permissionFor(..., "creator")`, so a co-GM can leave.
- Removing or leaving also deletes the member's `handFolds` rows in that campaign: a bounded read of the user's folds
  (500), then only that campaign's rows are deleted.
- `members.joinByCode`: a pending co-GM invite for the joiner's verified email makes the new member a co-GM, the same
  rule as in `markOpened`.
- Invite email (`lib/inviteEmail.ts`): `inviteEmail(gm, campaign, url, asCoGm?)` adds "as co-GM" to the subject and
  the intro. `load` returns `asCoGm`.

## Authz matrix

- The world has a new role `coGm`: a member who joins by code and is promoted with `members.setCoGm`. It owns no
  character. `ROLES` runs it just before `gm`.
- Class defaults:
  - `coGm` gets `ok` in `gm`, `view`, `edit`, `own`, `user` and `maybe`.
  - New class `creator`: anon UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, grantee FORBIDDEN, coGm
    FORBIDDEN, gm ok.
  - An entry that states a `gm` row, and every `scoped` entry, gives the co-GM the GM's outcome unless it states a
    `coGm` row (`creator` entries excepted).
- `COGM_KNOWN_GAPS` in `harness.ts` lists co-GM rows that fail until G2 runs them as `it.fails`. Today it holds only
  `notesJournals:journalView`, for dcm-jh6d.10: `notesRole` treats a co-GM as a player. The guard checks that each
  gap names a bead and a listed function.
- The guard allows `creator*` wrappers and `need: "creator"` only in class `creator`. A self-test covers this.
- `core.entries.ts`:
  - `campaigns.remove` is class `creator`, with explicit `coGm: FORBIDDEN`.
  - `restore`, `purge` and `uploadNotices.dismiss` state `coGm: NOT_FOUND`: a deleted campaign, and a notice that
    belongs to the GM's identity.
- New area `config-cogm` with `members.setCoGm` (class `creator`): every row is explicit, coGm FORBIDDEN.

## Out of owns

- `tests/convex/authz/inventory.ts` (approved by the orchestrator): `WRAPPERS` gains the three creator wrappers, and
  the `need` regex accepts `"creator"`. Without it, `wrapperOf` can't classify `members.setCoGm` /
  `campaigns.remove`.
- `convex/maps.ts`: `MapView.role` was typed as the campaign `Role`, which now includes `"coGm"`. It is now a local
  `"gm" | "player"` type. No behaviour change.

## Decisions (defaults taken)

- `archived: "allow"` on `markOpened` (the acceptance), `leave` (leaving changes nothing in the campaign) and
  `campaigns.remove` (the creator may delete an archived campaign). Every other wrapper-based mutation refuses.
- Not guarded: mutations that are not campaign wrappers (`userMutation` with a direct `permissionFor`, such as
  `restore`, `purge`, `revokeInvite`, `joinByCode`, and entry- or character-scoped functions). The acceptance asks
  for the wrappers only. A follow-up can sweep the character / codex direct-check paths.
- `revokeInvite` is unchanged: a co-GM may revoke any pending invite, a co-GM invite included.
- A co-GM gets the GM's roster, emails included.

## Checks

- `pnpm lint` (changed files) and `pnpm typecheck` are clean.
- Focused vitest (`co-gm`, `archived-guard`, `functions`, `authz-matrix`, `authz/core`, `authz/config-cogm`, every
  `authz/*`) passes. The full suite ran once with `--maxWorkers=1 --testTimeout=120000`: 525 files, 11602 tests passed,
  2 expected failures (one of them is the `journalView` co-GM gap).
- `npx convex codegen` can't run here (no `CONVEX_DEPLOYMENT` in the worktree). No new module was added, so
  `_generated/api.d.ts` needs no change (it types modules with `typeof`). The orchestrator regenerates on merge.
- No e2e was listed.
