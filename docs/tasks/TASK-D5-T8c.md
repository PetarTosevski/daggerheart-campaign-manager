# TASK-D5-T8c: Class features for the four Hope & Fear classes

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T8c (wave 3), on T0's hook contract and T8a's registry and dispatcher (`docs/tasks/TASK-D5-T8a.md`). Only the four class files changed.

## What works

| Class | Feature | Book | Automation |
|---|---|---|---|
| Assassin | Marked for Death | HF 8 | class action, 1 Stress, needs the latest roll to be a successful action roll; effect `until: "rest"` (End button = defeated or GM spent Fear); damage roll option +tier d4 (Executioners Guild: d6, d8 at mastery) |
| Assassin | Get In & Get Out | HF 8 | class action, 1 Hope; the dice box offers advantage on the next action or reaction roll once (`featureUses` mark `getInGetOut`) |
| Brawler | I Am the Weapon | HF 10 | weapon override `brawlersStrike` while the primary is Brawler's Strike and no secondary: Proficiency d8 + Proficiency d6, `critBase` 14 × Proficiency (settled rule: maximum plus a roll), `evasionBonus` 1 |
| Brawler | Combo Strike | HF 10 | class action, 1 Stress, on the latest damage roll: Combo Die (`classState.comboDie`, default d4) rolled until a result is lower than the one before; every result added as `extra` dice (once per roll; chain capped at 20) |
| Warlock | Favor | HF 14 | `classState.favor`, unset reads as 3 and session start writes 3; Tribute (class action, once per rest) gains max(0, Spellcast trait); "Favor instead of Hope" trades the Hope of the latest success with Hope (once per roll), with a dice-box reminder prompt |
| Warlock | Patron's Pact | HF 14 | class action spends a Favor and holds the Patron Die (`heldDice` kind `patron`, d6, d8 from level 5); the next action roll's option adds it |
| Witch | Hex | HF 16 | class action, 1 Stress; `classState.hexes` (name from `params.choice`, else "Target N"), at most Spellcast trait; "Clear Hexes" ends them, rests and session end clear them |
| Witch | Commune | HF 16 | class action, once per long rest: Spellcast-trait d6s (free roll in the feed) and the chart line of the best result |

All of them are offered only with the campaign's `hopeAndFear` option (the dispatcher and the features panel check `classFeaturesAvailable`).

## Tests

- `tests/unit/class-features-hf.test.ts` (12): gating, every feature above.
- `tests/convex/class-features-hf.test.ts` (6): Favor spend and the Patron Die on an action roll, tribute once per rest, Brawler crit (manual dice: 28 + roll) and Combo Strike, refusal with the option off, Commune reset on a long rest only, Hex cleared by a rest.
- `tests/e2e/class-features-hf.spec.ts` (1): a level-2 Brawler without a weapon rolls Brawler's Strike with 2 d8 and 2 d6.

## Follow-ups outside this tracer's files

See the T8c report: override `evasionBonus` is not read by derived Evasion; rolls and the dice box do not filter roll options and overrides by `hopeAndFear`; the Brawler's Strike weapon entry scales only the d8; the panel has no text input for `params.choice`; roll options cannot consume an effect; Tribute is not a rest move; the Combo Die advancement is not in level-up.
