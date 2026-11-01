# TASK-LN4-S4: tier 3-4 adversary data switches, round 2 (plan lanes-2, wave 10)

Branch `lane4-s4`, lane `w2-srd-data`, batch B (after V4, E1.4b, E2.4, E7.4). Owns the four tier 3-4 adversary effect
tables (`src/lib/srd/adversary-effects/t3-core.ts`, `t3-hf.ts`, `t4-core.ts`, `t4-hf.ts`), their unit tests,
`tests/convex/lane4-s4-*.test.ts` and this doc.

Rule (S1's): switch only data whose engine path is live on rebuild now, proven by a test through the real path; otherwise
keep the manual reminder (comment `Lanes-2 (dcm-xxx)` naming the engine bead) and list it for wave 11.

## What landed

| Entry | Change | Live? | Proof |
| --- | --- | --- | --- |
| t4-hf.ts Elemental Archon 1. Fire Beam (Adonix, HF p.96) | both `markHp` steps carry `keyword: "fire"` (dcm-n7kt); a Fireproof reminder added to both branches | riders: yes (E2.4 `markHpKeywordOf` + `markHpGuard`); the direct mark path: no (dcm-vvg1), so the reminder | lane4-s4 (an Emberkin marks 0 HP from Elemental Archon's HP riders, a plain PC 3), t4-hf.test.ts |
| t3-core.ts Money Talks (Demon of Avarice, CB p.228) | the `pay-instead` manual is now an `optional` `by: { to: "targets" }` with `convertMarks from: "hp" into: "gold"` (dcm-5cn5). The Collect button is kept | yes (E2.3 `goldForHp`, the window's `gold` grant, capped at the HP marked) | lane4-s4 (standard attack: grant offered, 2 handfuls pay 2 HP; a feature hit: no grant), t3-core.test.ts |
| t4-hf.ts Ill Omen (Owl Witch, HF p.95) | manual replaced by `modifyRoll` `dieBonus { die: "fear", amount: gmFear }` on the trigger subject (dcm-of7v) | yes (E7 `pcRollAdversaryUses`; called by rolls.duality / resolveAttack (E1.4b) and card / feature rolls (E1.4a), folded by `withDieBonuses`) | lane4-s4 (`bonuses` = Fear 4), t4-hf.test.ts |
| t4-hf.ts Transform (Forlorne, both forms, HF p.142-143) | manual replaced by `changeForm` on herself to the other form (dcm-3ag5) | yes (E7 `formInstanceEffect`, `printedBlockOf` / `instanceStatsOf` read the form) | lane4-s4 (dragon → faun → dragon; marks kept), t4-hf.test.ts |
| t4-hf.ts Seven-Headed (Mitera, HF p.92) | the d8 is a `dieBranches` table: 1-7 a permanent self `effect` with `features.removeOptions` of that Elemental Breath head (`stacking: "refuse"`); 8, or a head already gone (`optionRemoved`), ticks Diamond Hide; 6. Darkness adds "the cloud dissipates" (dcm-qw4f) | yes for the record and the tick (E7 `optionsRemoved`, `removedOptions` facts) | lane4-s4 (`useFeature` with server dice: a 3 stores Acid removed; a second 3 ticks Diamond Hide 5 → 4), t4-hf.test.ts |
| t3-core.ts Immovable Object (Greater Earth Elemental, CB p.230) | a passive `forcedMoveReduce` 2 (use `push`, dcm-1yo); the GM button for a move made by hand stays, reworded | server forced moves: yes (`forcedMoveReduceOf`); a GM-dragged knockback: no | lane4-s4 (`forcedMoveReduceOf` = 2), t3-core.test.ts |

Seven-Headed's removal step is not gated on the head still being there: with no head recorded yet the run has no
`removedOptions` facts (the adversary run passes them only when non-empty), so `optionRemoved` is undecided, and a step
without targets can't take a per-target `targetCheck`. Removing a gone head again changes nothing (the same option);
`stacking: "refuse"` drops the copy wherever the run is given `effectsOn`. The tick is gated with `requires` on a
situation carrying the `optionRemoved` check, so it runs only when the head is known to be gone.

## Verified and kept (reminders stay)

- t4-core.ts Reality Quake / Unstuck and t4-hf.ts Burrowing Leechpoles: a PC hit reads their mods now (dcm-12kx), but the
  sheet effect ids are over the 40-character cap and can't be saved (dcm-s7hd, open on rebuild). Reminders kept; the
  Leechpoles 2d4 `tokens` step (`holder: "recipient"`, `name: "leechpole"`) waits on it too (untestable through the real
  path while the save fails).
- t4-hf.ts Hunger Pangs / Ravenous: card / feature costs and the window's Hope grant refuse a Hope spend (dcm-hgvx,
  dcm-12kx), but a roll's Hope spends (an Experience, Help an Ally) don't read the flag. Reminder kept (dcm-akc0).
- t4-hf.ts Nightmare Stare / Afflicted: card clear steps read the flags; rest and downtime clears don't. Reminder kept
  (dcm-v3ek).
- t3-hf.ts The Weight of Opulence: goldOf is on the adversary run now, but (1) it counts handfuls only, not bags
  (dcm-sgn7), and (2) `hope.ifUnable` is all or nothing and nothing reads a creature's held Hope, so the answer's split
  (lose the Hope held, a Stress per unpaid bag) can't be written (dcm-xcdy, vocabulary gap). Manual kept; comment updated.
- t3-hf.ts Unleash Hellfire `perArea` (dcm-va0f), t4-hf.ts Lightning Strike / Bolt `checkFails` (dcm-4yg4): E7.4 did not
  start them. Kept.
- t3-hf.ts Slash and Burn: E7.4's typed before-damage fold doesn't reach the GM-tapped `onHit` reaction (dcm-i55). Kept.
- Backhanded Guidance (t3-hf.ts, a GM reaction on a PC's roll): `pcRollAdversaryUses` runs a reaction only when the
  caller passes it in `reactions`, and no roll path does; it comes back as an offer. Not switched (its manual d6 stays).
- No Doom / Tentacle-style "spend Hope instead of HP" (`reduceWith: "hope"`) feature exists in tiers 3-4.

## Beads

- dcm-n7kt: **data done** (Fire Beam fire). The direct path is dcm-vvg1 (E7 lane); the bead is closable once vvg1 lands
  and the Fireproof reminder is dropped.
- dcm-5cn5: **closable** (E2.3 engine + this data; the Collect button stays the GM's).
- dcm-of7v: **closable** (Ill Omen data; Backhanded Guidance's reaction opt-in on the roll paths is not built: its
  manual d6 stays).
- dcm-trz9: **partly**: manual carries the answer; data waits on dcm-xcdy + dcm-sgn7.
- dcm-12kx (reminder drops): **not done here**: blocked by dcm-s7hd (Unstuck, Leechpoles), dcm-akc0 (Ravenous),
  dcm-v3ek (Afflicted).
- dcm-3ag5 (Transform data), dcm-qw4f (Seven-Headed data), dcm-1yo (Immovable Object data): data done.
- dcm-f70y: the changeForm half is proven live for Transform.

## Follow-ups filed

- **dcm-akc0** (lane:w1-e1-triggers-rolls): Ravenous `cannotSpendHope` is not read on a roll's Hope spends.
- **dcm-v3ek** (lane:w1-e8-session-features-rests): Afflicted `cannotClearHp` / `cannotClearStress` are not read by rest
  and downtime clears.
- **dcm-biaq** (lane:w1-e7-adversary-engine): Elemental Breath still offers a head Seven-Headed removed (refuse / hide a
  removed `choose` option).
- **dcm-sgn7** (bug, lane:w1-e7-adversary-engine): the adversary run's `goldOf` counts handfuls only, not bags.
- **dcm-xcdy** (vocabulary-gap, lane:w3-vocabulary): lose Hope per unit with the unpaid part as Stress (Weight of Opulence).

## Data switches ready for wave 11

- t4-hf.ts Fire Beam: drop `FIRE_BEAM_FIREPROOF` from both branches once dcm-vvg1 lands.
- t4-core.ts Reality Quake: after dcm-s7hd, drop the hit half of the Unstuck reminder; after dcm-q40t (spends), all of it.
- t4-hf.ts Burrowing Leechpoles: after dcm-s7hd, add `{ kind: "tokens", to: "targets", op: "add", amount: 2d4, holder:
  "recipient", name: "leechpole" }` in the fail branch and drop the reminder.
- t4-hf.ts Ravenous: drop the reminder after dcm-akc0. Afflicted: after dcm-v3ek.
- t3-hf.ts The Weight of Opulence: after dcm-xcdy + dcm-sgn7, `hope` lose `{ kind: "gold", who: "target", unit: "bag" }`
  with the shortfall as Stress; drop the manual.
- t4-hf.ts Elemental Breath: after dcm-biaq, drop the comment about removed heads still being offered.
- t3-hf.ts Backhanded Guidance: a `modifyRoll dieBonus` of a rolled d6 once the roll paths pass the GM's reaction opt-in.

## QUESTIONS

1. **Immovable Object on a move that is not an attack.** CB p.230: "Immovable Object - Passive: An attack that would move
   the Elemental moves them two fewer ranges (for example, Far becomes Very Close)." The passive is read by every server
   forced move (`forcedMoveReduceOf`), including ones that are not attacks (Hold the Line, CB p.342: "If an adversary
   moves within Very Close range, they're pulled into Melee range and Restrained"). Simplest reading taken: every
   forced move the server makes is shortened. Should a move that is not an attack keep its full range?

## Checks

`pnpm lint` clean, `pnpm typecheck` clean, focused tests (tests/unit/adversary-effects, tests/convex/lane4-s4-*) pass;
`pnpm test --maxWorkers=1 --testTimeout=120000`: 434 files, 10013 passed, 1 expected fail, 0 failed. Tracer guard S4.4 OK.

## Merge-time actions

None: no public function, schema, codegen or authz change. Only the four data files, their unit tests, the new
lane4-s4 test and this doc change.
