# TASK SD FE-warlock: Warlock feature effects

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-warlock (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status: Review.

All 15 Warlock features (Hope feature, two class features, six per pact) are classified `combat`, so
`src/lib/srd/feature-effects/warlock.ts` has 15 entries. Each quotes its text with the printed page. They use only the
SD0 / SD1 vocabulary; nothing in the vocabulary or the runner was changed.

Book: HF p.14 (Warlock class page: Patron's Boon, Patron's Pact, Favor; Pact of the Endless) and HF p.15 (Pact of the
Wrathful). Rules used: CB p.107 (incoming damage, rerolls take the new result, round up, end of the scene), CB p.91
(Massive damage: one hit marks at most 4 HP), CB p.90 (critical counts as a success with Hope).

## User answers implemented

- **Q1** after-roll answers on the warlock's own roll: Patron's Boon, Favor, Diminish My Foes, Fearsome Attack.
- **Q2** before-roll answers (`whenCreatureAttacked`, stage `targeted`): Harrowing Invocation, Draining Bane.
- **Q6** Damage Sink halves and rounds up (27 → 14, 26 → 13).
- **Q7** Patron's Mantle and Patron's Fury last until Severe damage (taken / dealt) or the scene ends (`scene` + `endsOn`).
- **Q13** the patron's sphere (Patron's Pact) and "with Hope" (Favor, Diminish My Foes) are player check boxes.

## Entries

| Feature | Activation | What runs |
|---|---|---|
| Patron's Boon (Hope) | reaction, after your failed roll | 3 Hope; fold: reroll all dice with advantage |
| Patron's Pact | rider, before an action roll | sphere check box; 1 Favor; fold: + Patron Die (d6, d8 from level 5 via `sidesOf: patron`) |
| Favor | reaction, after a successful action roll | "with Hope" check box; `replaceHopeGain: favor` |
| Patron's Mantle | action | 1 Favor; effect +tier to Major and Severe thresholds, `scene`, ends on `takeSevere`; manual: intimidate advantage |
| Deathless Embrace | action, once per rest | N Favor; clear 1 HP per Patron Die of 4+ |
| Harrowing Invocation | reaction (`targeted`) + auto (`failed`) | 1 Favor; attacker gets `attackDisadvantage` for its next roll and the tag "Harrowing Invocation"; when that attack fails, the tagged attacker marks 1 Stress |
| Damage Sink | reaction, would take damage, once per rest | 1 Favor; halve the incoming damage (rounded up) |
| Dark Aegis | reaction, would take damage, once per long rest | 1 Favor; `adjustHpMarked` 4 fewer (no HP marked) |
| Draining Bane | reaction (`targeted`) | 1 Favor; attacker marks 1 Stress; optional: clear 1 Stress; attacker uses a d12 for attack rolls until it fails a roll (`set attackDie 12`, ends on `bearerFails`) |
| Patron's Fury | action + auto (before a damage roll) | 1 Favor; effect `scene`, ends on `dealSevere`; while it is active each damage roll adds tier Patron Dice (state check `featureEffect`) |
| Deadly Vengeance | reaction, you mark HP from an attack | 1 Favor; the attacker marks 1 HP per Patron Die of 4+ (dice = HP marked, the trigger amount) |
| Menacing Reach | action | 1 Favor; primary weapon range +1 step; ends on `attackSucceeds` |
| Diminish My Foes | rider, after a successful action roll | "with Hope" check box; N Favor; the target marks N Stress |
| Fearsome Attack | rider, after a damage roll | 1 Favor; reroll the picked damage dice; no limit, so each further Favor is another use |
| Otherworldly Ire | reaction, you take damage, once per rest | N Favor; roll N Patron Dice (check step); manual: target that many creatures within Close, each marks 1 HP |

## Readings (no new mechanic; noted for review)

- **Favor** is a reaction, not the classification's `auto`: the book says "you can choose". The start Favor (D5 session
  start) and the tribute downtime move (the rest move in `convex/lib/restHooks.ts`) stay out of combat.
- **Patron's Pact** adds the rolled die to the roll (a fold). It does not go through D5's held Patron Die. Both paths spend
  the same `classState.favor`, and the Party sheet's D5 class action still works.
- **Dark Aegis:** the damage is still taken, so its severity still counts (Patron's Mantle ends on Severe), but no HP are
  marked. This is written as "4 fewer", because 4 is the most one hit marks (CB p.91).
- **Draining Bane:** "you can clear a Stress" is an `optional` step (the player ticks it).
- **Harrowing Invocation:** the Stress on a failed attack is a second use (`failed`, auto, no cost) gated on the tag the
  first use puts on the attacker for its next roll. **SD4 requirement:** match `failed` triggers before the roll's
  `nextRoll` effects and tags end.

## Manual steps

1. Patron's Mantle: "advantage on action rolls to intimidate a target" (bead dcm-733).
2. Otherworldly Ire: picking the targets after the dice and marking their HP (bead dcm-gov).

## Vocabulary gaps (beads, labelled `feature-effects vocabulary-gap`)

- dcm-a9n: `afterYouRoll` cannot say "success with Hope" (Favor, Diminish My Foes use a check box instead).
- dcm-733: a lasting advantage on one kind of action roll (Patron's Mantle).
- dcm-gov: targets picked after dice rolled in the same use (Otherworldly Ire).
- dcm-ffk: `attackSucceeds` cannot name the weapon (Menacing Reach ends on any successful attack).

## Tests

`tests/unit/feature-effects/warlock.test.ts` (18 tests, all through `runFeature`):
- One entry per classified Warlock feature, none extra, no duplicates. Source, owner and card match `owned()` for a
  mastery warlock of each pact. Every Favor cost comes from the Favor pool and is refused at 0 Favor.
- One test per feature with values worked out by hand from the text: Deathless Embrace 4, 2, 6 → 2 HP (d8 at level 5);
  Damage Sink 27 → 14 and 26 → 13; Deadly Vengeance 3 HP, dice 4, 6, 1 → the attacker marks 2 HP; Patron's Fury tier 2,
  dice 3 + 5 → +8, refused when inactive; Patron's Pact d6 / d8 and the sphere check box; Mantle +3 thresholds at tier 3;
  limits (rest / long rest keys) and availability.

## Checks

- `pnpm lint` and `pnpm typecheck` are clean.
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-warlock` passes.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 300 files pass; 7905 tests pass, 1 is an expected fail. **One
  failure is outside this tracer's owns:** `tests/unit/feature-classification.test.ts` ("has the twelve group tables,
  empty until their FE tracers fill them") asserts every table is empty and `FEATURE_EFFECTS.size` is 0. Every FE tracer
  breaks it. The orchestrator should drop the emptiness assertions when it merges the first FE tracer.
