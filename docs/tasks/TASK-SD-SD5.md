# TASK SD-SD5: riders on map attacks, the after-roll step, Cloaked from the map

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD5 (bead dcm-bxp.99.19). Analysis: `.omc/autopilot/sheet-drawer-analysis.md`
(Q1, Q7, Q9, Q13; vocabulary NV4, NV6, NV8, NV18).

Status: Review (implemented and tested in the worktree; the combat e2e specs and the wiring note below are for the
orchestrator).

## What it does

- **Riders on a weapon attack** (`combatActions.attack`, new arg `riders: [{source: card | feature, id, useId?, choices}]`).
  A loadout card's or a held feature's use with activation `rider` runs through the card path (`buildRun` / `runCard`) as its
  own plan, bound to the attack's roll:
  - `before` (trigger `beforeYouRoll` an attack, action, the weapon's trait, or the damage roll): its costs and limit are
    paid first; what it adds to the roll (`modifyRoll` add / advantage) and to the damage (`modifyDamage` add,
    proficiency, multiply, minimum severity) is folded into the attack. Rage Up, Elementalist, Ruthless Predator, Apex
    Predator, Surrounded.
  - `after` (trigger `whenYouAttack`, `afterYouRoll` without a roll change, `whenYouDealDamage`): runs only when its result
    filter holds (Q4: "on a success" uses nothing on a miss; the result lists it under `skipped`), on the targets hit. Hold
    Them Off, Kick, Tusks, Wings of Light, Overwhelm, Thrive in Chaos, Toxic Concoctions, Weapon Specialist, Marked for
    Death, Diminish My Foes.
  - `damage` (trigger `whenTargetMarksHp` / `whenEnemyTakesDamage` by you, with a severity): runs after the damage on the
    first target that marked HP at that severity. Death Strike, Ruthless Predator's Severe Stress.
  - Each rider runs in two parts (`convex/lib/cardRunner.ts` `riderUse` / `splitSteps` / `bindGates`): `pre` (costs, limit,
    folds and steps on the actor) before the damage, `post` (Stress, conditions, movement prompts on other creatures) after
    the damage is written, so they land on the instances as the damage left them. Move gates (`success`, `withFear`, …)
    are decided by the attack's roll.
  - NV18 `addTargets` (Hold Them Off, Surrounded): the rider's `picked` choice names the extra enemy tokens (at most its
    count); each must be seen with a clear line, of the attack's encounter and within the rider's range; they are hit or
    missed by the same roll total (CB p.104) and take the same damage (half for `damage: "half"`).
  - NV4 `adjustHpMarked` (Thrive in Chaos): one more HP after the thresholds on each target that marked HP.
  - Refusals: CARD_NOT_IN_LOADOUT, FEATURE_NOT_OWNED, INVALID (not a rider of this attack; the same rider twice, CB p.107;
    an option not picked; more than `MAX_RIDERS_PER_ATTACK` = 8), the runner's codes (CARD_EXHAUSTED / FEATURE_EXHAUSTED,
    *_COST_UNPAID), COMBAT_TARGET_INVALID / COMBAT_NO_LINE_OF_SIGHT for an added target. A refusal writes nothing.
- **Automatic riders** (activation `auto` of held features, no click): First Strike (scene limit, Q7), Face Your Fear,
  Pummeljoy, Marked for Death's extra damage, Ranger's Focus's Stress, Ruthless Predator's Severe Stress. An automatic use
  that can't run (exhausted, unaffordable, a condition the engine reads as false) just doesn't happen. Onslaught as before.
- **Sneak Attack and Cloaked (Q9 a)**: the map decides Sneak Attack (D5's `sneakAttack` damage option, so a critical maxes
  its dice as before): the attacker is Cloaked, or another PC's or an `ally` token is within Melee range of a target hit.
  The player's own tick is ignored. After any attack, Cloaked ends (CB p.42). `convex/lib/combatMovement.ts`
  `uncloakAfterMove` ends Cloaked when the rogue's token ends a move in line of sight of an enemy token (see
  "Wiring" below).
- **The after-roll step (Q1 a)**: after the Duality roll, when the attacker holds a ready, affordable after-roll feature
  whose trigger fits the roll (`afterYouRoll` this attack, or `afterAllyRolls` with "you or an ally"; its result filter; a
  `modifyRoll` change the attack can apply: reroll all (Patron's Boon with advantage, Luckbender, Adaptability, Ranger's
  Focus), reroll a Hope Die of 1 (Internal Compass), with Hope (Fearless, Unbound), success (True Strike, Witch's Charm),
  add (Prayer Dice)), the attack is held: `attack` returns `{status: "awaiting", requestId, roll, targets: [{tokenId, hit}],
  options}` and writes nothing but a `combatRequests` row of kind `afterRoll` (the dice drawn so far, the roll, Hit / Miss).
  `combatActions.afterRoll {requestId, choice: use | pass}` (the attacker's player, or the GM's Resolve now) resolves it
  with the same dice; Use pays the feature (its limit too) and rerolls / changes the roll first. With no eligible feature
  the attack resolves at once as before. `combatRequests.mine` lists held attacks (player: own; GM: all).
- **Riders on a card's roll** (`combatCards.useCard`, new arg `riders`): before-roll riders pay and add to the card's roll;
  the card runs with their damage changes folded into its own use as numbers; riders on the result run on the hit targets
  and, if they change the damage, the card runs again with the same dice; their creature effects and the damage-phase
  riders land after the card's rows, in the card's actionLog group. The sanction stores and replays the riders.
- **UI** (`src/components/combat-map/actions/attack/`): `riders.tsx` lists the rider toggles ("With this attack") with when
  they apply, their costs and limit, numbers (steppers), options (selects), situations (check boxes, Q13) and extra targets
  (chips); disabled and labelled when used up. The after-roll prompt shows the held roll, Hit / Miss and Use / Pass (GM:
  Resolve now). The bar lives in the actions panel, which is the bottom sheet at 760 px and below; targets are 44 px.

## Rules quoted (printed pages; CB = Core Book, HF = Hope & Fear)

- CB p.42 (Rogue): "Cloaked — Any time you would be Hidden, you are instead Cloaked. … After you make an attack or end a move
  within line of sight of an adversary, you are no longer Cloaked." "Sneak Attack — When you succeed on an attack while
  Cloaked or while an ally is within Melee range of your target, add a number of d6s equal to your tier to your damage roll."
- CB p.107, "Using Features After a Roll": "Some features let you affect a roll after the result has been totaled … In this
  case, you use it after the GM declares if the roll succeeds or fails, but before the narrative consequences unfold (such
  as damage being rolled) or another dice roll is made." "Rerolling": "When a feature allows you to reroll a die, you
  always take the new result." "Spending Resources": "Unless an effect states otherwise, you can't spend Hope or mark Stress
  multiple times on the same feature to increase or repeat its effects on the same roll."
- CB p.90: "When using a Hope Feature, if you rolled with Hope for that action, the Hope you gain from that roll can be spent
  on that feature."
- CB p.38 (Hold Them Off): "Spend 3 Hope when you succeed on an attack with a weapon to use that same roll against two
  additional adversaries within range of the attack."
- CB p.330 (Rage Up): "Before you make an attack, you can mark a Stress to gain a bonus to your damage roll equal to twice
  your Strength. You can Rage Up twice per attack."
- CB p.58 (Kick): "When you succeed on an attack against a target within Melee range, you can mark a Stress to kick yourself
  off them, dealing an extra 2d6 damage and knocking back either yourself or the target to Very Close range."
- HF p.14 (Patron's Boon): "When you fail a roll, you can spend 3 Hope to reroll with advantage."
- HF p.8: First Strike "The first time in a scene you succeed on an attack, you deal double damage."; Death Strike "When
  you deal Severe damage to a creature, you can mark a Stress to force them to mark an additional Hit Point."; True Strike
  "Once per long rest when you fail an attack, you can spend a Hope to make it a success instead."

## Public functions (authz matrix: tests/convex/authz/riders.entries.ts)

- `combatActions.riders {characterId, slot?}` (campaign query, `view` + edit on the character: the player or the GM;
  another player FORBIDDEN): the rider toggles. Built from the character's own sheet only (U1).
- `combatActions.afterRoll {requestId, choice}` (keyed campaign mutation, same access): Use / Pass / Resolve now.
- Widened: `combatActions.attack` (`riders`, returns `awaiting`), `combatCards.useCard` (`riders`),
  `combatRequests.sanction` (returns `awaiting`), `combatRequests.mine` (`afterRoll` rows).
- Validators (convex/lib/validators/combatRequests.ts, widen only): `riderValidator`, the sanction's attack / card action
  `riders?`, request kind and payload `afterRoll` (schemaVersion 1), `afterRollChoiceValidator`.

## Tests

- tests/convex/combat-riders.test.ts: Rage Up once / twice / three times refused; refusals; Rage Up on Whirlwind
  (useCard) with undo; Hold Them Off (three targets, 3 Hope; skipped on a miss; out of range refused); Kick (map-confirmed
  Melee, prompt); Sneak Attack from an ally's position, not without, Cloaked then uncloaked; First Strike once per scene;
  Death Strike and undo; the after-roll step (held with Hit / Miss only, nothing written; Use Patron's Boon; Pass with the
  same dice; GM Resolve now with the player as the rows' actor; another player FORBIDDEN; a feature not offered refused;
  no eligible feature resolves at once); `bindGates` / `splitSteps` / `riderUse`; `inSightOfAdversary`.
- tests/convex/authz/riders.test.ts: the matrix rows.
- tests/unit/combat-riders.test.tsx: toggles, costs and when, disabled used rider, Rage Up stepper (max 2), Hold Them Off
  extra targets (max 2), Kick's option blocking the attack, the `riders` argument.
- tests/e2e/combat-riders.spec.ts: a rogue's Sneak Attack from positions, a ranger's Hold Them Off, a warlock's Patron's
  Boon after a miss, Rage Up.

## Wiring left to the orchestrator (outside SD5's owns)

- `convex/combatTokens.ts` `move` (SD0's file): after `ctx.db.patch("combatTokens", token._id, next)`, call
  `await uncloakAfterMove(ctx, ctx.campaign, map, { ...token, ...next }, ctx.user._id)` from `convex/lib/combatMovement.ts`
  (Q9: Cloaked ends when the rogue's token ends a move in line of sight of an adversary). The helper and its sight test are
  in place and tested; the one-line call is not, because the move mutation is not in SD5's owns.

## QUESTIONS (literal readings built; please confirm)

1. **After-roll Hope accounting (CB p.90 + CB p.107).** CB p.90: "the Hope you gain from that roll can be spent on that
   feature"; CB p.107: "When a feature allows you to reroll a die, you always take the new result." Built: the held roll's
   Hope may pay the after-roll feature, then that roll is replaced (reroll) or changed, so its own Hope is taken back and only
   the final roll's Hope, Stress and Fear apply (as D5's Witch's Charm takes the Hope back). Example: 3 Hope, a failure with
   Hope (4), Patron's Boon (1), reroll with Hope (2). Is that right, or does the first roll's Hope stay?
2. **Cloaked from movement: whose line of sight (CB p.42 "end a move within line of sight of an adversary").** Adversaries
   have no vision cone on the map, so built: any enemy token with a clear geometric line (walls and closed doors block,
   cover doesn't) to the rogue's token, lights and facing ignored. Should darkness or the GM's hidden tokens count?
3. **Sneak Attack "an ally within Melee range of your target" (CB p.42).** Built: another PC's token or an `ally`-side token
   (companions, GM allies) within Melee of a target the attack hits. Neutral tokens don't count. Right?
4. **Damage-phase riders with several targets (Death Strike, HF p.8: "When you deal Severe damage to a creature").** Built:
   applied once, to the first target (the attack's own target first, then added ones) that took damage at that severity.
   Hold Them Off can make several Severe hits on one roll: should Death Strike be offered once per creature?
5. **Hold Them Off / Surrounded targets out of range.** Built: an added target out of the rider's range refuses the whole
   attack (COMBAT_TARGET_INVALID) instead of waiting for the GM's sanction (Q1 is about the attack's own targets). OK?
6. **The after-roll step on card rolls and ally features.** Q1 (a) says "only when the roller (or an ally in range) holds" an
   after-roll feature. Built: the roller's own features on weapon attacks. Ally answers (Witch's Charm, Luckbender, Prayer
   Dice from an ally) and card rolls are not held yet (follow-up below). Should an ally's after-roll feature hold the
   attack too?
7. **Damage after-roll features (Volatile Magic, Fearsome Attack: "reroll any number of your damage dice").** Q1 (a): "Damage
   features (Volatile Magic) get the same step after the damage roll". Not built yet (follow-up): it needs a second held
   stage after the damage roll with the player's die picks.

## Follow-ups (for beads)

- Damage-stage after-roll step (Volatile Magic, Fearsome Attack), QUESTION 7.
- After-roll step for card rolls and for allies' after-roll features (Witch's Charm, Luckbender, Prayer Dice), QUESTION 6.
- The Hand (src/components/combat-map/actions/hand/**, HF1's) has no rider toggles yet: `useCard` accepts `riders` but the
  UI does not send them (Rage Up on Whirlwind works through the API and tests only). The Hand's rider cards (Rage Up)
  still show "With an attack"; on the Attack bar they are toggles now.
- Riders that add targets on a card's roll (refused with INVALID), and `addTargets` with `damage: "half"` on cards.
- Rider damage changes the attack can't fold yet are logged on the GM row as "not automated": `reroll`, `maxDice`,
  `doubleDice`, `addWeaponDie`, `extraDie`, `ones`, `dieSize`, `halve`, `type`, `replaceWithHp`; roll changes in riders
  (`dieBonus`, `hopeDie`, `fearDie`, `experience`).
- Riders' effects on other PCs (an ally a rider targets) are not written by the weapon-attack path.
- Wire `uncloakAfterMove` into `combatTokens.move` (above).
