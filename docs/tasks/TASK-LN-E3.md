# TASK LN-E3: card and feature steps, choices and saves

Plan `.omc/plans/lanes.yaml`, tracer E3 (label `w1-e3-steps-saves`), on tracer V's vocabulary (`docs/tasks/TASK-LN-V.md`).
The pure runner `src/lib/domain/card-effects/run.ts` now runs every E3 bead's vocabulary; no SRD entry uses it yet (wave
5 switches the data over), so the tests use inline fixture entries (`tests/unit/card-effects/lane-e3-steps.test.ts`).
Book pages are printed pages (CB = Core Book, HF = Hope & Fear).

Files: `run.ts` (runner), `convex/lib/cardChoices.ts` (new choice ids), `hand/dialog.tsx` (listed values, distinct
choose steps), the test file and this doc. Nothing outside E3's owns was changed.

## How the runner reads the new pieces

- **New `RunContext` fields** (all optional; absent behaves as before): `chooserOptions`, `chooserOptionals`, `hopeOf`,
  `creatureTokens`, `goldOf`, `heldDicePicks`, `hostRoll`, `chain`, `saveRaisers`, `saveAttempt`, `effectsOn`.
  `DelegateRequest` gains `roll` and `hit`.
- **New plan entries:** `endEffect`, `inventory`, `creatureTokens`; `pay.payerId`; `save.autoFail` / `raisedBy` /
  `advantage` / `disadvantage`; `check.row` / `label`; `effect.stacking`; prompt kind `followUp` and prompt fields
  `advantage`, `disadvantage`, `difficulty` and `chooserId`.
- **Numbers only the runner can read** (`dualityDie`, `free`, `creatureTokens`, `gold`) are turned into fixed numbers
  before `resolveNumber` sees them, at any depth (`bindNumber`). numbers.ts (lane E5) still returns 0 for them on its
  own, so the runner's values are the ones used.
- **`targetCheck` gates** are read for each recipient. The runner decides `track` (marks, free slots and known Hope),
  named `tokens`, `not` and `anyOf` itself. Every other check goes to `stateCheckMet` (E5) with the recipient as its
  target. A check nobody can decide still holds, as V's fallback did (the table confirms, Q13).
- **New choice ids** in `parseChoices`: `by:<step>:<tokenId>`, `byOptional:<step>:<tokenId>`, `heldDice`, `chain:<i>`
  (1 to 10) and `raisers`. The server still has to pass them into the run (follow-up dcm-x4ft).

## Beads

| Bead | State | How |
|---|---|---|
| dcm-0gh steal an item / gold | partly | The `inventory` step becomes plan `inventory` (with the amount resolved). A `gold` number reads `RunContext.goldOf` (handfuls; a bag is 10, CB p.104). Writing the inventory is the server's job (dcm-x4ft, dcm-0n1u). |
| dcm-0ib markedThisMove who:target for a self recipient | done | A number for the actor (marks, clears, Hope) reads `who: "target"` as the scope's single target (Siphon Essence). |
| dcm-27j multi-outcome check, parity | done | `check.table`: the row that holds the total runs (plan `check.row` / `label`); with no matching row, `then` / `otherwise` run. `even` / `odd` are tested. |
| dcm-40m two distinct choose steps | done | `choose.distinctFrom`: picking the same option refuses the use (`choice`). The dialog hides an option already picked in the other step. |
| dcm-5fc end another feature's effect | partly | `endEffect` with `of` becomes plan `endEffect {of, own: false}`. The server ending it is E6's (dcm-9z2z). |
| dcm-5xi can't lose a Hope | done (runner) | `hope.ifUnable`: a recipient holding less Hope than the loss runs `ifUnable` instead. Unknown Hope: the loss is sent and a manual prompt is added. A `track hope` check reads `hopeOf`. The server must pass `hopeOf` (dcm-x4ft, dcm-0n1u). |
| dcm-730 clear all conditions | done | `clearCondition.all` clears every condition and tag (one `clearCondition` entry each). |
| dcm-7az chain until a miss | done (runner) | `followUp.repeat` `until: "miss"`: each link in `chain` pays `costEach` first and the chain stops when a link's roll hits no one. Out of links, a `followUp` prompt asks for the next one. Server wiring: dcm-x4ft, dcm-0n1u. |
| dcm-8x8 end a card's own effect; max = free Stress | done (runner) | `endEffect` with no `of` becomes plan `endEffect {of: cardId, own: true}`. A `free` number reads unmarked slots. The server ending the effect is E6's (dcm-9z2z). |
| dcm-bz8 per-recipient choice | done (runner) | `choose.by`: each chooser's own pick (`chooserOptions`) runs with `to: "chooser"` = them. A chooser without a pick gets a choose prompt with `chooserId`. The same works for `optional.by` (each chooser pays: `pay.payerId`, plus their own mark / Hope entries; this is dcm-6ju's runner half). |
| dcm-d1b the host roll's Hope / Fear Die | done (runner) | `dualityDie` reads this move's roll, else `RunContext.hostRoll` (the server fills it for riders: dcm-x4ft). |
| dcm-d1d delegate can't read the use's roll | partly | `DelegateRequest.roll` / `hit` carry the roll the step runs after. delegate.ts reading them is E8's (dcm-8dhe). |
| dcm-fev auto-fail a save | done | `save.autoFail`: a recipient with a listed condition fails without rolling (`save.autoFail: true`; PCs get no prompt). |
| dcm-fnq choice max reads the target | done | `NumberChoice.afterTargets` is checked after the targets, with its `max` read against the first target. |
| dcm-kkx non-stacking effect | done (runner) | `effect.stacking`: `refuse` drops a copy on a creature whose `effectsOn` already has that label (a manual note instead). `replace` travels on the plan for the server (dcm-9z2z). |
| dcm-q0a allies raise a save's Difficulty | done (runner) | `SaveDifficulty.raised`: each creature in `saveRaisers` that can pay `cost` adds `each` (their marks are plan entries; `save.raisedBy`). The server picks the raisers within range (dcm-x4ft). `falling` subtracts `step` x `saveAttempt` (dcm-b77's save half). |
| dcm-qbn pick which Prayer Dice | done (runner) | A held-die `tokens` cost spends the dice in `heldDicePicks` first (choice id `heldDice`). |
| dcm-rb0 save advantage / disadvantage | done | `save.advantage` / `disadvantage` apply while `modsWhen` holds for that recipient. An adversary rolls two d20s; a PC's prompt carries the dice and the Difficulty. |
| dcm-rou Chain Lightning's chain | done (runner) | `followUp.repeat` `until: "noTargets"`: one link per creature list (`followUp`, then `chain`). Creatures already targeted are dropped, and the chain stops at an empty link. Server wiring: dcm-x4ft. |
| dcm-uyc listed values | done | `NumberChoice.values`: only a listed value passes (default: the first listed at or above `min`). The dialog offers a select. |
| dcm-xp0 tokens on a PC | done (runner) | `tokens.holder: "recipient"` becomes plan `creatureTokens`. `creatureTokens` numbers and the `tokens` check (with `name`) read `RunContext.creatureTokens` plus this use's changes. Storing them is the server's job (dcm-x4ft, dcm-0n1u). |
| dcm-y45 pick among hit targets | done | `TargetSpec.among` filters a step's `pick` (and a save's) to the scope's targets, or to the ones its roll hit. |
| dcm-yzr ground a flyer | done (runner) | `move.mode: "ground"` sets `flying: false` on the creature and keeps the move prompt. A PC's Flying sheet effect ending is the server's job (dcm-x4ft). |
| dcm-zhc spread forced HP marks | done | `markHp.distribution: "split"`: `splits` shares are capped at `maxPer` and at the total. A missing share gives a split prompt with the total. |
| dcm-vv2 item 2 (lane E7's bead) | done | The damage cache is per follow-up roll: a follow-up with its own roll rolls its damage again, and its critical is its own roll's (`crit(scope)`). A follow-up without a roll still shares the move's damage (Whirlwind, R9). Items 1, 3, 4 and 5 stay with E7. |

"done (runner)" means the runner is finished and tested. The rest needs the server to fill the context or write the new
plan entries (the follow-up beads).

## Follow-up beads

- dcm-x4ft (`lane:w1-e4-targeting-areas`): cardRunner.ts fills the new context fields and asks per chooser and per
  chain link.
- dcm-9z2z (`lane:w1-e6-endings-durations`): apply `endEffect` and `stacking: "replace"`.
- dcm-0n1u (`lane:w1-e7-adversary-engine`): the adversary engine passes and reads the new pieces (Hope, creature tokens,
  inventory, raisers, chain prompts, save fields).
- dcm-8dhe (`lane:w1-e8-session-features-rests`): delegate.ts reads `DelegateRequest.roll`.

## QUESTIONS

1. **Does each link of Chain Lightning roll its damage again?** CB p.328: "Targets who fail take 2d8+4 magic damage.
   Additional adversaries not already targeted by Chain Lightning and within Close range of previous targets who took
   damage must also make the reaction roll. Targets who fail take 2d8+4 magic damage. This chain continues until there
   are no more adversaries within range." The runner keeps the existing reading: a follow-up without a roll of its own
   shares the move's damage roll (R9, CB p.104: "roll damage once and apply the total to each target"). Each link would
   roll fresh only if the entry gives the follow-up a roll. The existing Chain Lightning test in arcana.test.ts expects
   the shared roll.
2. **Who counts as "not able to lose a Hope"?** CB p.222 (Dreadhowl): "make all targets within Very Close range lose a
   Hope. If a target is not able to lose a Hope, they must instead mark 2 Stress." The runner reads this as "holds less
   Hope than the loss" (for 1 Hope: has 0). Effects that forbid losing Hope are not modelled.
