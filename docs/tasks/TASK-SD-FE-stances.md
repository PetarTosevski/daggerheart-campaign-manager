# TASK SD FE-stances: Feature effects of the martial stances (Q5)

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-stances (wave 3, depends on SD1 and SD-ST). Bead `dcm-bxp.99.19`. Status: Review.

## User answers implemented

- **Q5 (a)** the stances are fully automated: 16 entries the runner executes while the stance is active, plus Shift stance
  and Refocus as runnable uses.
- **Refocus answer (2026-10-23)** an Instinct of 0 or less rolls no dice and gains 0 Focus (the dice count is clamped to 0,
  `keep: "highest"` of no dice is 0).
- **Q7 (a)** a stance lasts until the end of the scene (`STANCE_DURATION = "scene"`).

## Source

Hope & Fear p.12 (Martial Stances: Stances, Focus, Shifting into Stances, Dropping out of Stances, Stance Features),
checked against the sheet (HF p.13) and the Martial Artist page (HF p.11, Flow State). Each entry quotes its text in a
comment.

## What changed

| File | What |
|------|------|
| `src/lib/srd/feature-effects/stances.ts` | `STANCE_EFFECTS`: 16 entries `stance:martial-artist:<slug>` in book order. Every use requires `activeStanceRequirement(slug)`, a `situation` with the `activeStance` check. Beside the table (not in the registry, as they are not classified features): `SHIFT_STANCE_EFFECT` (`main`: spend a Focus; `flow-state`: mark a Stress), `REFOCUS_EFFECT` (once per rest, a moment of calm, clear the track, gain the highest of Instinct d6s), `STANCE_DURATION`, `STANCE_ENDS_ON` (`takeSevere`, `lastHp`), `STANCE_DROP_EVENTS`, `dropsActiveStance`, `shiftRefusal` (unknown / already active), `dropStance`. |
| `tests/unit/feature-effects/stances.test.ts` | 25 tests through `runFeature`. |

### The entries

| Stance | Activation | Steps |
|--------|-----------|-------|
| Favored | rider, before a damage roll | `choose` a trait: `modifyDamage add` that trait |
| Invigorating | auto, successful attack | `check` d4 = 4: `resource` +1 Focus (cap 6) |
| Quick | rider, before an attack roll | Focus or Stress: `addTargets` 1 (any creature within the weapon's range) |
| Reliable | passive | +1 `attack` |
| Aggressive | passive + auto (successful attack) | −1 `evasion`; `modifyDamage extraDie drop lowest` |
| Anchored | passive | +2 `majorThreshold`, +2 `severeThreshold`, flag `cannotBeMoved` |
| Defensive | auto, targeted from Melee | `manual` to the attacker (vocabulary gap, bead `dcm-eut`) |
| Otherworldly | rider, successful attack | `choose` physical / magic: `modifyDamage type` |
| Grappling | rider, successful attack; player confirms "within Melee range" | Focus or Stress: `choose` temporary Restrained / `move` up to Close |
| Scary | auto, successful attack | `markStress` 1 on the targets |
| Stable | reaction, would take damage | Focus: `reduceSeverity` 1 (what an Armor Slot does, CB p.114) |
| Vigilant | reaction, targeted (before the roll, Q2) | Stress: `modifyRoll evasion` +d6 |
| Crushing | rider, target marks HP from Severe damage | Hope: `markHp` 1 on the target |
| Exacting | rider, after a damage roll | `modifyDamage ones asMax` |
| Honed | rider, before an attack roll | Focus: `modifyDamage proficiency +1` |
| Isolating | passive, requires `isolated` (Very Close, you and the target) | advantage on `attack` |

Classification differences (no row changed): Favored is a rider (the trait is picked per damage roll, because the sheet
stores no pick) and Defensive is an auto manual step; the classification lists both as passive.

## Tests

`tests/unit/feature-effects/stances.test.ts` (25): the table matches `MARTIAL_STANCE_SLUGS` and `STANCES`; every use
refuses with no active stance and with another stance; one test per stance (Quick's extra target for a Focus or a Stress,
Stable's Focus instead of an Armor Slot, Honed's +1 Proficiency, Isolating's advantage with and without isolation, and so
on); drop-out events; dropping out ends the uses; shift cost, Flow State, `shiftRefusal`; Refocus (4 Focus → 0 → 5 with
d6s 2, 5, 1; `feat:stance:martial-artist:refocus` until rest, exhausted after; Instinct 0 and −1 roll no dice and end at 0
Focus; the moment of calm).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 301 files, 7912 passed, 1 expected fail, **1 failed**:
  `tests/unit/feature-classification.test.ts` "has the twelve group tables, empty until their FE tracers fill them"
  asserts every table is `[]` and `FEATURE_EFFECTS.size` is 0. That file is SD0's (not in this tracer's `owns`); every FE
  tracer that fills its table breaks it. The orchestrator should drop or loosen that assertion at merge.
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-stances`: OK.

## Notes for later tracers

- SD3 (`combatFeatures.shiftStance` / `refocus`): check `shiftRefusal`, run `SHIFT_STANCE_EFFECT` (`flow-state` only when
  `owned()` holds `subclass:martial-artist:flow-state`) for its price, then set `classState.martial.active`; the
  vocabulary has no step that sets it. Run `REFOCUS_EFFECT` for Refocus and write Focus from the plan.
- SD4 / SD5 / SD8: clear `martial.active` on `STANCE_ENDS_ON` events and at scene end (`dropsActiveStance`); pass
  `facts.activeStance` (and `facts.isolation` for Isolating) in the actor.
- Rider steps act on `to: "targets"`: the rider's context needs the move's targets.

## Open questions (not guessed; the implemented reading is marked)

1. **Favored, when is the trait chosen?** HF p.12: "Gain a bonus to damage rolls equal to a trait of your choice."
   (a) on each damage roll (implemented; the sheet has no field for a pick); (b) when shifting into Favored, kept until
   it drops (needs a stored pick); (c) once, when the stance is learned.
2. **Flow State on the first shift.** HF p.11: "You can mark a Stress instead of spending a Focus to shift into a
   different stance." (a) any shift, also with no active stance (implemented: the use has no gate); (b) only when
   already in a stance (a shift into a *different* one).
3. **Stable and the one-Armor-Slot rule.** HF p.12: "You can spend a Focus instead of an Armor Slot to reduce damage."
   CB p.114 allows one Armor Slot per incoming damage. (a) the Focus replaces that one slot (no Armor Slot as well on the
   same hit); (b) the Focus can be spent in addition to an Armor Slot. Implemented: a reaction that reduces severity by
   one; the window (SD4) decides whether both may be used.
4. **Grappling's Restrain after dropping out.** HF p.12: "When you drop out of a stance, you lose any ongoing benefits it
   provides." (a) the temporary Restrained stays until cleared as usual (implemented); (b) it ends when the stance drops.
5. **Shifting into the stance already active.** HF p.12: "You can't shift into or have more than one active stance at a
   time." (a) refused (implemented, `shiftRefusal` → `active`); (b) allowed (spends a Focus, no change).
