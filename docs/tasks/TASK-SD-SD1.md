# TASK SD1: Feature runner, ownership, upgrades and D5 delegation (pure)

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD1 (wave 2, depends on SD0). Bead `dcm-bxp.99.19`. Status: Review.

Pure functions say which features a sheet holds and with which upgrades, check their availability and costs, and run a
feature use (SD0's vocabulary NV1-NV19 and D5 delegation included) into the same `RunPlan` the card server executes. No
Convex function, schema, validator or UI change; the server path is SD3's.

## User answers implemented

- **Q3 (a)** rest / long rest reset limits, the session does not: feature limits are stored with their own period.
- **Q4 (a)** "on a success" consumes only on a success (`limitConsumed`, shared with the cards).
- **Q5 (a)** known stances are owned features (`stance:martial-artist:<slug>`); Focus is a cost pool and a resource step;
  `activeStance` is an engine-read state check.
- **Q6 (a)** every halving rounds up: "halve incoming damage" against a known incoming amount folds the halved amount
  rounded up (27 → 14). See open point 1 for the resistance half of Q6.
- **Q7 (a)** "once per scene": feature limits are stored as `until: "scene"`; the reset label is "Back after the scene".
- **Q10 (a), Q11 (a)** the Beastform's features while transformed and the transformation's features are owned.
- **Q13 (a)** a `situation` requirement with a `check` is decided by the engine when it knows the fact; otherwise the
  player's check box decides. Dedicated comes only from the Orderborne community (`owned` reads `communityId`).
- **Q4 / Q12 / Q14 / Q16** as plan pieces: the companion recipient and `actorKind`, the named `help` step, the `area`
  step, the `flying` fact.

## What changed

| File | What |
|------|------|
| `src/lib/domain/combat-actions/numbers.ts` | `NumberEnv.dieSides`; `resolveDice` reads `DiceExpr.sidesOf` (the actor's class die, else `sides`); a `dice` source with `keep: "countAtLeast"` counts the dice at or above `atLeast` (all dice without it), plus `plus`. |
| `src/lib/domain/card-effects/availability.ts` | `keyAvailability(sheet, key, limit)` (cards and features share it; `cardAvailability` calls it); `scene` is the shortest reset; `featureLimitUntil` (scene stays scene; cards keep `limitUntil`, scene → session, unchanged); `StateFacts` / `CreatureFacts` on `RequirementState.facts` and `stateCheckMet` for all ten `StateCheck` kinds; `situation` uses the check when decidable; `PaidCost.pool` / `.values` and `PayerState.favor / focus / heldDice`: pooled `tokens` costs are resolved and checked per pool (a short pool reads as `tokens`). |
| `src/lib/domain/card-effects/run.ts` | Executes NV1-NV19 (table below). Optional widenings only: `ActorState` (`favor`, `focus`, `heldDice`, `dieSides`, `facts`), `RunContext` (`limitKeys`, `delegate`, `companion`, `damageDice`, `dieIndexes`), `RunPlan` (`holdLimit`, `actorKind`), `ActorResources` (`favor`, `focus`, `heldDice`), `ResolvedMod.stat.versus`, condition / effect plan steps (`endsOn`, `option`); new plan steps `delegate`, `resource`, `area`, `help`. Exports `stepDie`, `DelegateHandler` and its types, `HeldDieState`. |
| `src/lib/domain/feature-effects/owned.ts` | `owned(sheet, scope)`, `activeBeastformId(sheet)`, `holdingsFor(sheet, held, owner)`. |
| `src/lib/domain/feature-effects/upgrades.ts` | `upgradeHolds`, `activeUpgrades`, `patchUse`, `applyUpgrades`, `upgradedDieSides`. |
| `src/lib/domain/feature-effects/delegate.ts` | `delegatedKeys`, `delegateFeature`, `delegatedExhaustion`, `heldDiceState`, `createDelegator`. |
| `src/lib/domain/feature-effects/run.ts` | `runFeature(effect, useId, context)`, `featureLimitKey` / `featureLimitKeys`, `asCardEffect`, `featureAvailability`, `featureCostShort`, `actorExtras`. |
| `src/lib/domain/feature-effects/index.ts` | The engine barrel (types, ids, owned, upgrades, delegate, run). |

### How each vocabulary piece runs (run.ts)

| Id | Execution |
|----|-----------|
| NV1 | `tokens` costs with `pool` spend `actor.favor` / `actor.focus` / held dice of that kind (a stored value counts as is, an unrolled die is rolled); `spent: favor / focus / heldDie` read them (heldDie = the spent dice's total). `resource` step: gain / lose / set, Focus capped at 6 (HF p.12), Favor at the sheet's 99. `sidesOf` via `actor.dieSides`. |
| NV2 | `delegate` step: params resolved (`choice`, `choiceFrom` → the player's option, `amount`, `targetId` = the first other recipient, `dieIndexes`). With `context.delegate` the D5 feature runs in the plan and the actor takes back hope, stress, HP, armor, Favor, Focus, held dice and feature uses, plus its Fear; a D5 refusal refuses the use (`choice`). Without a handler the plan carries `{kind: "delegate", done: false}` for the server. |
| NV3 | Applied by `runFeature` before the use runs (`applyUpgrades`). |
| NV4 | `adjustHpMarked` → fold with the amount. |
| NV5 | `endsOn` on the condition and effect plan steps (and on areas). |
| NV6 | Triggers are matched by the reaction window / rider pass (SD4, SD5); the runner runs the use once triggered (`context.trigger`). |
| NV7 | `situation.check` through `actor.facts`; gates `requires` read them too; `effect.option` on the plan's effect step; the new flags pass as mods. |
| NV8 | Damage dice changes on this move's damage: `rerollChosen` (`below`, or the picked dice), `doubleDice` (matching / picked), `addWeaponDie`, `extraDie` (drop the lowest), `ones` (`asMax` / `add`), `dieSize` (before the roll), `add.type` (a different type makes the total `both`). Before the damage roll they wait for it; after it they change the damageRoll entry and the pending damage by the difference; with no damage of the use's own they are folds. Roll changes are folds, `dieBonus` with its amount. |
| NV9 | `versus` stays on resolved stat / advantage / disadvantage mods. |
| NV10 | `rangeSteps` and the range mods pass through for the server's range check (unchanged). |
| NV11 | `area` plan step: the spec with mods resolved, `centreId` (the actor, the first target, or null for a square). |
| NV12 | `countAtLeast` (numbers.ts). |
| NV13 | `use.actor: "companion"` → `plan.actorKind`; a `picked` recipient with `pick.companion` is `context.companion`. |
| NV14 | Adversary-side mods and flags pass through. |
| NV15 | A trait mod with `choice` takes the player's pick (a trait id) from `context.options`; `holdLimit` → `plan.holdLimit`. |
| NV16 | `context.limitKeys.until` (the feature runner stores `scene`). |
| NV17 | `replaceHopeGain`: takes back one Hope this move's roll gave, then +1 Favor or −1 GM Fear; on another roll (or no Hope gained) a fold. |
| NV18 | `addTargets` → fold with the count. |
| NV19 | `help` plan step per recipient `{die, free}`. |

## Book passages checked (printed pages)

- CB p.107, Spending Resources: "Unless an effect states otherwise, you can't spend Hope or mark Stress multiple times on
  the same feature to increase or repeat its effects on the same roll. … However, on an effect like the Guardian's Hope
  Feature, which says 'Spend 3 Hope to clear 2 Armor Slots,' you can spend 6 Hope to clear 4 Armor Slots, because this
  effect isn't applying its bonus to a specific roll—you're just activating the feature more than once." (`times`.)
- CB p.107, Rounding Up: "if you need to round to a whole number, round up unless otherwise specified." CB p.99: "when your
  character deals 26 physical damage to a creature with physical resistance, the creature only takes 13 physical damage."
- CB p.107: "When a feature allows you to reroll a die, you always take the new result."
- CB p.111, Multiclassing: "When you multiclass, you get to choose an additional class, select one domain from that class,
  and gain access to their class feature. … then choose a foundation card from a subclass of your choice." Tip: "you
  can't gain the mastery card for any subclass." CB p.110: "If you have only the foundation card, take a specialization.
  If you have a specialization already, take a mastery."
- CB p.71, Mixed Ancestry: "You must choose the first feature from one ancestry and the second from another."
- HF p.38, Only Skin Deep: "You gain the benefit of only one of your chosen ancestry's features, which you select when you
  choose the ancestry."
- CB p.28, Rally: "At level 1, your Rally Die is a d6. … At level 5, your Rally Die increases to a d8." CB p.29, Epic Poetry:
  "Your Rally Die increases to a d10." CB p.28, Virtuoso: songs "twice per long rest". CB p.51: Fueled by Fear "increases
  to 2d10", Have No Fear "to 3d10". HF p.8: Ambush "uses d6s instead of d4s", Backstab "d8s instead of d6s". CB p.31,
  Regenerative Reach: "within Very Close range". CB p.44, Devout: "twice instead of once per long rest". CB p.45, Power of
  the Gods: "1d12 damage instead of 1d8". HF p.9: Poison Compendium and Venomancer poisons.
- HF p.14, Deathless Embrace: "spend any number of Favor to roll an equal number of Patron Dice. For each result of 4 or
  higher, clear a Hit Point." HF p.14, Favor: "gain a Favor instead of a Hope". HF p.12: "You can hold a maximum of 6 Focus."

## Tests

- `tests/unit/card-effects/run-nv.test.ts` (35): NV1 pools (Favor, Focus, Prayer Dice values, refusals), the resource
  step caps, `sidesOf`; NV12 Deathless Embrace (4, 2, 6 → 2 HP); NV2 with and without a handler and a refusal; NV4, NV18,
  roll-change folds; Q6 halving 27 → 14 and the book's 26 → 13; NV8 every dice change before and after the roll (Deadly
  Raptor 16, Sacred Resonance 17, Weapon Specialist, Aggressive, Exacting, Rampage, Mythic Beast d10, Face Your Fear
  `both`); NV5 / NV7 / NV9 / NV14 / NV15 pass-through; every `StateCheck`; NV11 areas, NV13 companion, NV17 Favor and
  Ethereal Visage, NV19 help; limit keys (`scene` for features, cards unchanged); `keyAvailability` and pooled costs.
- `tests/unit/feature-effects/engine/owned.test.ts` (12): ranks, multiclass (no Hope feature, foundation only), every
  class × subclass × rank only yields classified features, mixed and shapeshifter ancestry, transformations, Dedicated,
  Beastform from the sheet effect and the scope, stances, the Hope & Fear option, `holdingsFor`.
- `tests/unit/feature-effects/engine/upgrades.test.ts` (11): one per upgrade (Virtuoso, Fueled by Fear / Have No Fear,
  Ambush / Backstab, Rally d8 / d10, Regenerative Reach, Devout, Power of the Gods, Poison Compendium / Venomancer,
  extra steps) plus `upgradeHolds`.
- `tests/unit/feature-effects/engine/delegate.test.ts` (8): real D5 features through `runFeature`: Rally (d10 dice for the
  bard and the ally, `rally` key), the exhausted `rally`, `unstoppable`, `channelRawPower` and `commune` keys, Beastform
  (Stress paid first, D5 refusal), Patron's Pact (Favor back to the runner).
- `tests/unit/feature-effects/engine/run-feature.test.ts` (7): Frontline Tank twice (6 Hope → 4 Armor Slots, CB p.107),
  repeat refusals, `feat:` keys (main, use, per target), every `until` incl. `scene`, Q4, `featureAvailability`,
  `featureCostShort`, `actorExtras`, the barrel.
- Every existing run / availability / numbers / adversary test passes unchanged.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 300 files, 7888 passed, 1 expected fail.
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml SD1`: OK.
- No e2e is named. `convex/_generated` and `tsconfig.json` untouched.

## Open points and follow-ups (no game mechanic decided here)

1. **Q6 resistance rounding.** Q6 (a) says resistance halving rounds up too, but resistance is halved in
   `src/lib/domain/encounters/damage.ts` (`damageTaken`, `Math.floor`), which no sheet-drawer tracer owns. SD1 rounds up
   only the feature halving it runs. The orchestrator should give that file (and its tests) to a tracer.
2. **Devout's extra Prayer Die** ("roll an additional die and discard the lowest", CB p.44) happens in D5's
   `onSessionStart` (seraph.ts), which no `UpgradePatch` field reaches; Sparing Touch's twice per long rest is a
   `limitTimes` upgrade. Needs a D5 / SD8 change.
3. **Epic Poetry on the D5 panel.** Through `runFeature` the delegated Rally Dice take the upgrade's d10; the Party sheet's
   D5 `classFeatures.use` path still gives d6 / d8, and D5's feed line says "(d6)". SD3 can rebuild the summary.
4. Per-target feature keys append the target id to `feat:<featureId>[:<useId>]`; a long Convex id can pass the 80-character
   `featureUses` key cap for the longest feature ids. No current feature has a per-target limit; SD3 should check.
5. `owned()` reads the active Beastform from D5's `beastform` sheet effect text (D5 stores no form id); `scope.beastformId`
   overrides it. A stored form id (D5 / SD3) would be sturdier.
