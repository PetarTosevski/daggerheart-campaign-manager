# TASK-RULES-WD: rule switches wave 3, rests & unconscious (T1, T3, C4 sheet side, W3 Tier 1)

Status: Review. Rule switches wave 3, tracer WD (epic dcm-jh6d part A, bead dcm-bxp.134). Inputs:
`.omc/plans/rule-switches-wave3-questions.md`, its section "User answers (2026-11-09)" (binding: Q8 a, Q9 a, Q10 a,
Q14 a) and `docs/tasks/TASK-RULES-W3S0.md` (the modes and the "Readers" list). Same meanings as waves 1-2: Book = the
app does what the book says; Manual = the app stops doing it and posts a GM-only note (`postRuleNote`) in the action's
undo group.

`twoDowntimeMoves`, `downtimeMoveEffects` and `unconscious` are added to `WIRED_RULES`
(`src/components/config/sections/rules/model.ts`, their own block).

## What each mode does

| Rule | Book | Manual |
|---|---|---|
| T1 `twoDowntimeMoves` (CB p.105) | Two moves, plus Celestial Trance and granted extra moves (unchanged). | `rests.choose` takes 0 to 4 moves (more only when the PC's features already give more). The picker shows "Add a move" / "Remove a move". When the rest ends, a PC whose count is not the book's gets a GM note "Mira picked 3 moves". |
| T3 `downtimeMoveEffects` (CB p.105) | Rolled and applied (unchanged). | The core moves (Tend to Wounds, Clear Stress, Repair Armor, Prepare, Prepare together, the long-rest four, Work on a Project) are neither rolled nor applied: no dice, no Oasis window, no project tick. Each PC's rest row says "Short rest: moves by hand: Tend to Wounds on Theo, Prepare" and the GM gets one note per PC "Short rest: Mira: Tend to Wounds on Theo, Prepare". The picker says the table rolls them in the dice box. Everything else in the rest still runs: F2 Fear, T2's count, T4, T5 expiry, the frame hooks (W4-W7), Hardy, card rest timings, and the class / frame moves (Tribute, Martial Preparation, Raise loadout, Make a Feast...). |
| C4 `unconscious` (CB p.106), sheet side | Unconscious PCs can't act (`assertCanAct`: CHARACTER_UNAVAILABLE), pick no moves, wake on a long rest and when a Hit Point is cleared (unchanged). | The badge only. No refusal (`assertCanAct`, `rests.choose`, the rest's moves, the features panel, the rest picker and launcher). No automatic waking: a long rest leaves them down with the GM note "Long rest: wake Mira?"; a Hit Point cleared on them (any path that saves through `saveSheet`) leaves them down with "Mira had a Hit Point cleared: wake her?" (object pronoun from the sheet's pronouns field, else "them"). The GM wakes them with the condition toggle. |
| W3 `doomTrack` Tier 1 (HF p.177), Journey to Horizon, Book only | After 5 Tier 1 boxes are marked (`tierRuleActive(state, 1)`), the book long rest's Fear d4 is rolled twice and the higher kept; the campaign row says "GM gains 7 Fear (1d4 3 + 4 PCs; Doom Track Tier 1: rolled 1 and 3, kept the higher)". | Not applied (Every N sessions too, as the brief said "Book only"). |

## Code

- `src/lib/domain/characters/index.ts`: `UnconsciousMode`, `unconsciousBlocksActing(sheet, mode)`,
  **`isUntargetableUnconscious(sheet, mode)`** (the hook for WF, see below), `keepUnconscious(before, after, mode)`
  (Manual undoes a wake by an HP clear), `hpClearedWakeNote`, `longRestWakeNote`, `objectPronoun`.
  `applyResourceDelta` is unchanged (it still wakes; Manual puts the condition back at the save).
- `src/lib/domain/rest/moves.ts`: `TwoDowntimeMovesMode`, `MANUAL_MOVES_MAX = 4`.
- `src/lib/domain/rest/feature-moves.ts`: `restMoveSlots(features, extra, mode)` (Manual `{ min: 0, max: max(4, book) }`),
  `validateFeatureChoice(..., mode)`.
- `src/lib/domain/rest/index.ts`: `validateChoice(..., mode)`, `moveCountNote`, `DowntimeMoveEffectsMode`, `isCoreMove`,
  `splitManualMoves(choices, mode)` → `{ applied, byHand }`, `picksText`, `higherOfTwo`, `restedSheet(..., unconscious)`.
- `convex/lib/characterSheet.ts`: `assertCanAct(character, sheet, campaign?)` reads C4 (no campaign = Book).
  `saveSheet`: when a save drops `unconscious` while clearing Hit Points and C4 is Manual (the campaign is read only
  then), the condition and its source are kept and a wake note waits in the mutation's side state; `postWakeNote(ctx,
  campaignId, characterId, actorId, groupId?)` posts it.
- `convex/lib/actionLog.ts`: `logAction` posts a waiting wake note after the character's row, in the row's group (undo
  removes it). `convex/characters.ts` `adjustResource` (unlogged) posts it with no group, like its other notes.
- `convex/rests.ts`: `choose` passes T1's mode and the campaign to `assertCanAct`; `applyRest` reads `ruleModesOf` once:
  unconscious filter by C4, `splitManualMoves` before `applyMovesWithDice`, `restedSheet` + `keepUnconscious` by C4,
  the T1 / T3 / C4 notes in the rest's group (after F2's, stopped at the group cap of 50 rows), and `doomTierOneActive`
  for the Fear roll.
- `convex/lib/restView.ts`, `convex/restsReads.ts`: `movesView.minSlots` (widened returns), `rules` gains
  `twoDowntimeMoves`, `downtimeMoveEffects`, `unconscious`.
- Call sites of `assertCanAct` now pass the campaign: `convex/classFeatures.ts`, `convex/sessionFeatures.ts`,
  `convex/adversaryActions.ts` (line 332), `convex/featurePrompts.ts` (4), `convex/combatActions.ts`,
  `convex/combatFeatures.ts` (3), `convex/combatCards.ts` (2).
- UI: `src/components/party/rest/picker.tsx` (free count, by-hand line, C4), `src/components/party/rest/launcher.tsx`
  (open-rest line, C4), `src/components/party/features/panel.tsx` (`useBlockedReason` reads `ruleSettings.get`).

## For the orchestrator (files outside WD's reach)

WR owns these this wave; each is a one-line change once WR merges, until then C4 Manual still refuses rolls from the
dice box and Tag Team:

- `convex/lib/rolls.ts` lines ~725 and ~1009: `assertCanAct(character, sheet)` → `assertCanAct(character, sheet, campaign)`.
- `convex/rolls.ts` lines ~188-189: pass `lead.campaign` as the third argument to both calls.
- `src/components/party/dice/dice-box.tsx` line ~67 and `src/components/party/dice/tag-team.tsx` line ~40: replace the
  `conditions.includes("unconscious")` test with `unconsciousBlocksActing(sheet, mode)` (`@/lib/domain/characters`),
  the mode from `useQuery(api.ruleSettings.get, { campaignId })?.modes.unconscious ?? "book"`.

## For WF: "can't be targeted by an attack" (Q8 a)

Call `isUntargetableUnconscious(sheet, ruleMode(campaign, "unconscious"))` (`src/lib/domain/characters/index.ts`) in
the adversary attack paths (`convex/lib/adversaryActions.ts`, `src/lib/domain/adversary-actions/`): true only in Book
for an unconscious PC. Manual: the attack goes through (the GM decides).

## Interpretations (questions for the user)

1. T3 Manual leaves only the core CB p.105 moves to the table; Tribute, Martial Preparation and Raise loadout (their own
   features) and Hardy still apply. Should Manual stop those too?
2. T1 Manual's 4 is a ceiling; a PC whose features already allow more (Celestial Trance + two Eloquent grants = 5) keeps
   that. The "picked N moves" note fires only when the count differs from that PC's book count.
3. W3 Tier 1 runs in Book only, as briefed. Should the "Every N sessions" variant also apply the tier rules (it only
   changes how often boxes are marked)? It applies to the book long rest's 1d4, not to Extended downtime (1d6 per PC).
4. C4 Manual's HP-clear note comes from the save chokepoint; a write that saves without logging (other than
   `adjustResource`) keeps the PC down but posts no note.

## Tests

- `tests/convex/rules-rests-wd.test.ts`: T1 Book refusals and Manual 0/3/4/5 with the note and its undo; T3 Manual (no
  sheet change, no dice or Oasis, F2 and T2 still apply, row and note text) and Book; C4 Book (refusal, long-rest and
  HP-clear wake) and Manual (picks moves, stays down after a long rest and after Tend to All Wounds, "Long rest: wake
  Ash?", "Ash had a Hit Point cleared: wake her?", the GM's toggle, a feature no longer CHARACTER_UNAVAILABLE); W3 Tier 1
  with 5 boxes (rolled twice, kept the higher), and a short rest, 4 boxes and Doom Track Manual (one roll).
- `tests/unit/rules-wd.test.ts`: the pure helpers.
- Updated: `tests/convex/rules-rests.test.ts` (`rules` has the three new keys), `tests/unit/rest-feature-moves.test.ts`
  (the mocked `restsReads.current` carries `rules`).
