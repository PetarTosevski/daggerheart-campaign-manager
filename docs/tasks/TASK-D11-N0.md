# TASK-D11-N0: Notes foundation

Plan `.omc/plans/d11-notes.yaml`, tracer N0 (wave 1, foundation). Bead dcm-bxp.10.

## Goal

The notes tables exist and are purged with their campaign, `permissionFor` and `pageAccess` decide every page read
and action by the visibility, departure and authorship rules, the journal helpers (current journal, attachment,
`ensureJournal`, template refs) are wired, and `/campaigns/<id>/notes` opens a board-look shell with stubs for GM and
players.

## Rules implemented (quoted from the plan)

- Visibility table: "Readers besides the owner, journal present: gm -> GM; private -> nobody; players -> other players,
  not the GM; everyone -> every member; chosen -> recipients (D4). Departed journal (D1): private stays owner-only,
  every other value -> every member. The GM journal never departs. Binned pages: owner (and the GM for a departed
  journal's page it tore out) only, in the bin. A page the caller may not read answers NOTE_PAGE_NOT_FOUND, exactly as a
  deleted one."
- D1: "Departure is computed at read time, never stored ... 'away' ... is not a departure. A rejoin or a status set
  back to 'active' restores the previous visibility by itself."
- D2: "A departed journal is frozen: nobody adds or edits entries, not even its owner ...; the GM may tear out its
  non-private pages into the bin."
- D3: "an unattached player journal (characterId absent) belongs to the player's earliest character in the campaign
  that is not departed and has no journal; the first write after that stores characterId. The current journal is the
  active character's, else the newest non-departed character's, else an unattached one (created on first write)."
- B7: default pages GM 'Session 1', 'Rumors & hooks', 'Loot & debts', 'Future log'; player 'Session 1', 'People we
  met', 'Clues & secrets', 'My goals'. "New and default pages get the default visibility (A4)."
- D6: "the default 'Session 1' page links to the live or newest visible session when one exists".
- A1 / A2: no PIN control, no 'Writing as' switcher.

## What landed

### Data (convex/tables/notes.ts, composed in convex/schema.ts)

| Table | Indexes |
|---|---|
| `journals` | `by_campaign_user` [campaignId, userId], `by_character` [characterId] |
| `journalPages` | `by_journal_binned` [journalId, binnedAt], `by_campaign_visibility_binned` [campaignId, visibility, binnedAt], `by_binned` [binnedAt] |
| `journalPageRecipients` | `by_page_user` [pageId, userId], `by_campaign_user` [campaignId, userId] |
| `journalEntries` | `by_page_order` [pageId, order], `by_journal_open` [journalId, open], `by_campaign` [campaignId]; search index `search_text` (text; filter journalId) |

Fields are the plan's data model, all typed (convex/lib/validators/notes.ts).

**Deviation:** the plan also listed `by_campaign` on `journals`, `journalPages` and `journalPageRecipients`. Each is a
field-prefix of a longer campaign index on the same table (CD15; the schema guard fails on it), so it is left out and
the purge reads the longer index by its `campaignId` prefix.

### Validators (convex/lib/validators/notes.ts)

Value lists, caps, default pages, mention tokens and the open-thread rule come from N1's pure domain
(`src/lib/domain/notes`), so there is one definition: `ENTRY_KINDS`, `ENTRY_STATES`, `PAGE_KINDS`, `PAGE_VISIBILITIES`
(= N1 `VISIBILITIES`), `MAX_PAGES` 200, `MAX_PAGE_ENTRIES` 300, `MAX_JOURNAL_ENTRIES` 5000, `TITLE_MAX` 80, `TEXT_MAX`
500, `MAX_MENTIONS` 10, `TAPE_COUNT`, `BIN_TTL_MS`, `journalTemplate(isGm)` (= N1 `defaultPages`), `isOpenThread` (N1),
the D7 token re-exports (`MENTION_TOKEN_RE`, `formatToken`, `mentionIds`, `countMentions`). N0 adds the Convex
validators `pageKindValidator`, `entryKindValidator`, `entryStateValidator`, `pageVisibilityValidator`,
`pageRefValidator` (page id or `{ template: number }`), the field objects and `journalValidator` /
`journalPageValidator`.

### Errors (src/lib/errors/notes.ts)

NOTE_PAGE_NOT_FOUND, NOTE_ENTRY_NOT_FOUND, NOTE_PAGE_LIMIT, NOTE_PAGE_FULL, NOTE_JOURNAL_FULL, NOTE_NOTHING_TO_MIGRATE,
NOTE_VISIBILITY_INVALID, NOTE_RECIPIENT_INVALID, NOTE_FORBIDDEN_ACTION, NOTE_JOURNAL_CLOSED, NOTE_SESSION_INVALID,
NOTE_MENTION_INVALID, NOTE_NOT_BINNED. Combined in app-error.ts and convex-errors.ts. No PIN code.

### Authorization (convex/lib/permissions.ts, convex/lib/journalState.ts)

- `Resource` gains `{ type: "journalPage"; campaign; journal; page }`. `permissionFor` hands it to
  `journalPagePermission`: `owner` for the page owner, `view` per N1's `canReadPage` (the single copy of the table),
  else null. No role default (the GM is never owner of a player's page) and no grants. A caller without a campaign role
  reads nothing, not even their own pages. Torn-out pages: the owner; the GM who tore it out, while that GM would read it
  unbinned (N1 `canRestore`). Mismatched campaign / journal: null.
- `campaignRoleOf(ctx, userId, campaign)`: campaignRole by id (membership first, the users row only for the invite).
- `departed(ctx, campaign, journal)` (journalState.ts): D1; the GM's journal never departs; two reads for a member,
  three for a removed player (asserted by a read-count test), four only for a pending invitee with a character. No write.

### Helpers (convex/lib/notes.ts)

`notesRole`, `currentJournal`, `ensureJournal`, `defaultSessionId`, `pageAccess`, `can`, `assertAction`,
`entryAccess`, `findPage`, `resolvePage`, `insertPage`, `bumpJournal`, `bumpCounts`, `deletePageRows`. The action flags
come from N1's `pageActions` / `entryActions`. Contract in the file's header table and in the N0 report.

### Purge (convex/cleanup.ts)

Four bounded steps: entries, recipients, pages (torn-out ones too), journals. The schema guard lists the four tables as
campaign-scoped and `journalPages` in a new `ALSO_RETENTION` note (the N7 bin cron).

### Route shell

`src/app/(gm)/campaigns/[campaignId]/notes/page.tsx` (static route; it wins over the `[section]` placeholder),
`error.tsx`, `notes.css`; `src/components/notes/slots.ts` and twelve stubs, each mounted in its own error boundary.
URL state: `?view=page|threads|shared-players|shared-gm|journal|bin&page=<id or template-<i>>&journal=<id>`. Title
`Notes · <campaign>`. The page loads the board's Caveat face with `next/font` (the root layout has no Caveat).

### Board shots (scripts/board-shots.mjs)

`notes:empty`, `notes:page`, `notes:threads`, `notes:search`, `notes:player`, `notes:tear` (1440 only), saved as
`test-results/visual/board/notes-<region>-1440.png`.

## Visual check

| Region | App shot | Board shot | Verdict |
|---|---|---|---|
| Hero | `test-results/visual/D11-N0/shell-1440.png` | `notes-empty-1440.png` | Matches type and spacing (campaign line, Cinzel 44 px H1, sub line, pill actions). Deviations: no 'Writing as' row and no PIN button (A1, A2); 'Download my journal' added (Q9); no banner image (the campaign shell owns the chrome, as on Sessions). |
| Index column | same | `notes-empty-1440.png` | 300 px column, search, three groups with '＋', Quick keys card as the board. Added (not on the board, board tokens): Shared tabs, Players’ journals (GM), Past journals, Torn-out pages. Groups are empty in the stub (N2 fills them). |
| Paper | same | `notes-page-1440.png` | Dotted paper, margin line, washi tape, toolbar chips, KEY legend as the board. The stub has no rows (N3). |
| Threads view | `threads-1440.png` | `notes-threads-1440.png` | Tape, intro line and empty line as the board's empty state. |
| 390 | `shell-390.png`, `threads-390.png` | none (board has no phone layout) | One column, no horizontal scroll, 44 px targets (tested). The 'Pages' disclosure is N2's. |

Disabled stub controls (Migrate, Sharing chip, Tear out, '＋', Download) are dimmed until their tracers wire them.

## Evidence

- `tests/convex/permissions.test.ts`: 21 tests (8 before + 13 D11): every visibility x {owner, GM, chosen, not
  chosen, outsider} x {present, removed, dead, retired, away, rejoined} for player and GM pages; chosen pages; D4; a
  rejoin and a status back to 'active'; character moved or deleted; leaving; torn-out pages incl. the binner losing
  access; unattached journals; mismatches; grants give nothing.
- `tests/convex/notes-lib.test.ts`: 16 tests (journal creation for GM and player, session link, attachment, new journal
  after a death, active over away, grant-only NOT_FOUND, departed read count, template refs, the action table, D2,
  the bin, NOTE_PAGE_LIMIT, counters, deletePageRows, cross-campaign pages).
- `tests/convex/cleanup.test.ts`: seeds all four tables; a new purge test with more entries than one batch.
- `tests/convex/schema-guard.test.ts`: the four tables classified; ALSO_RETENTION check.
- `tests/e2e/notes-shell.spec.ts`: 3 tests + 1 @visual (GM, player, outsider not found, 390 px).

## QUESTIONS / notes for later tracers

- `pageAccess`'s `isGm` comes from `campaignRole` (the role half of permissionFor), not `ctx.permission`, so wrappers
  only need `need: "view"`; a user who reaches the campaign through a grant alone has no journal (NOT_FOUND).
- Writes on a torn-out page (other than restore) answer NOTE_FORBIDDEN_ACTION.
- `ensureJournal` links the default 'Session 1' itself (D6), so N2 does not need to.
