# TASK-RULES-RU: House rules UI (rule rows, lock, players read-only, Manual notes in the feed)

Plan `.omc/plans/rule-switches.yaml`, tracer RU (epic dcm-jh6d part A). Builds on RS0 (`docs/tasks/TASK-RULES-RS0.md`):
`api.ruleSettings.get` → `{ modes, locked, canEdit }`, `api.ruleSettings.set({ change: { key, value } })`, the registry
in `src/lib/rules`. User answers: `.omc/plans/rule-switches-briefs.md` (Q17 a, Q18 a, and the 2026-11-05 answers).

## What landed

| Piece | File |
|---|---|
| Rule rows: groups, rows, mode picker, switch, stepper, read-only rows | `src/components/config/sections/rules/rule-list.tsx` |
| Pure helpers: area order and labels, page tags, mode text, `WIRED_RULES`, optimistic `applyRuleChange` | `src/components/config/sections/rules/model.ts` |
| House rules section: rule rows, then today's campaign options (locked too, Q17 a), then table rulings | `src/components/config/sections/rules/index.tsx` |
| Players: 'House rules' in the Preferences popover, read-only (Q18 a) | `src/components/config/prefs/house-rules.tsx` |
| 'Manual' tag + rule title on kind `rule` rows | `src/components/party/dice/roll-feed.tsx`, `src/components/combat-map/hud/feed/**` |
| `feed.list` returns `ruleId` (outside RU's owns, one optional field) | `convex/feed.ts` |

## Rows

- Groups: native `<details>` per area, Optional rules first (open), then the 13 areas of the registry list; each
  summary shows the rule count and how many are off their default ("2 changed").
- In an area: rules with a choice first, Book-only rows after, otherwise registry order.
- Switch rule (`switch` / `appRule`): title, what the app does, page tag ('Core Rulebook p.105', 'Hope & Fear p.176'),
  a radio group in the segmented control's look (Book / variants / Manual). A mode with `notInBooks` carries
  'not in the books' (in its accessible name too). A `param` (darkness 'Difficulty raised by', no upper limit) shows a
  − / + stepper when the mode uses it.
- Optional rule: `role=switch` with 'Optional rule · Core Rulebook p.91'; Spotlight Tracker shows 'Tokens per PC'
  (1–6) when on. Shared domain cards: Allow / Warn / Refuse (Refuse tagged not in the books).
- Book-only row: title, what the app does, 'Book · Core Rulebook p.90', no control. No `aria-readonly`: ARIA allows it
  only on widget roles, and axe flags it on a list item; the row simply has no control.
- X2 while X1 is Manual: read-only, 'Needs the death move prompt'.

## Engine wiring: `WIRED_RULES` (model.ts)

Only rules whose engine wiring is merged into `rebuild` get a control. Every other settable rule shows its current mode
read-only with 'Coming soon: the app doesn't follow this switch yet.', so the GM never picks a mode the engine ignores.
At RU's branch point that is F2, T2, T4 (RR), W2, W4–W7 (RF) and W1 (RW). **Each rule tracer, or the orchestrator when
merging it, adds its rule ids to `WIRED_RULES`.** Open question to the user: see the RU report.

## Lock, errors, permissions

- `locked` (a session is live): every radio, switch and stepper is disabled and the hint 'Rule switches change between
  sessions. End the session to change them.' shows above the groups; the campaign options switches are disabled too.
- Writes: one field per call, optimistic on `ruleSettings.get` (`applyRuleChange` also turns X2 Manual with X1); a
  refusal rolls back and shows `errorMessage` (RULES_LOCKED's text).
- `canEdit` false (archived, the app owner's read-only view): the GM sees the rows as players do.
- Players: Preferences popover → 'House rules' (a disclosure, rows rendered only while open), the modes as text, no
  controls. The GM and co-GMs don't get the item (Campaign settings has the rows).

## Feed

- Roll Feed (dashboard): a kind `rule` row gets a purple 'Manual' tag and the rule's title before the summary. Players
  never receive these rows (GM-only, RS0).
- HUD 'Just now': same tag (`ruleNoteTag` in `hud/feed/model.ts`). The HUD shows 'Just now' to players only, so today
  no GM sees it there; the GM's HUD Resolutions column (`hud/queue/**`, not RU's) lists combat rows only.

## Tests

- `tests/unit/config/rule-switches.test.tsx`: grouping and order, page tags, GM edit (optimistic, one field), not in the
  books tag, optional switch + stepper, darkness without an upper limit, Book-only row, Coming soon, X2 blocked,
  refusal rollback, locked (campaign options too), `canEdit` false, players read-only from the popover.
- `tests/unit/config/rule-notes-feed.test.tsx`: `ruleNoteTag`, Roll Feed and HUD feed tags.
- `tests/e2e/rule-switches-ui.spec.ts` (outside RU's owns; RZ may fold it in): GM picks Manual for T4, the note in the
  feed, the player's read-only list, the lock; axe; shots at 1440 / 1024 / 390 in `test-results/rule-switches-ru/`.
