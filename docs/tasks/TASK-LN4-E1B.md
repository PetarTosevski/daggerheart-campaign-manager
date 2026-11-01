# TASK-LN4-E1B: attack and roll paths round 4 (plan lanes-2, wave 10, tracer E1.4b)

Branch `lane4-e1b`, label `lane:w1-e1-triggers-rolls`. Owns: `convex/lib/combatActions.ts`, `convex/combatActions.ts`,
`convex/combatRequests.ts`, `convex/lib/rolls.ts`, `convex/rolls.ts`, `src/components/combat-map/actions/attack/**`,
`src/components/party/dice/**`, `tests/convex/combat-riders.test.ts`, `tests/convex/authz/combat.entries.ts`,
`tests/{convex,unit}/lane4-e1b-*.test.ts`, `tests/e2e/lane4-forced-attack.spec.ts`, this doc. Built on V4 (7769fa95).

## What landed (priority order)

1. **dcm-svux, per-target edges** (CB p.104, p.100; user answer 2026-11-01: ONE d6 rolled once). `targetEdge` gives each
   target its own edge (conditions, `disadvantageAgainst`, rider advantage). Same edge on every target: the old path (the
   edge goes into the roll). Different edges: the roll is made without them and `perTargetDeltas` compares per target: the
   roller's own advantage / disadvantage / help plus that target's edge through `advantagePlan`, read from one pool (the
   record's advantage or disadvantage die is the shared d6; a missing one is drawn once, recorded so a held attack replays
   it). Hits, GM miss lines and rider-added targets use the per-target total; the public row says
   `[edge d6 4: Brute 15, Imp 11]`. `targetsEdge` (the old common-edge reading) stays exported for its wave-9 test.
2. **dcm-uxsd, player half**. New player query `combatRequests.forcedAttacks` (the open `forcedAttack` requests on
   characters the caller edits; GM: all; names only). `combatActions.attack` takes `forcedRequestId`: the request must be
   open, this character's, its encounter running (else declined + REQUEST_NOT_OPEN), and `targetTokenIds` exactly its
   locked targets (else INVALID). The GM chose the targets, so no range sanction is asked. The attack's rows join the
   forcing use's `groupId`; the request is resolved. Attack bar: a "you must attack X" row with "Make the attack", which
   locks the targets (with "Not now"). Internal `combatRequests.seedForcedAttackForE2e` (local e2e backend only) seeds the
   row for the e2e spec until E7.4's opener is merged.
3. **dcm-hqk1, Reliable Backup tick** (CB p.43). `resolveDuality` swaps the Hope Die to a live situational `dualityDie`
   mod's sides when the roll's `situations` include its situation (`situationalHopeDie`; `hopeDieSwitch` and
   `withHopeSides` moved to convex/lib/rolls.ts, re-exported from combatActions). `rollEndsOnSheet` ends an effect whose
   `RollEnd.situation` is set only on a roll marked as it (`rollEndSituationHolds`). `liveMods` now also reads the effect
   steps of an entry's upgrade options (Reliable Backup's "backup" option lives in Contacts Everywhere's upgrades). Dice box:
   on a Presence roll, "In conversation: use <effect> (d20 Hope Die)" per held situational die (`situations.ts`).
4. **dcm-m7tm, roll / attack half**. `resolveAttack` (after the after-roll step, never on a held attack: the call writes)
   and `rolls.duality` call `pcRollAdversaryUses` and fold its `bonuses` with `withDieBonuses` (moved to rolls.ts; no
   critical, tie with Fear); the outcome's Hope / Stress / Fear follow; named in the public row ("Ill Omen +3 Fear Die"),
   its lines in a GM row.
5. **dcm-l1er** (user answer: automatic). `bearerRiderRuns`: the `bearerRider`s of what the PC carries that ride on the
   roll (`bearerRiderFires`: `actionRoll` / `acts` on action rolls, `attack` on attacks, the `roll` filter) run as a card
   plan on the bearer before the roll, with the server's dice (a typed-in roll types only its own dice), inside
   `resolveDuality` (so plain rolls, attacks and moves all get them). Named in the roll's row ("Poisoned: marks 1 Stress").
   A cost the bearer can't pay refuses the roll (DICE_RULE, Shadow Shackles CB p.222); a rider the runner refuses stays a
   reminder line. `bearerRollMods` no longer adds reminders.
6. **dcm-kso9 + dcm-j5aw reader** (user answer 2026-11-01 Q3). `instanceAttackedRiders` takes the attacker's ids; `by:
   "others"` / `caster` read the caster recorded on the instance (the marker's `~<caster>` suffix, a token or character id;
   a tag's caster from a marker of the same label) and fall back to the old holder rule. `combatActions.targets` hints carry
   `benefits` (the `attackerSteps` and their `choose` options); the Attack bar shows them as radio buttons (first option
   preselected) and sends `benefit`. `resolveAttack` runs the picked option's steps on the attacker (`attackerStepsRun`),
   logs it in the group, and removes the rider's tag / condition / marker from the instance, hit or miss (`onSuccess`
   riders: hits only), with the instance's full before in the GM row (undo puts it back).
7. **dcm-wli0, attack / roll half**. `resolveAttack` ends adversary-given conditions on the attack roll
   (`endAdversaryConditionsOnRoll`) and, last, calls `endAdversaryConditionsForCaster` for every instance it damaged (in
   the attack's group). `rolls.duality` ends them on the plain roll.
8. **dcm-b41o + dcm-7udv + dcm-iia9**. `riderFacts`: a feature rider's `extraFacts` get the target and the trigger
   subject (adversary or PC) wrapped in `withCreatureAreas`, and `weapons.attacking`. `afterRollOffers` passes
   `payerFlags(sheet)` (live mods + carried mods) to `featureCostShort`.
9. **dcm-1sk4 consumer**. `rollFromStored` copies V4's `spiritWeapon`; tested through a sanction approval.
10. **dcm-lbai**. `setupReach(picked)`: `modifyRoll reach` steps of the riders taken with the attack (a `choose` option
    counts when picked) widen `checkTargets`' range; the attack picks its riders before the range check.

## Beads

| Bead | State |
| --- | --- |
| dcm-svux | closable |
| dcm-uxsd | player half done (closable for E1); PC targets and the after-roll hold: dcm-8cst |
| dcm-hqk1 | engine + dice box done; closable once S2.4 switches ranger-rogue.ts (and dcm-nxp4 for non-plain paths) |
| dcm-m7tm | roll / attack half done (card half E1.4a); undo of the uses' writes: dcm-ydus |
| dcm-l1er | closable |
| dcm-kso9 | engine + Attack bar done; closable once S1.4 switches valor.ts; held / sanctioned attacks lose the pick (dcm-l2e2) |
| dcm-j5aw | reader half done; closable with E1.4a's writer half |
| dcm-wli0 | attack / roll half done (was already marked closed in bd; card half E1.4a) |
| dcm-b41o, dcm-7udv, dcm-iia9 | combatActions half done: closable (incomingHits subject facts are E2's) |
| dcm-1sk4 | closable |
| dcm-lbai | closable (S2.4 may drop the reminder beside the data) |
| dcm-84b2 | closable: already fixed by dcm-lfbf (combat-riders 'Kick' pins Hope 6 / Fear 3) |
| dcm-bxp.99.19.64 | dice box and Attack bar halves done (both read `derivedTraits(withEffects(sheet))`, E1.3b); vision half is E4.4's |
| dcm-iddp | NOT done (time): PC attacks emitting adversary events, mindImmune |
| dcm-cj8 | NOT done (time): attack on the Wild Fortress dome |
| dcm-gtmp / dcm-raa, dcm-g6t / 1o3 / 0gi / 3ft / iu4 | not taken (time) |

## Follow-ups filed

- dcm-nxp4 (lane:w1-e6-endings-durations): `rollEndHolds` honours `RollEnd.situation` on every roll path.
- dcm-l2e2 (vocabulary-gap, lane:w3-vocabulary): the stored sanction / after-roll roll carries `benefit`.
- dcm-8cst (lane:w1-e1-triggers-rolls): forced attack on a PC target, through an after-roll hold, and a decline.
- dcm-ydus (lane:w1-e7-adversary-engine): `pcRollAdversaryUses` returns its instance befores for undo.

## Data switches ready for wave 11 / batch B

- `src/lib/srd/feature-effects/ranger-rogue.ts` (S2.4, dcm-hqk1): the "backup" option's effect step may carry
  `mods: [{ kind: "dualityDie", die: "hope", sides: 20, situation: S.conversation }]` and
  `endsOnRoll: { roll: "presence", situation: S.conversation }`; the `backup` rider (`beforeYouRoll` + situation) can go.
  The step label must stay the effect's text (the dice box and `liveMods` find it by label).
- `src/lib/srd/card-effects/valor.ts` (S1.4, dcm-kso9): Lead by Example's condition may carry
  `mods: [{ kind: "attackedRider", rider: { by: "others", attackerSteps: [{ kind: "choose", id: "benefit", label: ..., options:
  [{ id: "stress", label: "Clear a Stress", steps: [clear self stress 1] }, { id: "hope", label: "Gain a Hope", steps: [...] }] }] } }]`
  and drop the manual step. Exclusion of only the placing PC needs E1.4a to record the caster on the marker.
- `src/lib/srd/feature-effects/druid-sorcerer.ts` (S2.4, dcm-lbai): Manipulate Magic's reach reminder can go.
- `src/lib/srd/feature-effects/seraph-witch.ts` (S2.4, dcm-xbtw): the per-attack confirm rider can go (dcm-1sk4 done).
- Adversary `bearerRider`s (Poisoned, Envelop, Ignite, Shadow Shackles, Covered in Spiders): run now; their reminders in
  data (if any) can go.
- t4-hf.ts Ill Omen `modifyRoll dieBonus` (S4.4): the attack and plain roll paths fold it.

## QUESTIONS

1. **Forced attack range.** Beguiled (HF p.75): "a Beguiled PC must mark a Stress or attack a target chosen by the
   Gobstalker." I treat the GM's chosen target as already sanctioned: a forced attack out of the weapon's range resolves
   without the out-of-range sanction (CB p.103-104 range rules otherwise apply). Alternative: still ask the GM. Which?
2. **Bearer riders' timing.** Poisoned (CB p.211: "must roll a d6 before they make an action roll"), Ignite (CB p.215-216).
   Every bearer rider runs before the roll (its own dice, then the roll), whatever its `timing`; none of them reads the
   roll's result. Fine, or should `timing: "after"` riders wait until after the roll?
3. **Lead by Example with no pick.** The Attack bar preselects the first option. A call without `benefit` (an old client,
   a GM sanction) uses the rider up with no benefit taken. Fine, or should it default to the first option?

## Merge-time actions

- Authz: new public query `combatRequests.forcedAttacks` (entry added in combat.entries.ts). `combatActions.attack` gains
  optional `forcedRequestId` and `benefit`; `combatActions.targets` returns optional `benefits`. New internal
  `combatRequests.seedForcedAttackForE2e` (no entry: internal). No new module: codegen only refreshes `api.d.ts` types
  (run it; the functions are typed through the module already).
- `convex/lib/rolls.ts` now imports `./adversaryActions` (`pcRollAdversaryUses`): a new import cycle edge
  (adversaryActions → cardRunner → rolls); every use is inside functions, so module order doesn't matter.
- E7.4's opener (convex/lib/forcedAttacks.ts) should write the V4 `forcedAttack` payload with the forcing use's
  `groupId`; the player half reads `characterId`, `targetTokenIds`, `instanceLabel`, `feature`.
- E1.4a: record the placing PC on the instance marker (`~<token or character id>` suffix, or a marker of the tag's label)
  for dcm-j5aw; the reader accepts either id.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- Focused: lane4-e1b-pure (10), lane4-e1b-attack (7), unit lane4-e1b-situations (2), authz combat + matrix (359), and the
  existing attack / roll files (combat-attack, combat-riders, lane-e1-*, lane3-e1b-*, rolls*, beastform-rolls: 146).
- Full suite (`pnpm vitest run --maxWorkers=1 --testTimeout=120000`): 422 files, 9866 passed, 1 expected fail.
- E2E: `E2E_PORT=3175 E2E_CONVEX_PORT=3462 pnpm test:e2e tests/e2e/lane4-forced-attack.spec.ts`: 1 passed.
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml E1.4b rebuild HEAD`: OK.
