# TASK CA1: Combat engine and card-effect runner (pure)

Plan `.omc/plans/combat-actions.yaml`, tracer CA1 (wave 2). Analysis: `.omc/autopilot/combat-actions-analysis.md`
(git-ignored). Book pages are printed pages; CB = Core Book, HF = Hope & Fear. Everything here is framework-free
TypeScript with relative imports, so Convex (CA3, CA4), the map UI (CA5), the sheet (CA7), the domain tables (CE-*) and
the adversary engine (AA1) share it.

## What landed

| File | What |
|------|------|
| `src/lib/domain/combat-actions/distance.ts` | `tokenDistance`, `bandOf`, `withinRange`, `rangeCheck`, `rangeFromWeapon`, `RANGE_ORDER` |
| `src/lib/domain/combat-actions/sight.ts` | `lineOfSight` (line of sight and cover) |
| `src/lib/domain/combat-actions/hits.ts` | `resolveHits` |
| `src/lib/domain/combat-actions/damage.ts` | `Combatant`, `applyDamageTo`, `applyStressTo`, `applyHpTo`, `clearTrack`, `resistanceAgainst` |
| `src/lib/domain/combat-actions/numbers.ts` | `NumberEnv`, `resolveNumber`, `resolveDice`, `rollDice` |
| `src/lib/domain/combat-actions/index.ts` | Re-exports the five modules above |
| `src/lib/domain/card-effects/availability.ts` | Once-per keys and availability, requirements, costs |
| `src/lib/domain/card-effects/run.ts` | `run(effect, context)`: the card-effect runner; `pickUse`, `rollMatches`, `rollD20` |
| `tests/unit/combat-actions/*.test.ts`, `tests/unit/card-effects/run.test.ts` | 87 unit tests |

Reused, not copied: `rangeBandOf` / `RANGE_SQUARES` (combat-map/ranges.ts), `los`, `prepareMap` and `SAMPLES_PER_SQUARE`
(combat-map/vision.ts), `sightOf` / `blockRadiusFactor` (combat-map/sight.ts), `damageTaken`, `damageSeverity`,
`hpForDamage`, `markHp`, `markStress`, `isDefeated` (encounters/damage.ts), `rollDuality`, `dualityEffects`,
`rollDamage`, `weaponDice` (dice/index.ts), `parseDamage` (adversaries/index.ts), `MAX_FEAR` (fear/index.ts), and the
`expire` contract (characters/expiry.ts). The only new geometry is the cover test (segment against an object's circle),
because vision.ts only rasterises blocking objects.

No Convex function, schema, validator or error code changed.

## Rules (quoted, printed pages)

- **R1 attack vs Difficulty** (CB p.96): "The attack is successful against all targets for which the attack roll result
  meets or exceeds their Difficulty." "If a Spellcast Roll can damage a target, it's also considered an attack roll."
- **Critical** (CB p.90): "A critical success counts as a roll with Hope, even if you would've otherwise failed because the
  total is lower than the roll's Difficulty."
- **R2 damage** (CB p.98): "If the attack uses a weapon, you roll a number of your weapon's damage dice equal to your
  Proficiency." Crits: "Start with the highest possible value the damage dice can roll, and then make a damage roll as
  usual, adding it to that value." "Whenever damage would be applied more than once to a creature during a PC's move, the
  damage is always totaled before it's applied to the adversary's damage thresholds." Examples used as tests: Nolan,
  d6+6 at Proficiency 3, rolls 3, 5, 6 "for a total of 20 physical damage"; Rune's critical with a d6+1 wand at
  Proficiency 2: 12 + 4 + 5 + 1 "for a total of 22 magic damage".
- **R3 thresholds** (CB p.91): Severe 3 HP, Major 2 HP, Minor 1 HP; "If you ever reduce incoming damage to 0 or less …,
  you don't mark any HP." CB p.193: adversary thresholds and HP "function the same way they do for PCs." Massive damage
  stays off for adversaries.
- **Minion** (CB p.201): "This adversary is defeated when they take any damage. For every X damage a PC deals to this
  adversary, defeat an additional Minion within range the attack would succeed against."
- **R5 Stress** (CB p.92): "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead
  mark 1 Hit Point."
- **R6 limits** (CB p.101): "Some domain cards have an exhaustion limit that restricts how often you can use that card (for
  example, once per long rest)."
- **R8 Hope features** (CB p.90): "When using a Hope Feature, if you rolled with Hope for that action, the Hope you gain from
  that roll can be spent on that feature."
- **R9 several targets** (CB p.104): "you only make one attack roll and compare its result to the Difficulty of each
  eligible target … roll damage once and apply the total to each target the attack succeeded against."
- **R10 resistance** (CB p.99): "they halve damage of that type before comparing it to their damage thresholds"; example:
  "26 physical damage to a creature with physical resistance, the creature only takes 13"; immunity: "they do not take any
  damage"; "If an attack deals both physical and magic damage, you can only benefit from resistance or immunity if you are
  resistant or immune to both damage types."
- **R11 ranges** (CB p.103, Defined Ranges): "Melee: 1 square • Very Close: 3 squares • Close: 6 squares • Far: 12 squares
  • Very Far: 13+ squares". **Line of sight and cover** (CB p.104): "attack rolls against you are made with disadvantage";
  "You usually can't be targeted if you're entirely behind a substantial structure like a wall".
- **R12 adversary reaction rolls** (CB p.161): "If you meet or exceed the roll's Difficulty, the NPC succeeds".
- **Rounding** (CB p.107): "if you need to round to a whole number, round up unless otherwise specified."
- **GM critical** (CB p.148, used by AA1, tested here through `run`): a 2d8+2 critical rolling 5 and 7 is 16 + 12 + 2 = 30.

User answers implemented: **Q1** out of range is reported, never refused (`rangeCheck(...).inRange === false` → the server
opens a GM sanction). **Q2** line of sight required, cover gives disadvantage (`lineOfSight`). **Q3** one shared
`featureUses` record, rests reset through `expire`. **Q4** "on a success" limits are used up only by a success. **Q6** Minion
extras are offered (`minionOffer`). **Q7** adversary reaction rolls are server d20s with no bonus. **Q9** movement is a
prompt. **U1** nothing here returns a Difficulty or HP to a player; the server decides what each row shows.

## API

### Range and sight (`combat-actions`)

```ts
interface Footprint { x: number; y: number; size?: number }           // top-left square, size 1..3
tokenDistance(a, b): number                                           // squares between nearest edges, diagonal = 1; adjacent = 1, overlap = 0
bandOf(distance): RangeBandKey | "veryFar"
withinRange(band: Range, range: Range | "unlimited"): boolean
rangeCheck(from, to, range: Range | "unlimited"): { distance; band; inRange }  // Q1: inRange false = GM sanction
rangeFromWeapon("Very Close"): Range                                  // srd Weapon.range -> vocabulary Range
lineOfSight(map: PreparedMap, attacker, target, objects?: VisionObject[]): { lineOfSight; cover }
```

`lineOfSight` casts `los` from the attacker's centre to the target's centre and every half-square sample of its footprint.
In sight = any line clear. Cover = every clear line crosses an object whose `sightOf` is `"cover"` (radius `r × blockRadiusFactor`,
like vision's blocking circles); cover standing inside either footprint does not count. Pass the map's objects (the same
list `prepareMap` got). The server turns `lineOfSight: false` into `COMBAT_NO_LINE_OF_SIGHT` and `cover: true` into one
disadvantage (`context.roll.disadvantage`).

### Hits and damage (`combat-actions`)

```ts
resolveHits(total, critical, targets: { id; difficulty }[]): { id; hit }[]   // pass Evasion as difficulty for PCs (AR1)
interface Combatant { id; side: "pc" | "adversary"; difficulty?; evasion?; thresholds: {major|null, severe|null};
  hp; hpMax; stress; stressMax; armor?; armorMax?; defeated; minionX?; resistance?: {physical, magic};
  conditions: string[]; tags?: string[]; flying? }
applyDamageTo(target, amount, type: "physical" | "magic" | "both", { minimumSeverity? }): DamageResult
  // { targetId, incoming, resisted, taken, severity, hpMarked, minionExtra, defeated, after }
applyStressTo(target, n): MarkResult     // overflow past a full track marks 1 HP (R5)
applyHpTo(target, n): MarkResult         // forced HP, no thresholds
clearTrack(target, "hp" | "stress" | "armor", n): { cleared; after }
resistanceAgainst(target, type): "none" | "resistant" | "immune"
```

`applyDamageTo` takes the move's total (R2): immunity, then resistance (halve, round down via `damageTaken`), then
thresholds through `hpForDamage`. A block without thresholds, or a Minion that takes any damage, marks every remaining HP;
a Minion returns `minionExtra = floor(taken / X)`. Build `resistance` from `alwaysOnResistance(id)` (CA2) or, when the GM
toggled a conditional one, from the instance's `resistance`. `after` is the creature to store (hp, defeated).

### Numbers (`combat-actions`)

`resolveNumber(source, env, rng)` resolves every `NumberSource` kind; `resolveDice(expr, env, rng)` gives `{count, sides,
plus}`. `calc.divide` rounds up unless `round: "down"` (CB p.107). `dice` sources roll and set `env.lastRoll`.

### Once-per, requirements, costs (`card-effects/availability.ts`)

```ts
featureUseKey(cardId, useId?, targetId?)  // "card:<id>" ("main" or no use), "card:<id>:<useId>", + ":<targetId>" for perTarget
cardAvailability(sheet, cardId, { useId?, limit?, targetId? }?):
  { state: "ready"; usesLeft? } | { state: "exhausted"; until: "rest" | "longRest" | "session"; label }
RESET_LABEL = { rest: "Back after a rest", longRest: "Back after a long rest", session: "Back next session" }
limitConsumed(limit, success): boolean       // Q4
limitUntil(per): FeatureUse["until"]         // scene -> "session" (see QUESTIONS)
recordUse(featureUses, key, limit): FeatureUse[]
requirementMet(req, state) / unmetRequirements(reqs, state)
resolveCosts(costs, amountOf, pickEither?): PaidCost[]   // flattens `either` to the picked option
unaffordable(paidCosts, payer): resource[]                // Hope, free Stress / HP / Armor slots, tokens, Fear, gold
```

`cardAvailability(sheet, cardId)` needs nothing but the sheet: CA7 greys a card with its `label`. `times: n` limits store one
entry per use and report `usesLeft`. Rests reset cards through `expire` with no new code.

### The runner (`card-effects/run.ts`)

```ts
run(effect: CardEffect, context: RunContext): { ok: true; plan: RunPlan } | { ok: false; reason; detail }
```

`RunContext`: `actor: ActorState` (a `Combatant` plus hope, hopeMax, armor, armorMax, traits after effects, spellcast value,
proficiency, level, tier, loadoutDomains / vaultDomains, armorWorn, activeCardEffects, cardTokens, featureUses, weapons
`{primary?, secondary?}` as `{damage, trait, damageType, range}`), `gmFear`, `useId?`, `targets?`, `picked?`, `allies?`,
`followUp?`, `trigger? {amount?, source?, subject?}`, `choices?` (NumberChoice values), `options?` (choose step id → option
ids), `optionals?` (optional step ids), `eitherCosts?` (option index per `either` cost, in order), `splits?` (creature id →
share), `situations?`, `nearestEnemy?`, `roll? {trait?, weapon?, advantage?, disadvantage?, help?, modifier?, difficulty?}`,
`attackDamage?` (an adversary's standard attack, for AA1), `rng`.

Refusals, before anything is paid, in this order: `noUse`, `requirement`, `exhausted` (→ `CARD_EXHAUSTED`, `detail` is the
reset label), `choice`, `targets` (count exceeded; with an `area`, `count` limits the anchor and is not checked), `cost`
(→ `CARD_COST_UNPAID`, `detail` lists the short resources).

`RunPlan`: `{ cardId, useId, name, activation, steps, roll, hits, success, limit {key, until, consumed} | null, actor {before,
after, featureUses}, creatures [{id, before, after}], gmFearDelta, excluded, exclusive }`. `actor.after` and `creatures[].after`
are the values to store; `actor.featureUses` already holds the limit entry when `consumed`.

`PlanStep` kinds, in the order they happened:

| kind | meaning |
|------|---------|
| `pay` | `phase` upfront / afterRoll / optional, resolved costs, `paid` (an unpaid `pay` stops the rest of its list, CB p.90) |
| `roll` | the duality (or d20) roll: record, outcome, critical, success, withHope, withFear, effects |
| `hits` | hit or miss per target (only for target / Evasion Difficulties) |
| `damageRoll` | one damage roll (cached per expression for the use, R9) and its type |
| `damage` | the move's total applied to one adversary (`DamageResult`) |
| `pcDamage` | damage to a PC, not applied (Armor Slots and thresholds are AA1's reaction window) |
| `mark` / `clear` | HP, Stress, Armor marked or cleared (`overflow`, `noBenefit`) |
| `hope` / `fear` | Hope change for a PC (the actor's is applied); the GM's Fear change (clamped 0..12) |
| `condition` / `clearCondition` | standard condition or tag (with `implies`), duration |
| `effect` | label, mods with numbers resolved, duration |
| `tokens` | op, before, after (card tokens) |
| `toVault` | the card goes to the vault |
| `save` | an adversary's server d20 against the Difficulty (Q7); onFail / onSuccess ran for that creature |
| `check` | a dice check and whether it passed |
| `defeat` / `minionOffer` | defeated outright / extra Minions to offer the attacker (Q6) |
| `prompt` | `move` (Q9), `manual` (the card's words), `choose` / `split` (a choice is missing), `pcSave` (a PC's reaction roll) |
| `fold` | an outcome for another roll or another creature's damage: modifyRoll, redirectDamage, extraArmorSlots, reduceSeverity, reduceDamage, negate, convertMarks, refreshFeature, a rider's modifyDamage; `amount` resolved |

How the runner reads the vocabulary:
- The move succeeds on its roll's outcome against a fixed or GM Difficulty, or when it hits any target against their own
  Difficulty / Evasion (no targets: success). Without a roll every gate on success holds and every target counts as hit.
- The roll's Hope, a critical's cleared Stress and the GM's Fear land right after the roll, so later `pay` steps can use
  that Hope (R8). Upfront `costs` cannot.
- A critical adds the damage dice's maximum to every damage roll of the use (spells that deal damage are attacks, CB p.96),
  except flat damage and reaction rolls.
- Damage of the use is added per creature and applied once: at the end, or before a step that reads the result (gates
  `targetMarkedHp`, `targetDefeated`, `targetStressFull`; `markHp`, `defeat`, clearing HP). `modifyDamage` adds to that
  pending total; before any damage roll, `proficiency` / `reroll` / `maxDice` / `type` change the next roll.
- Per-target gates (`hit`, `miss`, `targetHas`, …) filter `to: "targets"` one by one; on any other recipient they hold when
  they hold for any target.
- A save's half damage and a calc's division round up (CB p.107); resistance rounds down.
- Optional steps with a limit are stored under `card:<id>:<useId>:<optionalId>`.
- Deathrun's "remove a die" removes the lowest remaining die (with a critical, its maximum goes too).

### For the next tracers

- **CA3** (weapon attack): `rangeCheck` with `rangeFromWeapon(weapon.range)`, `lineOfSight`, `resolveHits`, `applyDamageTo`;
  or build a one-use `CardEffect` like the `weaponAttack` fixture in `run.test.ts` and call `run`.
- **CA4** (cards): `cardAvailability`, then `run`; map refusals to error codes; write `plan.actor.after`, `plan.actor.featureUses`,
  `plan.creatures[].after`, `plan.gmFearDelta`; turn `effect` steps into sheet effects / instance effects; post `prompt` steps.
  When a `choose` / `split` prompt comes back, ask and re-run with the same dice (`queueRng` of the recorded values).
- **CA7**: `cardAvailability(sheet, cardId).label`.
- **CE-***: write entries, run them through `run` with `queueRng`, assert steps.
- **AA1**: `rollD20`, `resolveHits` with Evasion, `applyStressTo`, the `fold` and `pcDamage` steps, `adversaryAttack` /
  `standardAttack` already work in `run`.

## QUESTIONS

1. **Rounding of resistance.** CB p.107 says "round up unless otherwise specified"; the plan's acceptance and the tracker's
   existing `damageTaken` round resistance down (27 resisted = 13). Kept round down as the plan says; should resistance
   round up (27 → 14) like every other halving here?
2. **"Once per scene"** cards: the sheet's `featureUses.until` knows only rest, longRest and session, and the GM's End scene
   clears no feature uses, so a scene limit is stored as `session` and comes back at session end, not scene end. Widening
   `FEATURE_USE_UNTIL` with `scene` (and `expire` for the `scene` event) is a CA0-owned change; file it if wanted.
3. **Unmet requirements** have no error code (CA0's codes cover exhausted and cost). CA4 needs one, or maps them to
   `CARD_COST_UNPAID` / `COMBAT_TARGET_INVALID`.
4. **Deathrun's dropped die**: the text says "remove a die from your damage roll" without saying which; the runner removes the
   lowest (best for the player). Confirm, or the player picks.
5. **Cover**: an attacker who can see part of the target past the cover object gets no disadvantage. The book only says
   cover "makes attacking you more difficult (but not impossible)". Confirm this reading.
