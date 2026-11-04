# TASK-CONFIG-G2: co-GM sweep

Plan `.omc/plans/config.yaml`, tracer G2 (bead dcm-jh6d.10). Built on G1 (fbcd80e9). Binding: Q6 a. A co-GM reads
Notes like the GM: GM-only pages and every shared page. Pages a co-GM writes belong to their own journal.

## Model

- **Viewer side (role).** In Notes, a caller "reads and acts as the GM" when `readsAsGm(role)` is true, where
  `role` comes from `notesRole` / `campaignRole` and the check is `role !== "player"`, so the creator and every
  co-GM qualify. This is the split `readsJournalPage` already uses in `lib/permissions.ts`. The role is never null
  there: `notesRole` throws NOT_FOUND for a caller with no role (grant-only, outsider), `journalPagePermission`
  returns null before the check, and `pageAccess` guards `role !== null`.
- **Owner side (identity).** `ownsGmJournal(campaign, userId)` is `userId === campaign.ownerId`. The GM journal is
  the creator's: GM template (`private` default, three visibilities), never departs, labelled "GM" / "Game Master",
  holds the house rules. A co-GM's journal is a member journal, like a player's: player template, all five
  visibilities (default `gm`, so the creator and other co-GMs read it), named after their character or account,
  departs when they leave.
- `PageAccess.isGm` now means viewer side (creator or co-GM). New `PageAccess.ownerIsGm` is the identity of the
  page's journal.

## Classification of every `campaign.ownerId` comparison in the owned files

| Site | Kind | Now |
|---|---|---|
| `lib/notes.ts` `currentJournal`: account journal for the GM | identity | `ownsGmJournal`. Only the creator has the account journal |
| `lib/notes.ts` `ensureJournal` template / default visibility | identity | `ownsGmJournal` |
| `lib/notes.ts` `ensureJournal` default session (planned visible) | role | `readsAsGm(role)` |
| `lib/notes.ts` `pageAccess.isGm` (tear out departed pages, link planned sessions) | role | `readsAsGm(role)` |
| `lib/notes.ts` `findPage` / `resolvePage` template numbering | identity | `ownsGmJournal(journal.userId)` |
| `lib/notes.ts` `addSessionPages` default visibility | identity | `ownsGmJournal` |
| `lib/journalState.ts` `departed`: GM journal never departs | identity | kept, comment |
| `notesEntries.ts` `authorLabels` "GM" | identity | `ownsGmJournal` (a co-GM's entries carry their own name) |
| `notesEntries.ts` `entries` template before journal | identity | `ownsGmJournal` |
| `notesEntries.ts` `add` author character | identity | `character === null` (the creator's current journal has none) |
| `notesEntries.ts` migrate new page visibility | identity | `access.ownerIsGm` |
| `notesThreads.ts` planned sessions | role | `readsAsGm` |
| `notesThreads.ts` author label "GM" | identity | `ownsGmJournal` |
| `notesSharing.ts` `setVisibility` allowed values | identity | `access.ownerIsGm` |
| `notesSharing.ts` `recipients` GM row | identity | `ownsGmJournal(caller)`: a co-GM's page offers the creator as a recipient |
| `notesSharing.ts` `eligible`: the creator has no member row | identity | kept, comment |
| `notesSharing.ts` `shared` Players tab ('gm' pages) | role | `readsAsGm` |
| `notesSharing.ts` `shared` GM tab / `ownerIsGm` chips | identity | kept (`gmId`) |
| `notesJournals.ts` `ownerOf.isGm` | identity | `ownsGmJournal` |
| `notesJournals.ts` `playerJournals` gate | role | `readsAsGm`; the caller's own journal is skipped too |
| `notesJournals.ts` `pastJournals` GM journal skip | identity | `ownsGmJournal` |
| `notesJournals.ts` `journalView` present-journal gate, linked session | role | `readsAsGm` (closes the `journalView` co-GM gap) |
| `lib/characterSheet.ts` `assertOneActive` GM exemption | role | the owner's role via `campaignRoleOf` → `rolePermission` ≥ owner: GM and co-GM characters are exempt |
| `characters.ts` `ownerFor`: the creator has no member row | identity | kept, comment (co-GMs pass the member lookup) |
| `photoImport.ts` `ownerFor` | identity | kept, comment |
| `lib/lorekeeper/context.ts` house rules from the GM journal | identity | kept, comment |
| `combatRequests.ts` e2e seed `createdBy` | identity | kept, comment |

Already permission-derived (no change): `charactersReads.ts` (`editsAll`), `combatVision.ts`, `lib/cardHand.ts`,
`lib/combatHud.ts`, `lib/combatTokenViews.ts`, `lib/combatMovement.ts`, `lorekeeperAsks.ts`. Their
`character.ownerId === user._id` checks are identity ("my character"). The grep of `ownerId` in `convex/` finds no
role-style comparison outside `lib/permissions.ts`. `members.ts` (G1) keeps its creator-identity checks.

## Out of owns (orchestrator approved)

- `tests/convex/authz/harness.ts`: `COGM_KNOWN_GAPS` is empty now that `notesJournals:journalView` is closed.
- `convex/lib/permissions.ts` `journalPagePermission`, binned branch: `role !== "gm"` became `role === "player"`.
  A co-GM who tears out a departed page can see and restore it. `role` is non-null there (null returns earlier).
- `convex/notes.ts`: `journal` and `createPage` use `readsAsGm(role)` for planned-session visibility. Heading and
  templates stay identity (`role === "gm"`, which only the creator has).

## Decisions (defaults taken)

- A co-GM's journal is a member journal (player template and visibilities). Only the creator's journal is the GM
  journal.
- A co-GM's own characters are exempt from one active character per player, as the GM's are.
- A co-GM's entries are labelled with their character or account name, not "GM".
- `revokeInvite` is not in G2's owns: unchanged (dcm-0jdy stays open).

## Tests

`tests/convex/co-gm-sweep.test.ts` covers:

- A co-GM reads a player's GM-only page. Another player and a member grantee get NOTE_PAGE_NOT_FOUND. A grant-only
  account gets NOTE_PAGE_NOT_FOUND on the page and NOT_FOUND on `journalView`. An outsider gets NOT_FOUND.
- `journalView`, `playerJournals` and the Players tab give the co-GM the GM's view.
- The co-GM's own journal is a member journal.
- A co-GM tears out a departed page and restores it.
- A co-GM edits any character sheet.
- A co-GM approves a combat request. A player and a grantee are FORBIDDEN.
- The one-active-character exemption.

## Checks

- `pnpm typecheck` and eslint on the changed files are clean.
- Focused vitest passed: co-gm-sweep, co-gm, notes-*, authz-matrix, lorekeeper*, characters*. 20 files, 303 tests.
- The full suite ran once with `--maxWorkers=1 --testTimeout=120000`: 534 files, 11742 passed, 1 expected fail (G1 had 2,
  one of them the `journalView` gap), 1 todo.
`npx convex codegen` was not needed: no module was added.
