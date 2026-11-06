# TASK-CONFIG-U2: Campaign settings, House rules

Plan `.omc/plans/config.yaml`, wave 3, tracer U2; briefs `.omc/plans/config-briefs.md` (U1-U5 block, "User answers
2026-11-04" Q10 b, "Questions 2026-11-05": defaults taken, none touch this section); bead dcm-jh6d.16. Design
`reference/designs/config/Settings.dc.html` (`.s-rules`). Mode: add. UI only; no server change, no codegen.

## What landed

`src/components/config/sections/rules/index.tsx` fills S1's `HouseRulesSection` slot:

- **Hint** (board): 'The Lorekeeper quotes these as table rulings before it searches anywhere else.'
- **Campaign options** (list 'Campaign options'): every `optionsFor(campaign.frameId)` row as a `cfg-sw` switch with
  its label, description and the tag 'Campaign option' (the board's `em` line). A click sends one option to
  `campaigns.setOption` (unchanged) with an optimistic update on `campaigns.get`'s `options`. A refusal rolls back
  and shows inline. This is the same field the dashboard's Campaign Rules panel writes (Q10 b), so the two agree; the
  e2e test checks it.
- **Table rulings** (`rules/rulings.tsx`, list 'Table rulings'): `lorekeeperRulings.list`, newest first. Each row
  shows title, text and its origin line (`rulingOrigin` in `rules/text.ts`):
  - 'Pinned from the Lorekeeper · Session N' (or without the session) when the ruling has `fromMessageId`;
  - 'Added here' (or 'Added here · Session N') when it doesn't.
  - Derived on the client from `fromMessageId` / `sessionN`; the server's `meta` ('Pinned by the GM …') is unused here.
- **Edit**: an inline form in the row (Title, Ruling). Only changed fields go to `lorekeeperRulings.update`,
  optimistic via the Lorekeeper sidebar's `updateRulingLocally`. Nothing changed = no call.
- **Unpin**: an inline confirm ('Unpin?' with glass danger Unpin / cancel Cancel), then `lorekeeperRulings.unpin`,
  optimistic via `unpinLocally`.
- **Add a house rule**: an inline form; `lorekeeperRulings.pin` with trimmed title and text, no `fromMessageId` and no
  session. The form shows a server refusal and stays open.
- **Limits**: inputs carry `maxLength` 80 / 600 (`LOREKEEPER_LIMITS`, what the server enforces), with a 'n / 600'
  counter. At 50 rulings Add is disabled and `LOREKEEPER_RULING_LIMIT`'s text shows; if the server refuses anyway, the
  form shows the same text.
- Empty: 'No table rulings yet. Pin one from a Lorekeeper answer, or add a house rule here.' Loading: 'Loading …'.

## Decisions

- **No switch on rulings.** The board draws one, but a ruling has no on/off state (it is pinned or not), so rows get
  Edit and Unpin instead. A rule switch registry is dcm-bxp.134 (later plan); 'Massive damage' / 'Action tracker'
  are not built.
- **Inline forms, not a modal.** The panel is a native modal `<dialog>`; inline forms avoid stacking a second modal.
  Escape inside a form cancels the form and is stopped, so it does not close the panel (as U3's row menu does).
- **Pinning here never ties to a session**, even during a live one: 'Added here' marks a hand-written ruling.
- Buttons are glass (`glassButtonClass`): Add neutral with the board's dashed `.addb` border, Edit neutral, Unpin
  danger, Cancel / Save / Add rule cancel / confirm.

## Files

| File | Change |
|---|---|
| `src/components/config/sections/rules/index.tsx` | The section (was S1's stub): hint, campaign options, rulings. |
| `src/components/config/sections/rules/rulings.tsx` | New: rulings list, inline add / edit form, inline unpin confirm. |
| `src/components/config/sections/rules/text.ts` | New: board text and `rulingOrigin`. |
| `src/components/config/sections/rules/rules.css` | New: list, rule row, form, add button. |
| `tests/unit/config/rules.test.tsx` | New (13): hint, frame options, setOption intent + optimistic + rollback, origin lines, add / edit / unpin intents, limits, Escape, empty / loading. |
| `tests/e2e/config-rules.spec.ts` | New: GM switches an option (dashboard panel follows), adds and edits a house rule, finds it in the Lorekeeper's Table rulings card, unpins it from the settings; axe; 1440 and 390 shots. |
| `docs/tasks/TASK-CONFIG-U2.md` | This file. |

## Out of owns

None. Reads only (imports, unchanged): `src/components/lorekeeper/side/optimistic.ts`,
`convex/lib/validators/lorekeeper.ts`, `src/lib/errors/lorekeeper.ts`, `src/lib/frames/options.ts`.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/config.yaml U2`: OK (all owned).
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/config` 6 files / 65 tests pass. Full suite: 540 files,
  11789 passed, 1 expected fail, 1 todo.
- e2e: `config-rules.spec.ts` passes on ports 3949 / 4049, `--workers=1`, managed servers (after `pnpm e2e:setup` in
  the worktree).

## Shots

`test-results/config-u2/` and `/mnt/c/Users/Petar/Downloads/dcm-screens/config-u2/`: `gm-rules-1440`,
`gm-rules-edit-1440`, `gm-lorekeeper-rulings-1440`, `gm-rules-390`.
