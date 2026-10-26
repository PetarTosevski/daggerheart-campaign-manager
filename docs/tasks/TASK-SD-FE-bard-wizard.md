# TASK SD FE-bard-wizard: Feature effects - Bard and Wizard (24 features)

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-bard-wizard (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status:
Review. Book pages are printed pages (CB = Core Book; `===== PAGE N =====` in the text holds printed page N-1). Texts
checked against `.reference-private/text/core.txt`: CB p.28 (Bard, Troubadour), CB p.29 (Wordsmith), CB p.50 (Wizard,
School of Knowledge), CB p.51 (School of War).

Note on pages: the plan's acceptance cites Make a Scene as CB p.29; the book prints it on **p.28** (the Bard page). The
entry cites p.28.

## What landed

| File | What |
|------|------|
| `src/lib/srd/feature-effects/bard-wizard.ts` | `BARD_WIZARD_EFFECTS`: 19 entries (every Bard and Wizard feature classified combat or passive), 21 uses, 6 upgrades. Each entry quotes its feature text with the printed page. Vocabulary unchanged. |
| `tests/unit/feature-effects/bard-wizard.test.ts` | 29 tests: coverage (exactly one entry per combat / passive feature, fails on a missing or extra id; merged into `FEATURE_EFFECTS`; source, owner and subclass card equal `owned()`'s; unique use ids; passive entries have no Use button) and every use run through `runFeature` with `queueRng`, checking costs, limits, rolls, targets, outcomes and upgrades against the text. |
| `docs/tasks/TASK-SD-FE-bard-wizard.md` | This file. |

No entry (classified out of combat or narrative, SD0): Heart of a Poet (social, a roll option under Q15 b),
Prestidigitation (narrative), Prepared, Accomplished, Brilliant (build-time extra domain cards).

## Features and readings

| Feature | Id | Activation | Reading |
|---|---|---|---|
| Make a Scene (CB p.28) | `hope:bard` | action | 3 Hope; one enemy within Close: `distracted` (temporary) and an effect `difficulty -2` (temporary). No roll. D5's `makeAScene` is a stateless assist, so no delegate. |
| Rally (CB p.28) | `class:bard:rally` | action | `delegate` to D5 `rally` (D5 gives the dice and writes `rally` until session; no `limit` here, so it is not counted twice). Upgrades: level 5 d8, Epic Poetry d10 (CB p.29). |
| Gifted Performer (CB p.28) | `subclass:troubadour:gifted-performer` | action ×3 | Uses `relaxing` (you and allies within Close clear 1 HP), `epic` (a target within Close temporarily Vulnerable), `heartbreaking` (you and allies within Close gain 1 Hope); each its own once-per-long-rest limit `feat:…:<song>`. Upgrade: Virtuoso `limitTimes: 2`. |
| Maestro (CB p.28) | `subclass:troubadour:maestro` | auto, `whenYouGiveDie rally` | Runs per ally given a die (trigger subject): `choose` Hope +1 or clear 1 Stress (the ally's pick, dcm-bz8). Not for the bard's own die ("to an ally"). |
| Virtuoso (CB p.28) | `subclass:troubadour:virtuoso` | passive | Marker; the upgrade lives on Gifted Performer. |
| Rousing Speech (CB p.29) | `subclass:wordsmith:rousing-speech` | action | Once per long rest; every ally within Far (not you) clears 2 Stress. |
| Eloquent (CB p.29) | `subclass:wordsmith:eloquent` | action | Once per session; one ally; `choose`: mundane object (manual), Help an Ally without Hope (`help` d6, `free`), extra downtime move (manual, gap). Upgrade: Epic Poetry makes the Help die a d10. |
| Epic Poetry (CB p.29) | `subclass:wordsmith:epic-poetry` | passive | Mod `set helpDie 10` (Q12, read by SD-H's named Help); the Rally d10 is Rally's upgrade. |
| Not This Time (CB p.50) | `hope:wizard` | reaction, `whenCreatureAttacked {subject: selfOrAlly, attackerWithin: far, stage: succeeded}` | Q3 (a): any adversary hit's window, attacker within Far of the wizard. 3 Hope; `choose`: `attack` → fold `modifyRoll reroll all` on the attacker, `damage` → fold `modifyDamage reroll atMost 20` on the attacker (every damage die rerolled; the new result stands, CB p.107). |
| Strange Patterns (CB p.50) | `class:wizard:strange-patterns` | auto, `afterYouRoll any` | `choose` Hope / Stress, each a `delegate` to D5 `strangePatternsBenefit` with the roll (`delegateRoll`); D5 checks the number on a Duality Die and the once-per-roll claim. The number itself is set on the sheet (D5 `strangePatterns`, changeable at a long rest: out of combat, no use here). |
| Adept (CB p.50) | `subclass:school-of-knowledge:adept` | rider, `whenYouUseExperience` | Cost 1 Stress; fold `experience payWithStress double`. |
| Perfect Recall (CB p.50) | `subclass:school-of-knowledge:perfect-recall` | action | Once per rest; manual step (gap dcm-bxp.99.19.1). |
| Honed Expertise (CB p.50) | `subclass:school-of-knowledge:honed-expertise` | auto, `whenYouUseExperience` | `check` 1d6 total ≥ 5 → fold `experience freeOnCheck`. The d6 is rolled by the runner, so the change carries no `check` of its own. |
| Battlemage (CB p.51) | `subclass:school-of-war:battlemage` | passive | Marker without mods: the +1 HP slot is already derived (`src/lib/domain/characters/slots.ts`). |
| Face Your Fear (CB p.51) | `subclass:school-of-war:face-your-fear` | auto, `whenYouAttack successWithFear` | `modifyDamage add 1d10 magic` to the targets (on the attack's own damage the total becomes `both`). Upgrades: Fueled by Fear 2d10, Have No Fear 3d10. |
| Conjure Shield (CB p.51) | `subclass:school-of-war:conjure-shield` | passive | `situation` "at least 2 Hope" with `check: hopeAtLeast 2` (engine-read, no box); mod `evasion + proficiency`. |
| Fueled by Fear (CB p.51) | `subclass:school-of-war:fueled-by-fear` | passive | Marker; upgrade on Face Your Fear. |
| Thrive in Chaos (CB p.51) | `subclass:school-of-war:thrive-in-chaos` | rider, `whenYouAttack success` | Cost 1 Stress; `adjustHpMarked more 1` on the target (NV4: after the thresholds). |
| Have No Fear (CB p.51) | `subclass:school-of-war:have-no-fear` | passive | Marker; upgrade on Face Your Fear. |

## Manual steps

- **Eloquent, mundane object**: "Allow them to find a mundane object or tool they need." Fiction; a manual step is the
  right home (no gap).
- **Eloquent, extra downtime move**: "Give them an additional downtime move during their next rest." Gap
  **dcm-bxp.99.19.2** (no rest-flow grant in the vocabulary).
- **Perfect Recall**: "Once per rest, when you recall a domain card in your vault, you can reduce its Recall Cost by 1."
  Gap **dcm-bxp.99.19.1** (no recall trigger, no Recall Cost change). The use records the once-per-rest limit; the table
  marks 1 fewer Stress on the recall.

## Vocabulary gaps (beads, label `feature-effects vocabulary-gap`)

- `dcm-bxp.99.19.1` Perfect Recall: a `whenYouRecall` trigger and a Recall Cost change.
- `dcm-bxp.99.19.2` Eloquent: a step granting an extra downtime move at the next rest.

## For SD3 / SD4 / SD5 / SD-H (how the entries expect to be run)

- **Rally**: no `limit` on the entry; D5's `rally` key is the limit (`delegatedExhaustion`). The SD1 follow-up (D5 feed
  line "(d6)" vs the upgraded d10) still stands for SD3.
- **Maestro**: an `auto` use with the `whenYouGiveDie rally` trigger, run once per ally who got a Rally Die (the ally as
  `trigger.subject`); the ally picks `benefit` (`hope` / `stress`). Without a pick the plan carries a `choose` prompt.
- **Not This Time**: SD4 folds `modifyRoll reroll all` into the attacker's attack roll (the hit may become a miss) and
  `modifyDamage reroll atMost 20` into the attacker's damage roll (every die rerolled, the new total stands). The wizard
  sees only hit / miss and, for their own PC, the new damage (U1, Q14).
- **Strange Patterns**: needs `sheet` and `delegateRoll` (the roll that showed the number); D5 refuses a roll without
  the number or one already claimed.
- **Adept / Honed Expertise**: folds on the roll that uses the Experience. Adept's Stress is the use's cost, so the roll
  engine must not mark another one for `payWithStress`; Honed Expertise's d6 is already rolled (`check` plan step).
- **Thrive in Chaos**: a rider offered after the damage roll (Q1's after-roll step), before the damage is applied.
- **Face Your Fear**: automatic on a success with Fear; on the attack's own damage the magic dice join the total (type
  `both`, CB p.99).
- **Eloquent's Help** and **Epic Poetry's `helpDie`**: SD-H's named Help reads the `help` plan step (`free: true`) and the
  passive `helpDie` mod.
- **Make a Scene**: the condition and the -2 Difficulty effect are two temporary items; the GM clears both in the tracker
  (no "ends with the condition" link in the vocabulary; same as the domain cards' temporary conditions).

## Tests

`tests/unit/feature-effects/bard-wizard.test.ts` (29): coverage (19 ids equal the classification's combat / passive Bard
and Wizard rows; registry merge; `owned()` agreement on source, owner and card; passive entries have no Use button);
Make a Scene (3 Hope, Distracted, Difficulty -2, refusal under 3 Hope); Rally d6 / d8 at level 5 / d10 with Epic Poetry
from real sheets, D5's `rally` key and its exhaustion; Gifted Performer's three songs, one limit each, twice with
Virtuoso; Maestro's per-ally pick; Rousing Speech (allies only, once per long rest); Eloquent (free d6 Help, d10 with
Epic Poetry, manual options, session limit); Epic Poetry's `helpDie`; the four passive markers; Not This Time (Q3
trigger, both rerolls as folds on the attacker, 3 Hope); Strange Patterns through D5 (Hope, Stress, claimed roll, no
number); Adept; Perfect Recall (limit, rest reset label); Honed Expertise (5 passes, 4 fails); Face Your Fear 1d10 / 2d10
/ 3d10 by rank and on an attack's own damage; Conjure Shield (2 Hope met, 1 unmet, Evasion + Proficiency); Thrive in
Chaos (Stress, one more HP).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 301 files, 7916 passed, 1 expected fail, 1 failed: SD0's
  `feature-classification.test.ts` "empty until their FE tracers fill them", which expects this table empty (on `rebuild`
  that assertion is already replaced; not this tracer's file).
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-bard-wizard`: OK.

## QUESTIONS

None left open. Every feature's automation follows the book text and the binding answers (Q1, Q3, Q4 (a) "on a
success", Q12, Q13); the readings above that are engine choices (not game mechanics) are listed for SD3 / SD4 / SD5 /
SD-H.
