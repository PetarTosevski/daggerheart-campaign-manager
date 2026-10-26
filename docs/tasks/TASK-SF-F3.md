# TASK-SF-F3: Character sheet: Class Features chips, Lunar Phases section, New Moon negates Minor damage

Status: Review. Plan: `.omc/plans/session-features.yaml`, tracer F3 (wave 2, depends on F0). Bead: `dcm-bxp.58`.
Rules: K2, K3, K4, U6, U7, E4-E6 in the plan header.

## Book rules implemented (printed pages, re-checked through TASK-SF-F0's extraction)
- **K4 Lunar Phases** (Moon Witch mastery, HF p.17): "At the beginning of each session, roll a d6 and place it on this
  card. You gain the matching effect until the end of session. 1 New: Spend a Hope to negate Minor damage. 2-3 Waxing:
  +2 to damage rolls. 4 Full: +3 to damage thresholds. 5-6 Waning: +1 to Evasion. Once per rest, you can spend a Hope to
  increase the value of this die by one. If you increase the value of a 6, it becomes a 1." Moon is a Witch subclass
  (HF p.16), so Lunar Phases answers only with the campaign's Hope & Fear option.
- **K2 Slayer** (CB p.48): "You can store a number of Slayer Dice equal to your Proficiency." (the chip's n/Proficiency)
- **K3 Know the Tide** (CB p.77): "You can hold a number of tokens equal to your level." (the chip's n/level)

## What was built
| file | change |
|------|--------|
| `convex/sessionFeatures.ts` (new) | `featureScope(campaign)`; `bumpMoonDie` (keyedUserMutation, edit access through `editable`): F0's `bumpMoonDie` in the campaign scope, one undoable public `feature` row "Mira spent a Hope: moon die 3 -> 4 (Full)"; `seedForE2e` (internal, refused unless the backend is the local e2e one) for the browser specs |
| `convex/characters.ts` | `applyDamage` gains optional `negateMinor: true`: F0's `negateMinor(sheet, severityAfterArmor, scope)`; 1 Hope, no Hit Point, the chosen Armor Slot still marked, returns `minor` / marks 0, one undoable public row "Mira spent a Hope: the New Moon negates Minor damage". `derivedDefense` / `derivedThresholds` now get the campaign scope. Without the argument the result, the once-hash and the (absent) log row are unchanged (E4) |
| `src/components/party/features/panel.tsx` | Class Features "Session" chips: `Slayer Dice n/Proficiency` (holdsSlayer, n > 0), `Tide tokens n/level` (holdsTide, n > 0), `Moon die n: <Phase>` (currentPhase in the campaign scope). Rally/Prayer chips and counters untouched (E5) |
| `src/components/party/lunar/**` (new) | `LunarPhasesSlot` (own error boundary) and `LunarPhasesSection`: rendered only for `holdsLunarPhases(sheet, scope)`; four phase cards with inline-SVG moons (`moon-art.tsx`: night disc, ivory lit part with clipped craters, gold rim; names "New moon" ... "Waning moon"), range and effect; the current phase `aria-current` (night card, gold rule, "Tonight" tag, glowing moon); the die medallion or "No moon die: rolled when the session starts."; the "Spend a Hope: +1 to the moon die" pill (owner/GM only), disabled with its reason (no die / used this rest / needs 1 Hope), optimistic update on `characters.get` through F0's pure bump |
| `.../party/[characterId]/page-one.tsx` | mounts `LunarPhasesSlot` right after the Class Features box |
| `.../party/[characterId]/damage-calculator.tsx` | under a New moon and a planned Minor severity: "Spend a Hope to negate this Minor damage" next to Apply (disabled at 0 Hope, the reason in the live output line); thresholds come from `derivedThresholds`, so Full's +3 is already in them |

## Acceptance evidence
- `tests/convex/session-features.test.ts` (10 tests): bumpMoonDie and applyDamage negateMinor for anonymous
  (UNAUTHENTICATED), outsider (NOT_FOUND), player non-owner (FORBIDDEN), owner and GM; bump without a die, second bump
  in the same rest, after a short rest (real `rests.start/finish`), 6 -> 1, 0 Hope (NOT_ENOUGH_HOPE), non-holder, below
  mastery, Hope & Fear off; negate under Waxing, on Major, at 0 Hope, without a die refused (CLASS_FEATURE_RULE); undo of
  each row; plain damage unchanged and unlogged; Full's +3 in the server thresholds; seedForE2e refused off the e2e backend.
- `tests/unit/lunar-phases-render.test.tsx` (12 tests): absent for a non-Moon sheet, below mastery, Hope & Fear off;
  four SVG moons with names, ranges, effects, one `aria-current`; no-die note; disabled reasons; read-only viewers get no
  button; the bump sends only `characterId` + key; chips for holders only.
- `tests/e2e/session-features-sheet.spec.ts`: Moon Witch at mastery with die 1 sees New highlighted, negates Minor
  damage (Hope 3 -> 2, HP 0), bumps to 2 (Waxing highlighted, button disabled, chip "Moon die 2: Waxing", negate gone);
  Slayer chip "Slayer Dice 1/1", Seaborne chip "Tide tokens 1/1"; neither has a Lunar Phases section.
- `tests/e2e/visual/SF-F3.spec.ts` (@visual), shots in `test-results/visual/SF-F3/` at 1440, 1024, 390:

  | shot | verdict |
  |------|---------|
  | lunar-no-die | OK: no card highlighted, "–" medallion, disabled pill with reason |
  | lunar-new / -waxing / -full / -waning | OK: each phase highlighted once; 2x2 grid at 390, no horizontal scroll |
  | lunar-used | OK: disabled pill, "Used this rest; it refreshes after a rest." |
  | chips-moon, chips-slayer-tide | OK: wine ft-pill chips under a "Session" label |
  | damage-new-moon | OK: the pill wraps at 390 (`.ln-negate` in lunar.css) |

## Deliberate deviations
- No board counterpart exists for Lunar Phases; the box uses the sheet's own primitives (sh-box, sh-h, ft-pill, the
  hf-use gold pill look, the sh-num medallion look) and the dark backdrop colours for the current phase.
- `damage-calculator.tsx` imports `src/components/party/lunar/lunar.css` for its one pill class (it has no CSS of its
  own and hp-stress.css is not F3's).
- The e2e specs seed rank, die and pools through the internal `sessionFeatures:seedForE2e` (via `convex run`), because no
  public call sets them before F1 (session start) and F2 (rolls) land.

## Questions
- `bumpMoonDie` does not refuse a dead, away or unconscious character (`assertCanAct` would throw CHARACTER_UNAVAILABLE,
  a code the plan does not list for F3). Reversible: add `assertCanAct` if the user wants the bump blocked like class
  features.
- `seedForE2e` lives in a production module (internal, admin key only, refused off the local backend). Reversible: move
  it into a dedicated e2e module if the orchestrator prefers.
