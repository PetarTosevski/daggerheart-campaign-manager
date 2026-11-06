# TASK-CONFIG-U4: Campaign settings, Lorekeeper

Plan `.omc/plans/config.yaml`, wave 3, tracer U4; briefs `.omc/plans/config-briefs.md` (U1-U5 block, "User answers
2026-11-04", "Questions 2026-11-05": defaults taken); bead dcm-jh6d.18. Design
`reference/designs/config/Settings.dc.html` (`.s-lore`). Mode: add. UI only. No server change and no codegen. The
server side is L1's (`docs/tasks/TASK-CONFIG-L1.md`).

## What landed

`src/components/config/sections/lorekeeper/index.tsx` fills S1's `LorekeeperSection` slot. It uses the shared `cfg-*`
row classes, plus `lorekeeper.css` for the pill, the lock label and the error line.

| Row (board text) | Hint | Control | Reads | Writes |
|---|---|---|---|---|
| 'Sources it may search' label | - | - | - | - |
| Every library book (title) | 'Indexed' / 'Off' pill | switch | `lorekeeperLibrary.list` | `lorekeeperLibrary.setEnabled` (reused, same optimistic update as the Library card) |
| Your <campaign> notes (the House rules (notes) book) | Your notes pages shared with everyone | switch | same | same |
| *(slot)* `LorekeeperCampaignBooks` in `books.tsx` | - | renders nothing; AU8 fills it (Q24 b) | - | - |
| Table rulings & house rules | This page | disabled switch, on, lock 'Always on' | - | - (no setting) |
| GM-only notes | Never shown to players | disabled switch, off, lock 'Always off' | - | - (no setting) |
| Search the internet when the books don’t say | Results are marked “From the internet · unofficial”. | switch | `campaigns.get` `settings.lorekeeperWeb` | `campaignSettings.set` |
| Who can ask | - | segmented Everyone / GM only (glass neutral, `aria-pressed`) | `settings.lorekeeperAsk` | `campaignSettings.set` |
| *(slot)* `LorekeeperLimits` in `limits.tsx` | - | renders nothing; AU3 fills it (Q21 changed, N10) | - | - |

- Each change sends one field with an optimistic update (rule 12). If the save is refused, the change rolls back and
  the message shows in the polite line under the rows. Clicking the segment that is already chosen writes nothing.
- The book rows show 'Loading …' (`role="status"`) until the library loads. The settings rows show at once.

## Composer (outside owns, approved by the orchestrator)

L1 left the client to U4. These two edits are minimal:

- `src/components/lorekeeper/chat/chat.tsx` also subscribes to `lorekeeper.access`.
  - When `canAsk` is false, the composer's disabled reason is `configMessages.LOREKEEPER_GM_ONLY` ("Only the GM can ask
    the Lorekeeper in this campaign."). This uses the existing blocked notice, and the question box is disabled.
    'Not set up' still comes first.
  - `webAllowed` is passed to the composer.
  - `lorekeeper.available` stays: the app bar, the drawer and `tests/unit/lorekeeper-ui/books-and-setup.test.tsx` read
    it.
- `src/components/lorekeeper/composer/composer.tsx` gets a new optional prop, `webAllowed` (default true). When it is
  false, the 'If the books don’t say' label and the Internet search toggle are hidden.
- The drawer (`drawer/panel.tsx`) mounts the same `LorekeeperChat` → `ChatView`, so it picks up both changes without
  an edit.

## Decisions

- **The notes row.** The board's "Your Witherwild notes · Uploaded by you" is the House rules (notes) pseudo-book
  (briefs map, Q24). It is named "Your <campaign name> notes". "Uploaded by you" is not true for notes pages, so the
  hint reads "Your notes pages shared with everyone". The row is left out of the book list.
- **The 'Indexed' pill** replaces the board's hint text under each book. Like the Library card, it shows 'Off' while
  the book is switched off.
- **Locked rows** follow U1's adversary-stats row: a disabled switch and a lock with 'Always on' / 'Always off'.

## Files

| File | Change |
|---|---|
| `src/components/config/sections/lorekeeper/index.tsx` | The section (was S1's stub). |
| `src/components/config/sections/lorekeeper/books.tsx` | Empty slot for AU8. |
| `src/components/config/sections/lorekeeper/limits.tsx` | Empty slot for AU3. |
| `src/components/config/sections/lorekeeper/lorekeeper.css` | Pill, lock, error line. |
| `tests/unit/config/lorekeeper.test.tsx` | Covers: book rows and pills; the notes row; the locked rows (they write nothing); `setEnabled` with its optimistic update; the web and who-can-ask writes (one field each, and the current choice writes nothing); rollback with the inline error; loading; the composer hiding its toggle when `webAllowed` is false. |
| `tests/e2e/config-lorekeeper.spec.ts` | GM and player, Lorekeeper page. The GM sets GM only, and the player's composer shows the GM-only line, live, with the box disabled. The GM turns internet off, and the toggle goes away for both. The settings are back to their defaults at the end. axe; 1440 and 390 shots. |
| `src/components/lorekeeper/chat/chat.tsx`, `src/components/lorekeeper/composer/composer.tsx` | **Outside owns** (approved), as above. |

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/config/lorekeeper.test.tsx` and `tests/unit/lorekeeper-ui` pass. Full suite: 542 files, 11801 passed, 1 expected fail, 1 todo.
- e2e: `config-lorekeeper.spec.ts` passes on ports 3953 / 4053 with `--workers=1` and managed servers, after
  `pnpm e2e:setup`.

## Shots

`test-results/config-u4/` and `/mnt/c/Users/Petar/Downloads/dcm-screens/config-u4/`: `gm-lorekeeper-1440`,
`player-gm-only-1440`, `gm-lorekeeper-changed-1440`, `gm-lorekeeper-390`.

## Questions used

Q21 and Q24 are Part B (the slots only). No new question.
