# TASK-CONFIG-U5: Campaign settings, Sessions

Plan `.omc/plans/config.yaml`, wave 3, tracer U5; briefs `.omc/plans/config-briefs.md` (U1-U5 block, "User answers
2026-11-04": Q4 d, Q7 a, Q9 a; "Questions 2026-11-05": defaults taken); bead dcm-jh6d.19. Design
`reference/designs/config/Settings.dc.html` (`.s-session`). Mode: add. UI only; no server change, no codegen.

## What landed

`src/components/config/sections/sessions/index.tsx` fills S1's `SessionsSection` slot. The rows use the shared
`cfg-row` / `cfg-seg` / `cfg-sw` classes; the row components and the board's text are in `rows.tsx`
(`SESSIONS_TEXT`, `ChoiceRow`, `SwitchRow`, `RowText`).

| Row (board text) | Hint | Control | Setting | Applied by |
|---|---|---|---|---|
| GM Fear at the start of a session | Fear carries over between sessions by default. | segmented Carry over / Reset to number of PCs | `fearAtStart` (`carry` / `pcs`) | R3 (`sessions.start`, merged) |
| A new session opens on | - | segmented Journal / Combat Map | `sessionOpensOn` (`journal` / `combatMap`) | JO1 |
| Write the session log from the Combat Map | Rolls, hits, Fear spent and defeats, with times. | switch | `autoSessionLog` | JO2 |
| Archive this campaign | Keeps everything read-only. You can restore it later. | `Archive…` (glass danger, sm), **disabled** | - | S3 fills `archive.tsx` |

- Each row reads the live `campaigns.get` settings (`props.campaign`) and writes `campaignSettings.set` (S2), one
  field per call, with an optimistic update on `campaigns.get` (rule 12), the same update U1 and U4 use. Clicking the
  current segment writes nothing. A refused save rolls back and shows its message in the polite live line under the
  rows.
- **No 'Day and night clock' row** (Q4 d): the clock stays manual, and a row with one choice is not a setting. Time is
  still changed where it is today (End day, Day / Dim / Night, Witherwild weeks).
- **Archive** (`archive.tsx`, S3's slot `SessionsArchive`, props `SettingsSectionProps`): the board's danger row (20 px
  gap, ember top rule, as inline style because U5 owns no CSS file) with the button disabled. It renders only for the
  creator (`campaign.isCreator`, Q7 a: only the creator archives); a co-GM sees no row. S3 adds the confirm, the
  server call and the archived state.

## Decisions

- The segmented buttons are glass neutral (`glassButtonClass`), like U1 / U4, not the board's flat `.seg2`.
- No colocated CSS: U5's owns list none, and the shared classes cover every row. The error line and the danger row
  use small inline styles.
- The Archive stub is creator-only now, so S3 doesn't need to change who sees it.

## Files

| File | Change |
|---|---|
| `src/components/config/sections/sessions/index.tsx` | The section (was S1's stub). |
| `src/components/config/sections/sessions/rows.tsx` | Board text and the choice / switch row components. |
| `src/components/config/sections/sessions/archive.tsx` | S3's slot: the disabled Archive row, creator only. |
| `tests/unit/config/sessions.test.tsx` | Rows, hints and defaults; no clock row; each row's one-field write and optimistic update; same choice writes nothing; rollback and inline error; Archive disabled for the creator, absent for a co-GM. |

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/config.yaml U5`: OK.
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/config` 80 passed; full suite 545 files, 11829 passed,
  1 expected fail, 1 todo.
- e2e (throwaway spec, ports 3957 / 4057, `--workers=1`, managed servers after `pnpm e2e:setup`): passed, axe clean.

## Shots

A throwaway e2e spec (not committed; U5 owns no e2e file) opened `?settings=sessions` as the GM, ran axe on the panel,
changed all three rows and polled the player's `campaigns.get`. Shots in `/mnt/c/Users/Petar/Downloads/dcm-screens/config-u5/`:
`gm-sessions-1440`, `gm-sessions-changed-1440`, `gm-sessions-390`.
