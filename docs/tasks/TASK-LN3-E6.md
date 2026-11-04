# TASK-LN3-E6: endings round 3 (plan lanes-2 wave 9, tracer E6.3)

Branch `lane3-e6`, lane `w1-e6-endings-durations`. Resumed after a machine crash; the crashed run's partial work
was kept and finished.

## What landed

- **GM spends Fear to end an effect** (dcm-kmr, dcm-6y00 (1)). New module `convex/combatEffects.ts`:
  - `fearEnds` (gmQuery): which effects and condition markers on a PC sheet or an encounter instance a Fear spend
    ends, with the cost (`gmFearToEnd`: `byTier` uses the PC's tier, or the caster's tier for an instance modifier;
    default 1).
  - `endByFear` (keyedGmMutation, `{ target, effectId, fear }`): spends the Fear and ends the effect, plus the
    condition it stands for, in one undoable actionLog row (undo gives the Fear back and restores the sheet or
    instance). If the cost changed since the button was drawn: `INVALID`. Too little Fear: `FEAR_EMPTY`.
  - The logic is in `convex/lib/cardRows.ts`: `fearEndsOnSheet`, `fearEndsOnInstance`, `endSheetEffectByGmFear`,
    `endInstanceEffectByGmFear`.
  - UI: on the token panel's GM block, `FearEnds` shows one button per Fear-endable entry, labelled
    "End <label> · N Fear" (`use-tokens.ts` `useFearEnds`). It is hidden when nothing qualifies.
  - Authz entries for both functions are in `tests/convex/authz/features.entries.ts`.
- **Adversary-given conditions on PCs** (dcm-46q4, dcm-iedr E6 half). The plan's `conditionDetails` are stored as a
  marker effect `ac:<n>` beside the condition. The marker holds a JSON tail with the caster instance, the feature,
  `endsOnCaster`, `endsOnRoll` and `endFear`. No stored shape changes: markers are ordinary `effects` entries.
  Helpers in cardRows.ts:
  - `withAdversaryConditionMarkers`: writes the markers.
  - `endAdversaryConditions`: the pure end.
  - `endAdversaryConditionsForCaster`: ends the conditions on the whole party, saved and logged in the caller's group.
  - `endAdversaryConditionsOnRoll`: the bearer's roll side.

  A marker with `endFear` also appears in the GM's Fear list.
- **D5 Unstoppable cleanup** (dcm-v17): after the `unstoppableHit` and `endUnstoppable` actions,
  `convex/classFeatures.ts` runs `afterUnstoppable`, so the Unstoppable sheet effect ends once the die is gone.
- **User answer 2026-10-31, in `expiry.ts`:**
  - "Took damage" means at least 1 HP was actually marked after armor and other reductions. A hit reduced to 0 HP
    does not end Slumber or Transform at any severity. This replaces the round-1 E6 Q1 default.
  - Severity follows the HP finally marked (`takenSeverity`): 1 = Minor, 2 = Major, 3 or more = Severe. A Severe
    hit that armor drops to 2 HP is Major for `takeSevere` / `majorDamage`.
  - On the creature's last HP the marks are capped at what was left, so the hit's own severity counts when it is
    higher (my reading, see Q1).
- Tests:
  - `tests/unit/lane3-e6-took-damage.test.ts`
  - `tests/convex/lane3-e6-endings.test.ts`: markers, the caster and roll ends, the Fear lists, `endByFear` with
    undo, FEAR_EMPTY, and D5.
  - **Outside owns:** in `tests/convex/lane-e6-endings.test.ts` (the lane's round-1 test), one assertion encoded the
    old "0-HP Minor hit ends Slumber" behaviour. I changed it to the user's answer. The orchestrator should accept
    this edit at merge.

## Beads

| Bead | Status |
|---|---|
| dcm-kmr | Closable. Intent, button and amount are done. I checked its `convex/sessions.ts` `dropStance` part: `sessions.ts` no longer calls `dropStance` (the drop is in `convex/lib/stanceDrop.ts` and `incomingHits.ts`), so nothing is left there. |
| dcm-6y00 | Part (1) is done: the function is `combatEffects.endByFear`, not `combatFeatures`, and it has its authz entry. Part (2), the button, is done. Part (3), the sanction payload point, is not E6's: E6 Q1 default kept. |
| dcm-46q4 | Engine half done. Left: the callers, dcm-1alq (E7, store the markers) and dcm-wli0 (E1, caster-damage and roll ends). |
| dcm-iedr | E6 half done (stored fields as markers, end helpers). Left: the same callers. |
| dcm-v17 | D5 cleanup done. "Can't be Vulnerable" is still manual. Closable if that stays a reminder. |

## Vocabulary beads checked against the wave-8 callers

| Bead | Status |
|---|---|
| 8bv | Engine done: `targetDefeated` and, from this tracer, the GM Fear spend. Left: data. Marked for Death needs `endsOn gmSpendsFear` + `endFear byTier` (dcm-mvoo, S2 this wave). Closable after that. |
| awh | Engine done (E3 plan + E8 applies `setStance`). Data is S2's Stance Fighter this wave. Closable after S2. |
| ffk | Done: the data's `endsOnRoll { weaponAttack, success, weapon: primary }` is read by E1's roll ends. Closable. |
| 4qv | Done by E2 (dcm-t8c, the Night's Glamour keep offer). Closable. |
| wjv | Done: the data has `endsOnCaster takeSevere`, and E2's incomingHits fires it. With this answer, "Severe" now means 3 HP marked. Closable. |
| 3ea | Done: the data has `endsOnRoll { roll: presence }`, and E1 reads roll-kind ends. Closable. |
| 0ey | Engine done. Spectral Mist data (`endsOn actionRoll`) is S1's this wave. Closable after S1. |
| cwh | Done: Timejammer data has `endsOnRoll { by: caster, targetsCreature }`. Closable. |
| b77 | Not E6's. Left: E7 bearer riders and storage of `record` (Banish). |
| utu | Done: the user answer is now enforced (≥1 HP marked). Closable. |
| erhv | Waits on dcm-m48i (E1.3a this wave, card paths). The feature path is live. |
| 9z2z / 8x8 | The feature path and instances are live. Card paths wait on dcm-m48i (E1.3a). |
| 5fc | The feature path is live (Howling Rampage `endEffect` data present). Closable after S2 verifies. |
| kkx | Engine done (replace / refuse). Blight Seed data `stacking: "refuse"` is S2's this wave. Closable after S2. |
| b9hc | E8.3's this wave. Nothing for E6. |
| 55k | Needs the validator widens (orchestrator / CT campaign time). The expiry side waits on them. |

## Follow-ups filed

- dcm-1alq (E7): call `withAdversaryConditionMarkers` after `writeSheetChanges`.
- dcm-wli0 (E1): `endAdversaryConditionsForCaster` where PC attacks, cards or features damage an instance, and
  `endAdversaryConditionsOnRoll` on PC rolls.
- dcm-mvoo (SRD data): Marked for Death / adversary `endFear` data.
- dcm-try2 and dcm-7qgg are accidental duplicates of dcm-1alq and dcm-wli0 (commented). Close them as duplicates.

## Data switches ready for wave 10

- feature-effects/assassin-brawler.ts Marked for Death: `endsOn: ["gmSpendsFear", "targetDefeated"]`,
  `endFear: { kind: "byTier", values: [1, 2, 3, 4] }`. The GM button then lists it.
- Adversary entries with `endFear`: they will show in the GM list once dcm-1alq stores the markers.

## Merge-time actions

- Regenerate `convex/_generated` (new module `combatEffects`; api.d.ts is not committed, so typecheck on the bare branch fails until codegen).
- Authz entries are already in `features.entries.ts`: `combatEffects.fearEnds` (gm) and `combatEffects.endByFear`
  (gm, okCodes INVALID).
- Accept the one-assertion edit in `tests/convex/lane-e6-endings.test.ts` (outside owns, required by the user answer).

## QUESTIONS

1. On the last Hit Point, the marks are capped at what was left. Example: an adversary with 1 HP left takes a Severe
   hit and marks only 1 HP. I read it as Severe (the hit's own severity), so "until the Shark takes Severe damage"
   still ends. The other reading is Minor (only 1 HP marked). Which one?
2. A marks multiplier can raise the HP marked: a Minor hit doubled marks 2 HP. Under "severity follows the HP
   marked" this reads as Major for end events. Is that intended?
