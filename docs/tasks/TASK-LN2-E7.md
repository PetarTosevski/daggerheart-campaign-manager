# TASK LN2-E7: adversary engine, round 2

Plan `.omc/plans/lanes-2.yaml`, tracer E7 (label `lane:w1-e7-adversary-engine`), wave 8. Continues round 1
(docs/tasks/TASK-LN-E7.md); V2's triage table (docs/tasks/TASK-LN-V2.md) lists the 47 beads and which half is E7's.
Worked in the brief's priority order (`.omc/plans/lanes-2-wave8-briefs.md`); the tail is listed below with notes.
No edits to the three effect `types.ts` files or `src/lib/srd/**`. Tests: `tests/unit/adversary-effects/lane-e7-round2.test.ts`,
`tests/convex/lane-e7-round2.test.ts`.

## What landed

`src/lib/domain/adversary-effects/run.ts`
- dcm-b3bb: `check.table` rows are translated like `then` / `otherwise` (a follow-up attack in a row gets the ATK and
  halved Evasion); `hasFollowUpAttack` and `followUpRoll` descend into rows. dcm-6n0p (drop Broken Magic's `fixed(2)`
  ATK workaround in t1-hf.ts) is now unblocked for wave 9.
- dcm-e16o: `AdversaryRunContext` takes `hopeOf`, `saveRaisers`, `creatureTokens`, `goldOf`, `chain`, `effectsOn`
  (forwarded to the card runner) and `creatures` (the numbers this runner resolves: upfront Fear, summon HP, countdown /
  spotlight prompts).
- dcm-iedr: `AdversaryPlan.conditionDetails`: per condition the plan gives, the entry's `mods`, `endsOnCaster`,
  `endsOnRoll`, `escape`, `record`, `endFear` (re-read from the entry by the condition's name; `conditionStepsOf`).
- `lastingModsOf(steps, label)`: the mods of the effect / condition step a stored effect came from.
- dcm-4c9m: the passive flag `attacksHalveEvasion` halves the target's Evasion on every attack (Never Misses).

`src/lib/domain/adversary-actions/features.ts`
- `adversaryNumberEnv` takes `creatures`.
- `AdversaryEvent` `pcEscapes` (dcm-xobk): the event shape is ready; no trigger kind matches it yet (bead dcm-j63t).

`src/lib/domain/adversary-actions/attack.ts`
- dcm-idz: `gmControlledWeaponAttack`: d20 + the weapon's trait vs Evasion / Difficulty; damage dice = Proficiency.

`convex/lib/validators/encounters.ts` (widen only: optional fields, no stored row changes, so no migration step)
- dcm-gx3: `instanceEffectValidator` gains `standardAttack {name, range, damage}`, `featuresRemoved`, `featuresAdded`.

`convex/lib/adversaryFeatures.ts`
- dcm-gx3: `blockOf` applies `evolvedBlock` (the latest `standardAttack` replaces the attack, ATK kept; removed features
  leave the feature list and the effect entries). `adversaryInstanceEffect`: an adversary `effect` step on itself or an
  ally becomes an instance modifier (`adv:<adversaryId>/<feature>:<n>`; Difficulty / attack / damage / HP-marked deltas,
  half damage, disadvantage, Evolution).
- dcm-xyw / dcm-yd5h / dcm-51s / dcm-346: `attackedRidersOn(sheet, adversaryId)`: riders from what a PC carries (an
  adversary feature's tag / condition, a card's effect), read back from the entry; `by` anyone / caster (same stat
  block) / others.
- dcm-mm0f (adversary half), dcm-f0m, dcm-bxp.99.19.3: `instanceBearerRiders(instance, on)`: riders on the instance's
  modifiers, and on its bare tags (a card's On Fire is stored as the tag alone: found by tag name in the SRD entries).
- dcm-e16o / dcm-ttz: `mapCreatures` (live map tokens with squares to the adversary and the first target; without a
  map, the party and the encounter's undefeated instances).
- dcm-idz: `gmControlOf(sheet)` (`GM-controlled` tag or `Mod gmControl`, with `asAdversary`'s stat block).

`convex/lib/adversaryActions.ts`
- The run context gets `hopeOf` (party Hope), `creatures`, `saveRaisers` (new arg `raisers`), `chain` (new arg `chain`)
  and `attackedRiders` (PC targets' riders).
- `Work` stores `effect` steps on itself / allies as instance modifiers (undo restores `effects`); GM lines for a
  condition's ends / escape (dcm-iedr); bearer-rider prompts when it acts or attacks (dcm-mm0f).
- dcm-idz: `gmControlledAttack`: a GM-controlled PC's weapon attack (or, under `asAdversary`, the stat block's ATK and
  standard attack) against other PCs (a reaction window, attacker `{kind: "pc", cardId: "gm-control"}`) or adversaries
  (Difficulty; a GM damage prompt).

`convex/adversaryActions.ts`
- `useFeature` args: `chain: string[][]`, `raisers: string[]` (checked like the other lists).
- `pending` returns `grants?` (dcm-5cn5: answers the attacker grants; E2 fills it). `respond` already takes whatever
  `hitChoiceValidator` (E2's validators/combatRequests.ts) holds, so E2's `grant` answer needs no change here.
- New `gmControlledAttack` (keyedGmMutation, rate limit `roll`): `{ characterId, targets, weapon? }`.

## Beads

| Bead | State | Notes |
|---|---|---|
| dcm-b3bb | done | Table rows translated; test. |
| dcm-e16o | done (engine + server) | creatureTokens / goldOf have no stored source yet (dcm-n3mp). |
| dcm-iedr | E7 half done | Plan carries the fields; GM lines. Stored ends on PCs: dcm-46q4 (E6). |
| dcm-mm0f | E7 half partly | Riders on an adversary bearer found and prompted (GM applies the steps); running the steps automatically is a follow-up. |
| dcm-yd5h | E7 half done | Adversary attacks on a PC bearer get the riders (`attackedRidersOn`). Instance-stored attackedRider for PC attacks is E1's read (the `adv:` / `card:` ids point at the entry). |
| dcm-xyw | done (server) | attackedRiders built from PCs' effects. |
| dcm-5cn5 | E7 half done | `pending.grants`; respond args flow through `hitChoiceValidator`. |
| dcm-gx3 | done (engine + server) | Wave 9: Hellwing's Claws (t3-hf.ts) can switch to `standardAttack`. |
| dcm-idz | done (minimal) | Server mutation; UI waits for dcm-bxp.99.32. Weredrake: attacks with the named stat block. |
| dcm-4c9m | done | Flag read; wave 9 data in t3-core.ts. |
| dcm-xobk | partly | `pcEscapes` event; trigger kind dcm-j63t (V3). |
| dcm-ttz, dcm-5xi, dcm-q0a, dcm-7az, dcm-xp0 | E7 half done | Context filled (creatureTokens: dcm-n3mp). Card-runner creatureCount: dcm-ldom (E3). |
| dcm-f0m, dcm-bxp.99.19.3, dcm-kti | partly | Prompted via bearer riders; drop the manual steps in wave 9 only once the steps run. |
| dcm-51s, dcm-346 | partly | `by: others` / `caster` via attackedRidersOn; `casterSpotlit`, `disadvantage.unlessTarget`, `best` not done. |
| rest (dcm-5jyp, nsqo, zi3k, z5a6, kvx4, wqgs, 3ag5, qw4f, 4yg4, k4x5, va0f, vf7i, c8h3, nh44, b77, eut, i55, jog, 3ou, a7o, 6ju, 63j, icd, 0gh, 1jg, 5xi UI, 145, 1ch, sos, ehgy) | not started | Out of time in this round; see follow-ups. |

## Follow-ups filed

- dcm-j63t (vocabulary-gap, lane:w3-vocabulary): `pcEscapes` AdversaryTrigger.
- dcm-n3mp (E7): store creature tokens / gold for the run context.
- dcm-ldom (E3): card runner NumberEnv `creatures`.
- dcm-46q4 (E6): end a PC's adversary-given condition on endsOnCaster / endsOnRoll.

## Merge-time actions (orchestrator)

- Authz entry (tests/convex/authz/adversary-actions.entries.ts):
  `{ fn: api.adversaryActions.gmControlledAttack, access: "gm", args: (w) => ({ characterId: w.characterA, targets: [w.ids.bear] }), okCodes: ["INVALID"] }`.
  `useFeature` args widened (`chain`, `raisers`; optional); `pending` returns widened (`grants`, optional).
- Regenerate `convex/_generated` (new public function).

## QUESTIONS

1. A GM-controlled PC's attack trait for a weapon with `trait: "choice"`: the highest trait is used. Book: Enthralled
   (HF p.92) "makes a weapon attack against them using a d20 instead of Duality Dice".
2. The spotlight of a GM-controlled PC (HF p.92 "spotlight them during a GM turn as if they were an adversary") is not
   counted toward the GM turn's spotlights (no Fear for a second spotlight). Should it be?
