# TASK LN-E6: Effect endings and durations

Plan `.omc/plans/lanes.yaml`, tracer E6 (label `w1-e6-endings-durations`). Depends on V (the widened vocabulary:
`EndEvent`, `RollEnd`, `endsOnCaster`, `maintain`, `setStance`; docs/tasks/TASK-LN-V.md). Extends DA10's event engine
(docs/tasks/TASK-DA-DA10.md: stance drop, Beastform ends). Status: Review. Book pages are printed pages (CB = Core Book,
HF = Hope & Fear). No SRD entry and no types.ts file was touched; the tests use fixture entries (wave 5 switches the SRD
entries to the new vocabulary).

## The engine

Nothing about an effect's ends is stored. A sheet effect `card:<cardId>:<n>` / `feat:<hash>:<n>` and an instance
modifier `card:<cardId>:<n>` / `feat:<featureId>:<n>` already name their entry; the label (the sheet text's first part,
the instance modifier's `label`) names the step. The ends are read from that step.

| Piece | File | What |
|---|---|---|
| `EffectEnds`, `EndRoll`, `EndOccurrence` | `src/lib/domain/characters/expiry.ts` | What ends an effect (duration, `endsOn`, `endsOnRoll`, `endsOnCaster`, `maintain`) and what happened (a roll, a resolved hit taken, damage dealt, a named event). |
| `occurredEvents` | expiry.ts | The `EndEvent`s an occurrence sets off: a hit gives `takeDamage` (not when reduced to no HP: `reducedToNoHp`), `markHp`, `majorDamage`, `takeSevere`, `lastHp`; a roll gives `actionRoll` (not a reaction roll, CB p.95), `bearerAttacks`, `rollWithFear`, `bearerFails`, `failWithFear`, `attackSucceeds` (a critical is a success, CB p.90); damage dealt `dealDamage`, `dealSevere`. |
| `endRollFilter`, `endRollResult`, `rollEndHolds` | expiry.ts | A `RollEnd` against a made roll: the roll kind or trait, `result`, `weapon`, `targetsCreature`. |
| `endsOnOccurrence(ends, occ, role)` | expiry.ts | Bearer side: `endsOn`, a bearer `RollEnd`, and duration `nextRoll` (stored as `manual`). Caster side: `endsOnCaster` and a `RollEnd` with `by: "caster"`. |
| `endEffects(sheet, occ, endsOf, opts)` | expiry.ts | The sheet without what ends; `ended`; `maintainable` (a `maintain` effect that ended; one in `opts.maintained` stays). |
| `payMaintain(sheet, maintain)` | expiry.ts | Pays fixed Hope / Stress (Stress past a full track marks a Hit Point, CB p.92); null when it can't. |
| `withoutLapsedUnstoppable` | expiry.ts | The Unstoppable effect goes once D5 removed the die. |
| `srdUses`, `stepEnds`, `effectSource`, `effectEndsOf`, `instanceEffectSource` | `convex/lib/cardRows.ts` | The lookup: an entry's `effect` / `condition` steps anywhere in its uses (options, saves, checks, follow-ups, table rows), by label; D5's `marked-for-death` effect aliases Marked for Death. Every function takes a `SourceLookup` (tests pass fixtures). |
| condition markers | cardRows.ts `effectsAfter` | A condition given to an enemy whose step ends on an event (other than `stanceDrops`, which DA10's markers handle) leaves an instance modifier with the condition's name as label; one ended by its caster's events carries the caster's token: `<prefix>:<n>~<token id>` (`ownsInstanceEffect` reads both). |
| `endInstanceEffects`, `endOnInstance`, `endForCasterOnInstances` | cardRows.ts | Instances: the modifiers that end go, a marker takes its condition (standard) or tag with it. The server ones patch and return `before` (with effects) and GM lines for the caller's undo group. |
| `instanceWrites` damage | cardRows.ts `endedByDamage` | A card or feature use's damage to an enemy ends the modifiers and conditions it already had that end on damage / marking HP (Slumber's Asleep, Jump Scare's Vulnerable), in the use's own undo (`adversaryBefore` with effects). |
| `endOnSheet`, `endForCasterOnSheets`, `holdsSource` | cardRows.ts | PC sheets; caster side: the caster is the one party member holding the card (loadout) or feature (Q3). |
| `endOnDefeat`, `endByGmFear`, `endInstanceByGmFear` | cardRows.ts | `targetDefeated` (the defeated instance carries the tag the effect's step names), `gmSpendsFear` (one effect by id). |
| `refusedConditions`, `afterUnstoppable` | cardRows.ts | Flags `cannotBeRestrained` / `cannotBeVulnerable` on a PC's effects; the Guardian's Unstoppable effect after the die is gone. |
| `withoutStance(sheet, endsOf)`, `dropStance(…, endsOf)` | `convex/lib/stanceDrop.ts` | With `endsOf`, the sheet's own `stanceDrops` effects end with the stance (HF p.12: "you lose any ongoing benefits it provides"). |
| `withStance`, `setStance` | stanceDrop.ts | Set a known stance; `setStance` drops the previous stance first (with its Restrain and `stanceDrops` effects). |
| `shiftStance` | `convex/combatFeatures.ts` | Now pays, then `setStance` (with `effectEndsOf`); behaviour as before (tests/convex/stance-drop.test.ts unchanged). |

## Beads

| Bead | State | What is done / what is left |
|---|---|---|
| dcm-0ey Spectral Mist (action roll or scene end) | partly | Duration `scene` + `endsOn: ["actionRoll"]` ends on the bearer's action roll, not a reaction roll (`endOnSheet` with a `roll`). Left: the roll paths fire it (E1, dcm-wn7). |
| dcm-3ea Reliable Backup (next Presence Roll) | partly | `endsOnRoll: { roll: "presence" }` matches a Presence Roll only. Left: firing (dcm-wn7); "in conversation" is not detectable (Q5). |
| dcm-4qv Night's Glamour maintain | partly | `maintainable` and `maintained` in `endEffects`; `payMaintain`. Left: the offer to the player before the end (E2's window, dcm-t8c); until then the effect ends (Q4). |
| dcm-8bv Marked for Death (defeat, GM Fear) | partly | `endOnDefeat` (D5's `marked-for-death` effect ends when an instance carrying the tag is defeated), `endByGmFear`. Left: callers on defeat (dcm-wn7) and the GM's Fear intent (dcm-kmr, a new public mutation needs an authz entry outside E6's owns); the amount of Fear (Q2). |
| dcm-awh Stance Fighter sets the stance | partly | `withStance` / `setStance`, used by `shiftStance`. Left: run.ts emits a plan step for `setStance` (E3) and featureRunner calls `setStance` (E8) (dcm-4xl). |
| dcm-b77 Banish's return | not | Needs a rider on every PC roll with Fear that runs a reaction roll on the banished instance with a falling Difficulty (E2 bearer riders, E3 saves). Not built; the count of Fear rolls since the banish has nowhere to live yet (an instance modifier field would be a validator widen). |
| dcm-cwh Timejammer / Specter of the Dark | partly | Caster-ended markers on instances (`~<token>`), `endForCasterOnInstances` with `targetsCreature`; sheets via `endForCasterOnSheets`. Left: the roll paths fire it (dcm-wn7). |
| dcm-ffk Menacing Reach (primary weapon) | partly | `RollEnd.weapon` with `EndRoll.weapon`. Left: firing from attacks (dcm-wn7). |
| dcm-utu until the bearer takes damage (Slumber, Transform, Jump Scare, Hush, Eclipse, Steeds, Beetles) | partly | `takeDamage`, `markHp`, `majorDamage`, `takeSevere` from a resolved hit; done end to end for card / feature damage to an enemy (`instanceWrites`). Left: weapon attacks on instances (dcm-wn7), hits on PCs (dcm-t8c), GM Fear (dcm-kmr). |
| dcm-v17 Unstoppable | partly | `afterUnstoppable` (the effect goes with the die), `refusedConditions` (`cannotBeVulnerable`, `cannotBeRestrained`). Left: calls after D5 actions (dcm-4xl, dcm-kmr) and before conditions land (dcm-t8c); the `classDie` number is E5's. |
| dcm-wjv Eye of the Storm, the caster's Severe | partly | `endsOnCaster` via `endForCasterOnSheets`. Left: incomingHits fires it (dcm-t8c). |

Follow-up beads (label `e6-followup`): dcm-t8c (E2, incomingHits), dcm-wn7 (E1, rolls / attacks / defeats), dcm-4xl
(E8 / E3, setStance and Unstoppable in the feature runner), dcm-kmr (orchestrator: the GM Fear intent, classFeatures.ts,
sessions.ts).

## Tests

`tests/convex/lane-e6-endings.test.ts` (fixture entries): occurred events, roll ends (Reliable Backup, Menacing Reach,
Timejammer, criticals), `endEffects` (Transform, Spectral Mist, nextRoll), maintain, Unstoppable and the flags, the entry
lookup (nested steps, ids, the D5 alias), instance ends (Slumber, Jump Scare, the caster's token, GM Fear), Marked for
Death, Eye of the Storm (two holders left alone), the markers and the damage ends in `instanceWrites`, stances, and the
server helpers on a convex-test world (`endOnInstance`, `endForCasterOnInstances`, `setStance`, `shiftStance`).

## QUESTIONS

1. **Damage reduced to no Hit Points: did they "take damage"?** Slumber (CB p.332): "they're Asleep until they take damage
   or the GM spends a Fear on their turn to clear this condition." Shield Aura (CB p.341): "If this spell causes a
   creature who would be damaged to instead mark no Hit Points, the effect ends." Built: a hit whose severity is None and
   marks no Hit Points is not "taking damage" (`reducedToNoHp` instead); a Minor or worse hit is, even if a feature then
   reduces the HP marked to 0. Agreed?
2. **How much Fear ends it?** Slumber: "the GM spends a Fear on their turn"; Marked for Death (HF p.8): "the GM spends a
   number of Fear equal to your tier to clear it". `gmSpendsFear` carries no amount. Should the GM intent ask the entry for
   an amount (a vocabulary gap: `EndEvent` has none) or let the GM enter it?
3. **Who made an effect on an ally?** A sheet effect does not record its caster. Built: the caster is the one party member
   holding the card (loadout) or feature; with two holders (two Skykin with Eye of the Storm) the ally's effect is left for
   the GM to end by hand. Store the caster on the effect instead (a validator widen in `src/lib/validation/characters.ts`)?
4. **Night's Glamour before the offer exists.** HF p.17: "Unless you mark a Stress to maintain your Glamour, it drops when
   you mark a Hit Point or deal damage." Until E2's window offers the Stress, the engine ends it (the book's default). Or
   should it stay until the player answers?
5. **Reliable Backup "in conversation".** CB p.43: "When you make a Presence Roll in conversation, they back you up." The
   server can't tell a conversation; built: any Presence Roll ends it. Should the player confirm (Q13 style) instead?
6. **Marked for Death with two assassins.** HF p.8: "You can have only one adversary Marked for Death at a time." Both
   assassins' D5 effects end when any instance with the tag is defeated (the tag doesn't name its assassin). Acceptable?

## Outside owns

None. `tests/convex/stance-drop.test.ts` is unchanged and still passes.
