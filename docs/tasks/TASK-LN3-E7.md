# TASK-LN3-E7: adversary engine, round 3 (lanes-2 wave 9, tracer E7.3)

Branch `lane3-e7`. Lane `lane:w1-e7-adversary-engine`. This tracer was resumed after a machine crash. The earlier
agent's uncommitted work was kept and finished.

## What landed

- **Forced attacks (dcm-f70y, dcm-c8h3, dcm-zi3k part).** `forcedStandardAttack` in `convex/lib/adversaryActions.ts`
  makes the instance's standard attack outside its spotlight: no spotlight is spent and no Fear is asked
  (`adversaryAction(..., { forced: true })`). When an adversary run's plan has `forcedAttack` steps:
  - an adversary attacker attacks right after the commit, in its own log group;
  - a PC attacker gets a manual prompt ("must make an attack against ...");
  - when no target is named, the GM gets a prompt to pick one.
  New public GM mutation `adversaryActions.forcedAttack { instanceId, targets }`. It is the GM's button until the card
  runner hands its `forcedAttack` over (E3/E4 call `forcedStandardAttack`).
- **Transform (dcm-3ag5).** A `changeForm` step writes a permanent `form` instance modifier (`formInstanceEffect`).
  `printedBlockOf` and `selfCombatant` read the form's SRD stat block (`formOf`, `instanceStatsOf`) for its features,
  Difficulty, thresholds and maximums. Marked HP and Stress stay. The commit clamps to the form's maximums.
- **Condition entry fields (dcm-f70y, dcm-iedr, dcm-b77 storage).** A `condition` plan step on an instance becomes an
  instance modifier tied to that condition (`conditionInstanceEffect`). It stores mods (via `instanceModFields`),
  `endsOn`, `endsOnCaster`, `endsOnRoll`, `escape`, `recorded`, `endFear` and `casterId`. When the condition or tag
  goes, the modifier goes too (`withoutClearedConditions`, applied at every commit). It is exported for the card runner.
- **Structured moveLimit / forcedMoveReduce (asked for early, E4.3 reads them).** `instanceEffectValidator` gains
  `moveLimit { maxRange?, direction?, text? }` and `forcedMoveReduce` (widen only). A wind direction is resolved from
  the use's option choice (Hurricane).
- **Creature tokens and gold (dcm-n3mp, dcm-0n1u part).** `encounterAdversaries.creatureTokens` (widen; capped at
  `MAX_CREATURE_TOKEN_KINDS`). `creatureTokens` steps on instances are stored and undo-able via the before-state. The
  run context gets `creatureTokens` for every instance and `goldOf` for each PC. Tokens on a PC: GM note only.
- **pcRolls dispatch (dcm-of7v).** `pcRollAdversaryUses(ctx, campaign, { characterId, roll, reactions? })` matches the
  running encounter's `pcRolls` uses:
  - automatic uses run;
  - reactions run when the GM opted in, and come back as `offers` otherwise;
  - `modifyRoll dieBonus` folds come back as `bonuses` for E1's `withDieBonuses`;
  - Stress and Fear costs are written.

  No caller yet (follow-up for E1's roll paths).
- **Widened critical range (dcm-mhn).** `use.roll.critRange` (19 means 19-20) decides the critical and the per-target
  rerun.
- **Attacker buy-off (dcm-eut).** `EvasionTarget.buyOff` (`pcTarget`) lists the "unless the attacker marks a Stress"
  disadvantages. Attack and feature args gain `buyOffs: string[]` (feature ids): the paid ones don't count and the
  attacker marks their Stress. The unpaid ones are named in the GM feed. A Melee `from` gate uses the map distance.
- **removedOptions (dcm-qw4f).** A `features` mod's `removeOptions` is stored as `optionsRemoved` on the instance
  modifier. The run context passes them as the actor's `removedOptions` fact.
- **dcm-grqt.** `gmControlledAttack` takes `trait` (a `TraitId`). With a "choice" weapon it is required (INVALID
  without it); the highest-trait default is gone.

Tests: `tests/convex/lane3-e7-round3.test.ts` (8 cases). Authz: `forcedAttack` entry added in
`tests/convex/authz/adversary-actions.entries.ts`.

## Beads

| Bead | State |
|---|---|
| dcm-grqt | closable |
| dcm-mhn | closable (engine). Data: Eye of the Sage `critRange: 19` (S-lane) |
| dcm-qw4f | closable (engine). Data: Seven-Headed `removeOptions` |
| dcm-3ag5 | closable (engine). Data: Forlorne Transform `changeForm` |
| dcm-f70y | closable for the adversary runs. The card runner's `forcedAttack` / `condition` hand-off on instances is dcm-svnq (E3/E4 call `forcedStandardAttack` / `conditionInstanceEffect`) |
| dcm-c8h3 | engine ready: Words of Discord's forced attack runs via `forcedStandardAttack`. The card side calls it (same follow-up) |
| dcm-zi3k | partly: a forced attack on a GM-picked target works (the `forcedAttack` button). Still open: "can't attack the caster", the rider on the GM's Fear spend, the Hope spend against forced HP |
| dcm-iedr | closable: condition mods and ends are stored on instances. Enforcing `endsOn` / `endsOnRoll` / escape at their events is still open (follow-up) |
| dcm-b77 | partly: storage only (`endsOnRoll`, `recorded`). Banish's recurring roll with a falling Difficulty is not run |
| dcm-n3mp | partly: instance tokens and goldOf done. Creature tokens on a PC sheet need a sheet field (E5 / sheet lane) |
| dcm-0n1u | partly: creature tokens done. Inventory, save fields and chain prompts not done |
| dcm-of7v | partly: dispatch built and tested. The PC roll paths (E1: resolveAttack, card uses, rolls.duality) must call `pcRollAdversaryUses` and fold `bonuses` with `withDieBonuses` |
| dcm-eut | closable (engine). Data: the Defensive stance `buyOff` switch in src/lib/srd/feature-effects/stances.ts. UI: a buy-off check box (combat UI) |
| dcm-ehgy, dcm-nnbl (E7 half), bearer steps (dcm-mm0f, dcm-0wj1, dcm-bxp.99.19.3, dcm-f0m, dcm-kti), dcm-8rh, dcm-i55, dcm-63j, dcm-4yg4, dcm-va0f, dcm-b77 riders, and the whole tail | not started this round (crash budget) |

## Follow-ups (filed)

- dcm-m7tm (`lane:w1-e1-triggers-rolls`): call `pcRollAdversaryUses` on PC action rolls, and apply `bonuses` with
  `withDieBonuses` (dcm-of7v).
- dcm-svnq (`lane:w1-e3-steps-saves` / E4): the card runner hands `forcedAttack` on adversaries to `forcedStandardAttack` and
  writes instance conditions through `conditionInstanceEffect`.
- dcm-thwj (`lane:w1-e7-adversary-engine`): enforce the stored `endsOn` / `endsOnCaster` / `endsOnRoll` / escape on instance
  condition modifiers at their events. Add the `pcEscapes` trigger case in `matchesTrigger` (V3, dcm-j63t).
- dcm-wiwi (sheet lane): `creatureTokens` on PC sheets (dcm-n3mp PC half).

## Data switches ready for wave 10

- `src/lib/srd/adversary-effects/t4-hf.ts`: Ill Omen. Replace the manual line with
  `modifyRoll dieBonus { die: "fear", amount: gmFear }`. The engine dispatch is ready; it needs E1's caller to take effect.
- `src/lib/srd/adversary-effects/*`:
  - Eye of the Sage: `critRange: 19`;
  - Seven-Headed: `features.removeOptions`;
  - Forlorne Transform: `changeForm`;
  - Hurricane / Creeping Fire: `moveLimit`;
  - Immovable Object: `forcedMoveReduce` (cards).
- `src/lib/srd/feature-effects/stances.ts`: Defensive stance. The `buyOff` / `from: "melee"` gate now counts in
  adversary attacks.

## QUESTIONS

1. Forced attacks by a PC (Beguiled, HF p.75): the engine gives a manual prompt and does not roll for the player. Is
   that right, or should the player get a roll request?
2. Buy-off (Defensive stance, HF p.12: "unless the attacker marks a Stress to negate the disadvantage"): the GM decides
   before the roll by passing `buyOffs`. The default is not paid; the GM feed names the offer. Is that right?
