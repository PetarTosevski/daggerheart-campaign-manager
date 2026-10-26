# TASK AA1: Adversary-action engine and reaction window (pure)

Plan `.omc/plans/combat-actions.yaml`, tracer AA1 (wave 3, depends on AA0 and CA1). Analysis:
`.omc/autopilot/combat-actions-analysis.md` Part B (git-ignored). Book pages are printed pages; CB = Core Book.
Everything here is framework-free TypeScript with relative imports, so the server (AA2), the Encounter tab and map UI,
and the feature tables (AE-*) share it.

User answers implemented (binding):
- **Q13** "The hit PC's player chooses whether to mark an Armor Slot; the damage waits for that choice. Allies may respond
  with their abilities (e.g. 'I Am Your Shield', CB p.341): a reaction window after each adversary hit" -> `window.ts`.
- **Q14** players see that they were hit, not the roll; the hit PC sees the damage and its severity against their own
  thresholds -> `targetPrompt` / `armorPreview` return only the PC's own numbers; `attackTotal` is for the engine only.
- **Q17 (a)** "the reaction window closes when the target chose armor and every eligible ally answered Use/Pass; the GM
  can 'Resolve now' anytime; no timer" -> `awaiting`, `isComplete`, `resolveNow`.
- **Q18 (a)** "with no live map the GM targets PCs from the party list with no range or line-of-sight restrictions" ->
  every range test passes when the band is unknown.
- **Q19 (a)** "Fear spent only on the GM's tap; Fear-cost features and a second spotlight ask first; optional ones are a
  one-tap prompt defaulting to No; Fear gains automatic" -> `run` refuses with `confirmFear` until `fearConfirmed`;
  `optional` steps run only when listed; `auto` uses run without asking; `spotlightCost`.

## What landed

| File | What |
|------|------|
| `src/lib/domain/adversary-actions/attack.ts` | `adversaryAttack`, `parseAttackModifier`, `adversaryDamage`, `criticalBonus`, `standardAttackDamage` (Horde X), `groupAttackDamage`, `formatDamage`, `damageTypeOf` |
| `src/lib/domain/adversary-actions/severity.ts` | `pcSeverity`, `stepDown`, `hpForSeverity`, `armorOptions`, `damageBeforeArmor`, `armorPreview`, `applyHitToPc` |
| `src/lib/domain/adversary-actions/features.ts` | requirements, `passiveSummary`, `matchesTrigger` / `triggeredUses`, `spotlightCost`, `adversaryNumberEnv` |
| `src/lib/domain/adversary-actions/window.ts` | the reaction window: `openWindow`, `respond`, `awaiting`, `isComplete`, `resolveNow`, `resolveWindow`, `eligibleCards`, `foldsFromPlan`, `runReactionCard`, `targetPrompt` |
| `src/lib/domain/adversary-actions/index.ts` | re-exports the four modules |
| `src/lib/domain/adversary-effects/run.ts` | `run(featureEffect, context)`, `runStandardAttack`, `standardAttackEffect`, `adversaryFeatureUseKey`, `upfrontFear` |
| `convex/lib/validators/encounters.ts` | widen only: optional `tokens: number` on `encounterAdversaryFields` (stat-block tokens) |
| `tests/unit/adversary-actions/*.test.ts` | 59 unit tests |

Reused, not copied: CA1's card runner (`card-effects/run.ts`: `run`, `rollD20`), `resolveHits`, `resistanceAgainst`,
`resolveNumber`, `withinRange`, `cardAvailability` / `resolveCosts` / `unaffordable`; `damageSeverity` and `markStress`
(characters/index.ts); `damageTaken`, `hordeHalved` (encounters/damage.ts); `spotlightCostsFear` (encounters/spotlight.ts);
`parseDamage`, `maxDamage` (adversaries/index.ts); `rollDamage` (dice). The vocabulary types (AA0) are unchanged.

No Convex function or error code is added. The only schema change is the optional `tokens` field (rule 7: widen; old rows
read back unchanged). `docs/data-model.md` is the orchestrator's: add `encounterAdversaries.tokens?: number`.

## Rules (quoted briefly, printed pages)

- **AR1** (CB p.160): "You make your attack roll with a d20. If the adversary has advantage or disadvantage on the attack,
  add an extra d20 to that roll." "You can also spend a Fear to add an adversary's Experience to the roll's result." "If
  the attack meets or beats that value, it is successful". CB p.161: "roll an extra d20 and take the highest result …
  use the lowest result."
- **AR2** (CB p.148): "Whenever you roll a 20 on the d20, your roll automatically succeeds. … Start with the highest
  possible value the damage dice can roll, and then make a damage roll as usual, adding it to that value."
- **AR3** (CB p.91): Severe 3 HP, Major 2, Minor 1; "If you ever reduce incoming damage to 0 or less …, you don't mark any
  HP. When you mark your last Hit Point, you must make a death move."
- **AR4** (CB p.114): "reducing the severity of the damage by one threshold (Severe to Major, Major to Minor, Minor to
  Nothing). Each time your character takes damage, you can only mark 1 Armor Slot." Example: "If an adversary hits Rune
  for Major damage, Miles can mark an Armor Slot to reduce that to Minor instead." CB p.99: "Direct damage is … damage that
  Armor Slots can't be used to reduce." CB p.195: "the target must mark an Armor Slot without gaining its benefit".
- **AR5** (CB p.92): "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead mark
  1 Hit Point." CB p.194: "'mark a Stress,' meaning you mark 1 Stress on the adversary".
- **AR6** (CB p.194): "For an adversary to use an action, they must have the spotlight. Passives and reactions typically
  don't require the spotlight." "you must spend Fear as described, even if you already spent a Fear to spotlight the
  adversary." CB p.153: "You can spend a Fear to make an additional GM move, shifting the spotlight to another adversary."
- **AR7** (CB p.161): "By default, an adversary can only hit one target with their standard attack. … you make one attack
  roll and ask if it hits any of the targets."
- **AR8** (CB p.195): reactions "don't take effect until their specific trigger occurs … you don't have to spend Fear to
  interrupt the PCs with this reaction (unless otherwise specified)."
- **AR9** (CB p.201): "make one shared attack roll. On a success, they deal X damage each. Combine this damage."
- **AR10** (CB p.199): "When the Horde has marked half or more of their HP, their standard attack deals X damage instead."
- **I Am Your Shield** (CB p.341): "When an ally within Very Close range would take damage, you can mark a Stress to stand
  in the way and make yourself the target of the attack instead. When you take damage from this attack, you can mark any
  number of Armor Slots."

Book examples used as tests: CB p.148 2d8+2 critical rolling 5 and 7 = 30 (both `adversaryDamage` and the standard attack
through `run`); CB p.114 Rune's Major with one Armor Slot = Minor, leaving 1 free slot.

## API

### Attack and damage (`adversary-actions/attack.ts`)

```ts
adversaryAttack(atk: number | string, adv: { advantage?; disadvantage? }, experienceBonus: number,
  targets: { id; evasion }[], rng): { record; natural; total; critical; hits: { id; hit }[] }
  // one d20 (two with adv/dis, kept high/low; they cancel 1:1) + ATK + experience; "+2d4" dice roll after the d20s
parseAttackModifier(3 | "+3" | "−1" | "+2d4"): { flat; dice: { count; sides } | null }
adversaryDamage(text, critical, rng): { record; type: "physical" | "magic" | "both"; direct } | null   // crit = max + roll; flat damage isn't rolled
criticalBonus(text): number
standardAttackDamage(printed, { hp, hpMax }, hordeX, { add?, type?, direct? }?): string   // Horde X once half the HP is marked
groupAttackDamage(x, groupSize): number
formatDamage(parsed): string; damageTypeOf(parsed)
```

### Damage to a PC (`adversary-actions/severity.ts`)

```ts
interface PcDefense { id; thresholds: { major; severe }; hp; hpMax; stress; stressMax; armor; armorMax; hope?;
  resistance?; noArmorSlots?; noMinorDamage? }        // thresholds from derivedThresholds (armor + level, CB p.91)
interface PcHit { amount; type; direct; forcedArmor?; hpMarkedDelta? }
pcSeverity(damage, thresholds): { severity: "none" | "minor" | "major" | "severe"; hp }
stepDown(severity, steps); hpForSeverity(severity)
armorOptions(pc, hit, extraSlots = 0): { canUseArmor; maxSlots; free }   // 1 slot, + extra ("any" = all free); 0 on direct / Frenzy
damageBeforeArmor(pc, hit, reduceDamage?): { taken; resisted; severity }
armorPreview(pc, hit, extraSlots?): { slots; severity; hp }[]           // for the "mark an Armor Slot?" prompt
applyHitToPc(pc, hit, { armorSlots?, extraSlots?, reduceDamage?, reduceSeverity?, negate?, convert?: "stress" | "hope" }):
  { targetId, incoming, resisted, taken, severityBefore, forcedArmor, armorSlots, severity, hpMarked, stressMarked,
    hopeSpent, overflow, deathMove, before, after: { hp, stress, armor, hope } }
```

Order inside `applyHitToPc`: reduce damage, resistance (halve, round down like CA1), severity (On the Brink drops Minor),
forced slots (no benefit) first, then up to `maxSlots` chosen slots (one step each), extra severity steps, Chains of
Affliction's `hpMarkedDelta`, then HP (or Stress with the CB p.92 overflow, or Hope). `deathMove` when the last HP is marked.

### Feature reading (`adversary-actions/features.ts`)

```ts
interface AdversaryState { hp; hpMax; stress; stressMax; conditions; tags?; tokens; situations?; allyWithin?(req) }
adversaryRequirementMet(req, s) / unmetAdversaryRequirements(reqs, s)   // "half" = hordeHalved; allyWithin absent = holds (Q18)
activePassives(effects, s); passiveSummary(effects, s, tier?, rng?): PassiveSummary
  // { attackBonus, difficulty, resistance?, horde, minion, relentless, spotlightCostsFear, directAttacks,
  //   attackDamageAdd, attackDamageType?, flags, auras }
matchesTrigger(trigger, event: AdversaryEvent): boolean
triggeredUses(effects, event, s): { effect, use, mode: "reaction" | "auto" }[]   // reaction = one-tap prompt (Q19)
spotlightCost({ spotlightsThisTurn, instanceSpotlights, relentless, costsFear? }): { fear: 0 | 1; overLimit }
adversaryNumberEnv(s, tier, gmFear?): NumberEnv
```

`AdversaryEvent` has one member per trigger kind with the facts the server knows (`band` / `attackerBand` from the
feature's owner, severity, damage type, `first: {scene, ever}`, roll facts …). `onHpMarkedAtLeast` triggers are matched by
an `onHpMarked {before, after, hpMax}` event (fires when the mark is crossed). Unknown facts pass every narrowing.

### The feature runner (`adversary-effects/run.ts`)

```ts
run(effect: AdversaryFeatureEffect, context: AdversaryRunContext): { ok: true; plan: AdversaryPlan } | AdversaryRunRefusal
runStandardAttack(context)                       // standardAttackEffect(adversaryId, attack) through run
standardAttackEffect(adversaryId, { name, range }) // action, needs spotlight, d20+ATK vs Evasion, one target, printed damage
adversaryFeatureUseKey(adversaryId, feature, useId?) // "card:<adversaryId>/<feature>[:<useId>]", stored per instance
upfrontFear(costs, context): number              // what to ask "Spend N Fear?" for
```

`AdversaryRunContext`: `adversaryId`, `self` (the instance as a `Combatant`), `attack {name, modifier, range, damage}`,
`tier`, `tokens?`, `featureUses?` (this instance's limits), `gmFear`, `spotlit`, `fearConfirmed?`, `useId?`, `targets?`,
`picked?`, `allies?`, `followUp?`, `trigger?`, `options?`, `optionals?`, `eitherCosts?`, `splits?`, `situations?`,
`advantage?`, `disadvantage?`, `experience? {name, value}` (+value, +1 Fear), `group?` (the other Minions of a Group
Attack), `hordeX?`, `passives?` (`passiveSummary`), `instance? {attack, damage, halfDamage, disadvantage}` (summed instance
effects), `allyWithin?`, `rng`.

Refusals (before anything is paid), with the AA0 code to throw:

| reason | code | when |
|--------|------|------|
| `noUse`, `requirement`, `exhausted` | `ADVERSARY_FEATURE_UNAVAILABLE` | no such use; an `AdversaryRequirement` fails; the scene limit is used up |
| `spotlight` | `ADVERSARY_NOT_SPOTLIT` | `needsSpotlight` and not `spotlit` |
| `confirmFear` | null | a Fear cost (or an Experience) without `fearConfirmed`: ask "Spend N Fear?" (`detail` = N) |
| `cost` | `NOT_ENOUGH_FEAR` / `ADVERSARY_FEATURE_UNAVAILABLE` | Fear short / its Stress (or HP) track can't pay |
| `choice`, `targets` | null | bad input (too many targets) |

Order: requirements, spotlight, Fear confirmation, then CA1's limit, choices, targets, upfront costs, one roll (AR7), steps.

`AdversaryPlan`: `{ adversaryId, feature, useId, activation, needsSpotlight, steps, roll, hits, success, limit, self {before,
after, tokens {before, after}, featureUses}, creatures [{id, before, after}], gmFearDelta, fearSpent, incoming, deathMoves,
group, modifiers, excluded }`.
- `steps` are CA1's `PlanStep`s (see TASK-CA-CA1) plus `summon {label, count, adversaryId?, range?}`, `countdown {op,
  label, start?, amount?, loop, onTrigger?}` and `spotlight {who, count?, within?, name?}` in their place. Their numbers
  are resolved after the other steps (RNG order: modifier dice, d20s, damage dice in step order, then prompt numbers).
- `incoming`: one `IncomingHitDraft {targetId, amount, type, direct, forcedArmor, critical, attackTotal?}` per PC who took
  damage. This is the incoming-hit payload's numbers; nothing is marked on that PC for it until the window resolves.
  Forced Armor Slots ("without its benefit") are taken out of `creatures[].after` and put in `forcedArmor`.
- `creatures[].after`: what to store for creatures marked directly (a PC's "mark 2 Stress" with overflow, forced HP).
  `deathMoves`: PCs whose last HP was marked that way.
- How the numbers get in: the attack roll's modifier is ATK + `+2d4` dice + Experience + `passives.attackBonus` +
  `instance.attack`; `instance.disadvantage` adds a d20; a `standardAttack` damage roll reads `standardAttackDamage` (Horde X,
  passive damage changes); direct damage from the text or `directAttacks`; `instance.damage` then `halfDamage` ride on its
  hits; a Group Attack's damage step repeats once per Minion (self + `group`).

### The reaction window (`adversary-actions/window.ts`)

```ts
interface WindowHit extends PcHit { attackerId; critical; attackTotal?; attackerBand? }
interface WindowPc extends PcDefense { evasion?; featureUses?; cards: CardEffect[]; bandToTarget? }
openWindow({ hit, targetId, party }): WindowState
  // responders: the target (if they can mark a slot or hold an eligible card) and each ally with an eligible card
respond(state, { characterId, choice: HitChoice, folds? }): { ok: true; state } | { ok: false; code: "REQUEST_NOT_OPEN" | "NOT_A_RESPONDER"; detail }
awaiting(state): string[]; isComplete(state); resolveNow(state)
resolveWindow(state, party: PcDefense[]): { originalTargetId, targetId, missed, negated, result: PcHitResult | null,
  reflected [{to, targetIds, amount}], manual: string[], armorSlotsChosen }
eligibleCards(pc, role, hit, severityBefore, armorCapable): string[]
foldsFromPlan(cardPlan, responderId): Fold[]
runReactionCard(card, actor: ActorState, state, { target, attacker? }, rng, useId?): { result: RunResult; folds }
targetPrompt(state, target): { damage, severity, maxSlots }    // the hit PC's own view (Q14)
```

- `HitChoice` and `Responder` have the same shape as AA0's stored `hitChoiceValidator` / `hitResponderValidator`.
- Eligible cards: a loadout card with a `reaction` use whose trigger fits, not exhausted (`cardAvailability`), and payable
  with its fixed costs. Ally: `whenAllyWouldTakeDamage` within its range of the target (band unknown: yes). Target:
  `whenAllyWouldTakeDamage` with `includeSelf`, `whenYouWouldTakeDamage` (type, severity before armor, melee / beyond),
  `whenAttacked` at `rolled` / `succeeded`, `whenArmorSlotMarked` (self) when they can mark a slot.
- Answers: the target answers `armor {slots?}` / `noArmor` (`pass` counts as no armor) once and may play offered cards
  before that; an ally answers once with an offered card or `pass`. A card's `redirect` fold makes its user the target:
  the first target is released, the new target owes an armor answer if they have a free slot (else a `noArmor` is added).
  A redirected ally's stored responses therefore hold two rows: the card, then the armor answer.
- Folds: `redirect`, `reflect` (+ `negateDamage`; the server deals `amount` to the attacker / picked), `extraArmorSlots`,
  `reduceSeverity`, `reduceDamage`, `negateDamage`, `negateAttack` (Bone-Touched's `fail`), `evasion` (a miss when the kept
  `attackTotal` is below Evasion + bonus and not critical; without `attackTotal` a manual note), `convert` (HP as Stress or
  Hope), `manual` (everything else, as text).
- Rebuilding from the stored row: `openWindow` with the party as it was when the hit landed, then `respond` for every
  stored response in order, with the folds that card produced.

## For the next tracers

- **AA2** (server): build `self` and the targets as `Combatant`s, `passives = passiveSummary(adversaryEffects(id), …)`,
  call `runStandardAttack` / `run`, map refusals by `code`, write `self.after`, `self.tokens.after`, `self.featureUses`,
  `creatures[].after`, `gmFearDelta`; for each `incoming` hit open a window (`openWindow` with the party's `WindowPc`s and
  `derivedThresholds`) and store its `responders`; on `respond` run the card with `runReactionCard`, pay its costs, store the
  answer; when `isComplete` (or `resolveNow`) write `resolveWindow(...).result.after` to the sheet (HP, Stress, Armor, Hope),
  start a death move when `deathMove`, deal `reflected` damage to the adversary. Offer `triggeredUses` for every event the
  action caused (Momentum is `auto`). Spotlight with `spotlightCost`.
- **AE-***: write entries and test them through `run` with `queueRng`; the runner adds the stat block's ATK itself, so an
  `adversaryAttack` roll spec carries only extra bonuses. Pool / stat-block tokens: `tokens` requirements and the `tokens`
  outcome on `self` (they read and write the instance's `tokens`); a Pool bonus is `{stat: "attack", delta: {kind:
  "cardTokens"}}`.
- **AA3-AA5** (UI): `targetPrompt` / `armorPreview` for the hit PC, `awaiting` for the window status, `upfrontFear` and
  `spotlightCost` for the Fear prompts.

## QUESTIONS

1. **Persisting card folds.** The stored response (`hitChoiceValidator`) keeps only `cardId` / `useId`. To rebuild the
   window, AA2 needs the folds the card produced; most are fixed (I Am Your Shield), but some are rolled (Rune Ward's 1d8).
   Should AA2 widen `combatResponseValidator` with an optional resolved `folds` list (CA3 owns that file for widen-only
   edits), or re-run the card with recorded dice?
2. **Forced Armor and the one-slot rule.** With "mark an Armor Slot without gaining its benefit" (CB p.195), can the PC
   still mark one slot for its benefit on the same hit? The engine says yes when a slot is free (the forced slot is not
   "to reduce damage"). Confirm.
3. **"You must spend a Fear to spotlight the X"** on an additional spotlight: 1 Fear or 2? `spotlightCost` charges 1.
4. **Per-instance feature uses.** Scene limits are stored with `until: "session"` (CA1's `limitUntil`) under
   `adversaryFeatureUseKey`. `encounterAdversaries` has no field for them; AA2 needs an optional `featureUses` on the
   instance (a widen of `convex/lib/validators/encounters.ts`, which AA1 owned only for `tokens`), or a GM-turn/scene
   reset in the encounter. Who adds it?
5. **Shared Pools.** "Mechanorb Pool", "Guahalan Pool" are shared by every adversary of that kind; `tokens` is per
   instance. Should AA2 keep a Pool on one instance (the first) and read it for the others, or should the encounter get a
   pool map?
6. **Advantage against Vulnerable PCs, disadvantage from Hidden / Cloaked PCs.** One roll goes against every target (AR7),
   so per-target advantage can't be applied inside the roll. The engine leaves it to the caller (`advantage` /
   `disadvantage`); AA2 applies it for single-target attacks only. Confirm.
7. **Massive damage** (CB p.91, optional) is off for PCs here, as for adversaries. Should it be a campaign switch?
