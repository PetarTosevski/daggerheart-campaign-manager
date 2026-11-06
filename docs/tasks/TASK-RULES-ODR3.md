# TASK-RULES-ODR3: the last Defined Ranges, PC conflict and dim-light spots

Plan `.omc/plans/rule-switches.yaml`, tracer ODR3 (wave 14, bead dcm-bxp.134). Builds the outside-owns lists of ODR2
(`docs/tasks/TASK-RULES-ODR2.md`, "Not done" 1-6, 8, 9; 7 and 10 are DEF's), OP2 (`TASK-RULES-OP2.md`, 1-2) and OE2
(`TASK-RULES-OE2.md`, 1-2). User 2026-11-06 on dcm-bxp.134 (binding): "Defined Ranges OFF: automatic effects that pick
creatures by range (e.g. 'all adversaries within Very Close', Ill Omen, Cloaked ally-in-Melee) don't apply; the GM gets
a note asking who is in range".

## The books

- CB p.103, "Range": "these ranges aren't intended to be precisely measured during play"; "Optional Rule: Defined
  Ranges" gives the squares.
- CB p.168, Conflict between PCs: "On an attack roll against a PC, the attacker rolls against the defender's Evasion,
  just like an adversary."
- CB p.104, darkness: "raising the Difficulty of action rolls or imposing disadvantage on rolls made by the PCs."
- CB p.42, Sneak Attack: "When you succeed on an attack while Cloaked or while an ally is within Melee range of your
  target, add a number of d6s equal to your tier to your damage roll."

## Defined Ranges off

| Where | Off |
|---|---|
| Adversary triggers gated by a range (`rangeGate`): `pcRollAdversaryUses` (Ill Omen, HF p.95), the attack's `onAttack` / `onHit` / `onMiss` triggers, `afterHitTriggers`, `pcEscape` | Not run, not offered; one GM-only `definedRanges` note per use, "Ill Omen (Owl Witch): who is within Close range?" (`rangeGatedUses`), in the action's group. The other uses run with the runner's `definedRanges: false` |
| `pcRollAdversaryUses` input | `groupId` and `actorId` (optional); without `actorId` the wrapper context's `ctx.user` posts; without `groupId` the note is never undoable. Returns `rangeAsks` when any |
| Rider `all` picks (`autoPicked`; Elemental Incarnation's "all other adversaries within Very Close range", CB p.30) | Names no one; `RiderEnv.rangeNotes` gets `rangeAsk(use, range)`; `resolveAttack` posts them in the attack's group |
| Allies' automatic uses (`allyAutoRuns`, Eclipse) with a `range` or `against.within` | Not run; a note "Eclipse (Mira): who is within Close range?" |
| Sneak Attack (`sneakAttackApplies` → null unless Cloaked) | The player's tick decides; without a tick a GM note (`sneakAttackAsk`) |
| Map situation "The target is within Melee range" (Kick, Tusks) | The player's to confirm (Q13) |
| `creatureFacts` | No `distance` / `nearestAlly` (checks fall to the player) |
| `rollTargetHolds` / `dealDamageHolds` (`definedRanges` param, default on) | `within` holds |
| Bearer "attacks from beyond X have disadvantage" (Sandstorm) | Not applied (no bands) |
| Rider pick target's band | No square count |
| Player's Measure (hud/shell passes `campaignId` to `PlayerMapControls`) | Hidden |
| Chain rows (`pick-feature`, `pick-card/chain` `CardChainEnv.definedRanges`) | No band |
| Charge drawer `targetLabel` | Name only (no band from `chargeOptions`) |
| Attack picker: `bandsFrom(view, definedRanges)`, `conflictRows(…, definedRanges)`, forced rows, Minion bands | No band, no `out` row |

## PC conflict

`combatActions.attack`: a PC target out of range now waits for the GM like an adversary (`openSanction`, its band in
`outOfRange`, no `encounterId` when the attack names only PCs); the table's "refuse" setting refuses it
(COMBAT_TARGET_OUT_OF_RANGE). `resolveAttack`'s held attack goes through `openAfterRoll` with an optional encounter.

## Dim light and underwater on roll lines

- `rollText(use, record, trait, environment = [])` appends "(dim light: disadvantage, underwater: disadvantage)";
  `rollEnvironment(built, use, underwaterOn)` reads `built.context.darkness` (a roll with a Difficulty) and the live
  map's Underwater for an attack roll (unless the actor fights underwater).
- The Cloaked move's Finesse roll (`rollCloak`) takes `darknessOnRoll` / `withDarkness`: the die, +N to the Difficulty
  (the GM row shows the raised Difficulty, "+N dim light"), the public row names it as the dice box does.

## Outside ODR3's owns (not done)

1. `convex/combatCards.ts` (~538) and `convex/lib/featureRunner.ts` (~942) should pass
   `rollEnvironment(built, pick.use, ruleMode(campaign, "underwater"))` as `rollText`'s fourth argument; until then the
   card and feature lines are unchanged.
2. `src/components/combat-map/hud/hand/body.tsx` `openChain` should pass `definedRanges: useDefinedRanges(campaignId)`
   to `cardChainSession` (a card's chain rows still show bands).
3. `convex/lib/rolls.ts` `duality` and `convex/combatCards.ts` `foldPcRolls` call `pcRollAdversaryUses` without a
   `groupId`: the Ill Omen question is posted (by `ctx.user`) but is not undone with the roll. Pass the roll's group
   when one exists.
4. `convex/lib/adversaryFeatures.ts` (DEF) has its own `triggered(...)` callers (feature uses, reactions): they should
   use `rangeGatedUses` too.
5. `convex/combatCards.ts` calls `rollTargetHolds` without the flag (`rangesOn(use.scene)` as fifth argument).
6. Rider runs' own `built.ruleNotes` (ODR2's "all targets within" notes from a rider's `targets`) are not posted by
   `resolveAttack` (only `RiderEnv.rangeNotes`).

## Tests

`tests/convex/rules-defined-ranges.test.ts` (ODR3 block: Ill Omen on / off and its note's group, the attack path,
Sneak Attack's tick and note, `rangeGatedUses`, `autoPicked` / `autoPickRange` / `sneakAttackApplies`, client rows and
labels); `tests/convex/rules-pc-conflict.test.ts` (an out-of-range PC waits and approval resolves; refused under
"refuse"); `tests/convex/rules-environment.test.ts` (ODR3 block: `rollEnvironment` / `rollText`, the Cloaked roll per
mode).
