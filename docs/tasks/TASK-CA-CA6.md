# TASK CA6: Map UI - the Hand (loadout cards with Use, greyed exhausted cards, recall from the vault, choices dialog)

Plan `.omc/plans/combat-actions.yaml`, tracer CA6 (wave 5, depends on CA4 and CA5). Server API: `docs/tasks/TASK-CA-CA4.md`.
Status: Review.

## What landed

| File | What |
|------|------|
| `src/components/combat-map/actions/hand/index.tsx` | `Hand` (player column, the first card / the first tab of the phone sheet), `GmHand` (GM column: the selected PC's Hand with the "Play for this character" switch, and the card uses waiting for the GM), `HandBody` (loadout, result, waiting uses, vault). |
| `hand/face.tsx` | `HandCardFace`: the board's hand card (`hc-face`) made compact: domain head with level, art (`next/image`) with the blue Recall badge, cost and limit badges, four lines of text, footer with SC1's `CardMore` and the card's action. Exhausted: greyed, turned 4°, ribbon `Used · Back after a rest`, accessible name `<name>, used: <label>` (as CA7 on the sheet). `cardDisplay` builds SC1's `CardDialogCard` from the SRD leaf modules. |
| `hand/model.ts` | Pure model: `formFor(use)` (what a use asks first, read from the same effect table the server runs), `needsDialog`, `initialValues`, `formProblem`, `choicesOf` (the flat `{id, value}` list of `parseChoices`), `answerChoices` (the server's after-the-roll asks), `cardBadges`, `limitLabel`, `costLabel`, `recallLabel`, `fitsSide`, `playableUses`. |
| `hand/dialog.tsx` | `UseDialog` (spell list for a grimoire, targets, numbers, cost options, situations to confirm, optional parts, picked / allies / follow-up creatures, weapon, trait, the GM's Difficulty) and `AfterRollDialog` (a `choose` step or a damage split the server asked for). Both on the brand `Modal` (native `<dialog>`). |
| `hand/result.tsx` | `CardResult` in CA5's result view: own dice and total, damage totals, Hit / Miss / Defeated, prompts (manual steps with the card's words and Done; moves, PC reaction rolls, damage to PCs listed); out of range: "waits for the GM". |
| `hand/use-card.ts` | `useCardActions` (one `combatCards.useCard` per click via `useIntent`; `needsChoice` kept and `answer` resubmits; the only place CA4b's stored-dice change touches) and `useRecall` (`characters.moveCard` with an optimistic update on `combatCards.hand`). |
| `hand/hand.css` | The Hand's styles (board card palette; two cards a row in the 360 px column; a horizontal snap strip at ≤760 px; the GM switch). |
| `actions/attack/memory.tsx` | `PanelMemoryProvider` / `usePanelMemory`: state above the layout switch. |
| `actions/attack/index.tsx` | The Attack bar's last result lives in the panel memory (user answer 2026-10-22). |
| `actions/index.tsx` | `ActionsPanel` wraps the layout switch in `PanelMemoryProvider`; the phone sheet opens on Hand by default; the page's `Resolutions` slot now renders `GmHand` (own boundary) above CA5's Resolutions. |
| `tests/unit/combat-hand.test.tsx` | 17 tests (model, the Hand with Convex mocked, the result view, the panel memory across the layout switch). |
| `tests/e2e/combat-cards.spec.ts` | 4 two-browser specs (player Bolt Beacon; once-per-rest card and rest; GM at 1440 and 390), axe on each view. |
| `tests/e2e/visual/CA-CA6.spec.ts` | Shots at 1440 and 390 (`test-results/visual/CA-CA6/`). |

No server file, schema or validator changed.

## User answers implemented (quoted from the plan)

- **U1** "Players never see an enemy's HP, Stress or thresholds. They only learn hit or miss." The Hand reads only
  `combatCards.hand` (no enemy data), `combatCards.useCard`'s result (own dice, Hit / Miss / Defeated, prompts made of card
  text), `combatCards.pending` (names and bands) and `rests.current`. Unit and e2e tests match the result against
  `HP|Stress|Difficulty|threshold|Minor|Major|Severe`.
- **Q3** one `card:<id>` key greys the card (the server's `state: "exhausted"` and `resetLabel`); a used grimoire spell
  is greyed in the spell list with its own reset label.
- **Q1** out of range: the use waits ("waits for the GM; nothing is rolled or paid"), the player sees it under the Hand;
  the GM answers it in "Cards: your call" (Allow / Decline, `combatCards.sanction`). CA5's Resolutions list only attack
  sanctions (`combatRequests.mine` has no card ones), so this list was needed for a card use to go anywhere.
- **Q9** manual steps: the card's words and a Done button (the server already logged them as `feature` rows).
- **Q11** phone: the Hand is the first tab of the bottom sheet, now its default tab, with a horizontal card strip.
- **User answer 2026-10-22 (GM)**: "The cards will be greyed out by default, the GM will need to hit a slider to allow him
  to play them." Selecting a PC token opens `Hand · <name>` in the GM column, greyed with no Use / Recall and the note
  "Turn on “Play for this character” …". The switch (`role="switch"`) is per character and resets when another PC
  token is selected. On: Use and Recall work; `useCard` runs with the GM as actor and the character's id on the rows
  (CA4). The Hand stays while the GM selects other tokens (state adjusted during render, no effect; rule 13) and closes
  with ✕. The GM picks targets in the dialog (GM clicks on the map select tokens, they don't pick targets).
- **User answer 2026-10-22 (layout)**: "keep the last attack result when the layout switches across 760px": the Attack
  bar's last result and the Hand's last card result live in `PanelMemoryProvider` above the switch; unit test.
- **Orchestrator note**: 'More' on every map card is SC1's `CardMore` / `CardDialog`.

## Rules (quoted, printed pages)

- **R6** (CB p.101): "Some domain cards have an exhaustion limit that restricts how often you can use that card (for
  example, once per long rest). If you use that card, you'll need a way to remember that it's temporarily unavailable.
  You might choose to … turn it on its side". The map greys and turns the card, with the reset label in words.
- **R7** (CB p.101, "Swapping Cards"): "When you start a rest, you can swap cards between your loadout and your vault. …
  When you're not resting, you can still swap cards into your loadout, but it's stressful to do so! To immediately switch
  a card from your vault to your loadout, mark a number of Stress equal to the vaulted card's Recall Cost". CB p.26:
  "You can normally only move an inactive card from your vault to your loadout during downtime, but you can mark a number
  of Stress equal to a card's Recall Cost to swap it immediately." The vault shows `Recall: N Stress`, `Recall: free`
  while the GM's rest is open (`rests.current`) or for a 0-cost card; `characters.moveCard` with `duringRest`. The
  loadout holds five ("a maximum of five active domain cards in your loadout"): Recall is disabled when it is full.

## How it works

- **Use.** A card shows Use when it has an action use (reactions, riders and automatic parts say so in a badge; passive
  cards have no button). Use reads the card's first ready action use from the effect table; `needsDialog` opens the dialog
  only for a choice: more than one spell, a NumberChoice, an `either` cost, a situation, an optional part, `picked` /
  `allies` / `followUp` creatures, a `weapon: "either"`, a trait list, the GM's Difficulty, or targets other than one
  enemy already picked on the map. Otherwise it fires at once with the picked enemy (`seenTargets`, the latest one).
- **Dialog.** Targets list the creatures that fit the card's side (enemies; allies = other PCs and ally tokens; self or
  allies; any), capped at the card's count. The Use button names what is missing ("Pick a target.", "Confirm the card's
  situation."). One `useCard` per click; "Using…" while pending (rule 12).
- **After the roll.** `needsChoice` opens `AfterRollDialog` (choose options, damage split per creature) and
  `useCardActions.answer` resubmits the same request with those choices. CA4b will make the second call reuse the stored
  dice; only `answer` changes.
- **Recall.** Optimistic: the card moves to the loadout at once; a refusal puts it back and shows the message.
- **Rule 11.** The Hand is inside CA5's `PartBoundary` in the player column and in its own `PartBoundary` in the GM column.

## Visual check (1440 and 390)

The board has no Hand. The faces were compared with Party.dc.html's hand cards (`hc-face`, as the sheet's felt table and
SC1's dialog draw them): domain-coloured head in Cinzel caps with the level disc, art with the blue Recall disc, parchment
body with gold rules, underlined Cinzel 'More'. The column was compared with `combat:player-day`
(`node scripts/board-shots.mjs combat:player-day`): same 360 px `cm-card`, Cinzel `cm-h`, letter-spaced labels. Shots in
`test-results/visual/CA-CA6/`: `player-page-1440`, `hand-1440`, `hand-result-1440`, `dialog-illiat-1440|390`,
`hand-exhausted-1440|390`, `sheet-hand-390`, `gm-hand-locked-1440|390`, `gm-hand-playing-1440|390`, `gm-page-1440`.
Use is a dark pill with the domain colour as its rim (Splendor's gold fill failed axe colour contrast).

## Checks

- `pnpm typecheck`, eslint on the changed files: clean.
- `vitest run tests/unit/combat-hand.test.tsx`: 17 passed. Full `vitest --maxWorkers=4 --testTimeout=60000`: 270 files, 6945 passed, 1 expected fail.
- e2e (`E2E_REUSE_SERVERS=1`, ports 3166 / 3444): `combat-cards.spec.ts` 4 passed (axe: no serious or critical
  violation in the player column, the GM Hand and the dialog); `visual/CA-CA6.spec.ts` 2 passed; every
  `tests/e2e/*combat-*.spec.ts` (CA5's combat-attack included): 24 passed.

## Notes and QUESTIONS

1. **GM recall logging.** `characters.moveCard` already accepts the GM (`loadCharacter(…, "edit")`), so Recall works for
   the GM with the switch on, but moveCard writes no actionLog row; "logged as the GM for that character" for a recall
   lands with CA4b's moveCard change. Card uses are logged with the GM as actor today (CA4).
2. **A player selecting another PC's token** keeps seeing their own Hand (never the other PC's cards). Should the Hand
   hide altogether while another PC's token is selected?
3. **Dialog targets vs map rings.** Picks made in the dialog are the dialog's own; they don't move CA5's target rings
   (`toggleExtraTarget` is unused). Fine, or should multi-target picks in the dialog also ring the tokens on the map?
4. **Roll options for card rolls** (Experiences, advantage, help) are not in the Use dialog yet; the server accepts them
   (`roll`). Add them, as in the Attack bar?
5. **Badges** show the single action use's costs and limit; a grimoire shows "N spells" (each spell's state is in the
   dialog). Optional costs (Forceful Push's Hope) are not badged.
