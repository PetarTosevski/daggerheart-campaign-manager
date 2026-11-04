# TASK LN-E8: delegate, session features, held dice, rests and companion

Plan `.omc/plans/lanes.yaml`, tracer E8 (label `w1-e8-session-features-rests`), wave 4, after V. Status: Review.
Book pages are printed pages (CB = Core Book, HF = Hope & Fear). Tests: `tests/convex/lane-e8-session-features-rests.test.ts`
(inline fixture entries; the SRD entries switch to the new vocabulary in wave 5).

## Per bead

| Bead | State | What |
|---|---|---|
| dcm-bxp.99.19.58 Efficient on an interrupted long rest | done | `interruptedMoves(kind, moves, efficient)` (src/lib/domain/rest/index.ts): the holder keeps ONE pick at full long-rest strength, the first long-rest-only move in pick order (Tend to All Wounds, Clear All Stress, Repair All Armor, Work on a Project); the other picks convert. `convex/rests.ts applyRest` passes the PC's Efficient. `tests/convex/rests-features.test.ts` pin flipped (outside owns). |
| dcm-2a1 rest timing / downtime steps | done (engine) | `restFeaturesOfEntry` (rest/feature-moves.ts): a use set off by a rest timing (`afterRest` / `afterLongRest`, any `restType` / `during`) with a `downtime` step for this rest is Efficient (`longMoveOnShort`), Celestial Trance (`extraMove`) or Oasis (`rerollDie`); `restFeaturesOf` ORs it with the four ids, so wave 5 can switch the entries without touching the rest flow. Hardy stays by id (its entry is already fully expressed). |
| dcm-bxp.99.19.2 Eloquent, extra downtime move | done | A `downtime` step `op: "extraMove", at: "nextRest"` (a manual prompt in run.ts until E3) is recorded by `resolveFeatureUse` (convex/lib/featureRunner.ts) as a `featureUses` entry `downtime:extraMove:<n>` until "rest" on each recipient (no manual row; a note "X: an additional downtime move at the next rest"). The rest reads it (`extraMoveGrants`): `current` returns `slots` (+1 per grant), `trance`, `extraMoves`; `choose` validates with them; the rest's own expiry clears the grant. Picker: extra slots shown from the start ("Extra move"), trance slot after them. Grants are optional picks (max, not min). |
| dcm-78x delegate to session features (Know the Tide) | partly | `SESSION_DELEGATES.knowTheTide` (feature-effects/delegate.ts) spends `amount` tokens via `spendTideTokens`; the use no longer refuses with a sheet. NumberSource `tideTokens` (numbers.ts, E5) is still 0: follow-up dcm-rm9. |
| dcm-lk8 Lunar Phases moon die | partly | `SESSION_DELEGATES.lunarPhasesBump` (key = `LUNAR_BUMP_KEY`) runs `raiseMoonDie` (new in session-features/lunar.ts: the bump without its Hope, which the entry pays as a cost); `delegatedExhaustion` reads the key until rest. StateCheck `moonPhase` (availability.ts, E5) still undefined: dcm-rm9. Wave 5: the entry's delegate key must be `lunarPhasesBump` (FE-seraph-witch wrote `feat:subclass:moon:lunar-phases:bump`). |
| dcm-53f delegated Hex names the map target | done | The delegator passes the creature id as `choice` to a D5 feature with a "Target name" input (Hex, Marked for Death, Ranger's Focus) when none is typed; `resolveFeatureUse` swaps ids for the creature's name in `classState` and the feed line (`nameDelegatedTargets`, `renameIds`) and refuses a second Hex on the same creature (INVALID). `tests/unit/feature-effects/seraph-witch.test.ts:261` updated (outside owns). |
| dcm-sa2 reroll Slayer 1s | not | `RollChange rerollHeld` is applied in run.ts (E3). The dice box and map attacks already reroll automatically (convex/lib/rolls.ts `rerollSlayerOnes`). Follow-up dcm-inou. |
| dcm-gov Otherworldly Ire targets after the dice | not | Needs run.ts `rollTargetCount` choices (E3) and featurePrompts' roll paying the Favor. Follow-up dcm-q3t1. |
| dcm-2z2 companion stats | partly | `convex/lib/companion.ts` (`companionFor`, `companionNumbers`: die, range id, damage type, training left, Evasion, Stress); `pickFeature({ companion })` sets the actor's `dieSides.companion`. SD-C (sheet-drawer.yaml) is not built; the caller (`combatFeatures.prepare`, E6), `DamageRoll companion` / `companionRange` (run.ts, E3) and `companionTraining` remain: follow-up dcm-b9hc. |

## Files outside owns

- `tests/convex/rests-features.test.ts` (dcm-bxp.99.19.58 pin flipped, as the bead asks).
- `tests/unit/feature-effects/seraph-witch.test.ts` (one line: the delegated Hex now holds the creature, dcm-53f).
- `tests/unit/d5-answers.test.ts:132,135` (same: the new Hex is the creature, not "Target N").
- `tests/convex/rests.test.ts:243` (the generic interrupt test's PC is made an elf, since a Clank now keeps a long pick).

## Stored shapes

No stored validator changed. The grant is a `featureUses` entry (existing shape). `rests.current`'s return gained `trance`
and `extraMoves` (a returns validator, not stored). No new public function.

## Questions (none blocking)

1. Efficient's kept pick on an interrupted long rest is the FIRST long-rest-only move in pick order; the player does not
   choose at interrupt time. CB p.53: "When you take a short rest, you can choose a long rest move instead of a short
   rest move." If the player should pick which one stays, the rest needs a choice at interrupt.
2. Eloquent's extra move is optional (the player may leave it unused) and stacks per grant. CB p.29: "Give them an
   additional downtime move during their next rest."
