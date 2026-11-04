# TASK LN-E2: Incoming damage and the reaction window

Plan `.omc/plans/lanes.yaml`, tracer E2 (label `w1-e2-damage-window`, depends on V). Status: Review. Book pages are
printed pages (CB = Core Book, HF = Hope & Fear). No SRD data was touched: wave 5 switches the entries to the new
vocabulary; the engine is tested with fixture entries (`tests/convex/lane-e2-*.test.ts`).

## Beads

| Bead | State | How |
|---|---|---|
| dcm-fyb Auto "Got hit" | **done** | `resolveIncomingHit` runs `expire(sheet, "hit")` on the PC who took the hit when an adversary's attack roll succeeded (`attackSucceeded`: an adversary attacker and an attack total; a feature's reaction-roll damage has none, a PC's card damage on an ally is left to the button). It runs before this attack's riders land; the sheet goes into the hit's public row, so the GM's undo restores it. The manual Got hit button (`convex/classFeatures.ts`) is unchanged. |
| dcm-98d Unyielding Armor | **done (engine)** | `whenArmorSlotMarked.stage: "would"` fits the hit PC while they can mark a slot and is no longer offered once the armor answer is in (`wouldMarkArmor` in `answerScope`). With `reduceSeverity.insteadOfArmorSlot` (DA0) a 6 is the hit's armor reduction: no slot marked, the armor answer is in; no 6 leaves the slot to answer. Data: wave 5 sets `stage: "would"` and `insteadOfArmorSlot` on `valor.ts` (and Unyielding, the Epic Aquatic Beast's feature, `beastforms.ts`). |
| dcm-s77 Armor Eater, Tormenting Lash, Rending Jaws, Boiling Blast | **done (engine)** | `severity.ts` `ArmorCost` on the hit (`slotsPerStep`, `alsoMark`): `armorOptions` / `armorPreview` / `applyHitToPc` count whole steps (a slot short of a step buys nothing and isn't marked), `alsoMark` marks Stress (CB p.92 overflow, Unshakable rolls on it) or HP per slot used. The server re-reads it from the attacker's stat block (`hitArmorCost` / `armorCostOf` in `adversaryHits.ts`: the attacking feature's own `armorCost` steps, and every auto use on a plain "successful attack" `onHit`). The window, the prompt's preview (0, 2, 4), `respondToHit` (INVALID for a count that isn't a whole step) and the prompt ("Mark 2 Armor Slots to make it Minor?", `armorCounts`) follow. Data: wave 5 writes the steps (Armor Eater `t2-hf.ts`, Tormenting Lash / Boiling Blast `t4-core.ts`, Rending Jaws `t3-hf.ts`). |
| dcm-sim Shield Aura | **done (engine)** | New in the window: a marked Armor Slot sets off the party's automatic card uses on `whenArmorSlotMarked` (`armorSlotAutos`: who `self` / `ally`, free and ready uses only, dice seeded per hit so a rebuild is stable); their folds join the hit (Shield Aura's extra step, today's entry already works through it). `resolveWindow` lists `endedOnNoHp`: when a card answer's or auto's own folds made the difference between Hit Points and none and the card says `endsOn: ["reducedToNoHp"]` on a condition or effect step; `resolveIncomingHit` takes that tag / condition / effect off the bearer (`endedOnNoHp`) and says so in the feed. Data: wave 5 adds `endsOn: ["reducedToNoHp"]` to Shield Aura's condition and drops its manual step (`splendor.ts`). E6 owns other end events; this one is read where the hit resolves. |
| dcm-nt4 Rejuvenation Barrier | **partly** | PCs had no resistance in the window at all (`PcDefense.resistance` was never filled). `pcResistance` (`adversaryHits.ts`) now reads it from the sheet: effects a card or feature wrote (their `effect` / tag `condition` step of that label: Retract, Rejuvenation Barrier, Book of Yarrow) and passive feature uses without a requirement (Armored Shell); each type takes its strongest level. `from: melee / beyondMelee` read the attacker's band (unknown: any, Q18); `from: "outsideArea"` holds while the engine can't place the attacker (see QUESTIONS 1); a `keyword` resistance needs a hit keyword (none yet, dcm-dv6 is E7's). The barrier as an area that follows the caster is E4's area runtime. |
| dcm-sos Hobbling Shot, Suppressing Blast, Draining Bite, Rend and Crush | **partly** | `HitResolution.usedArmor` (the target marked Armor Slots for this hit) is what the `usedArmor` state check reads after the window. Re-running the attacking feature's `targetMarkedHp` / `targetCheck usedArmor` steps after the window belongs in `afterHitTriggers` (`convex/lib/adversaryActions.ts`, E7's file): follow-up filed. |
| dcm-18i can't mark an Armor Slot | **not** | The fallback is evaluated when the attack runs, where `markArmor` meets a full track: `card-effects/run.ts` `markArmor.ifUnable` (E3's file); `adversary-effects/run.ts` then counts the marked slots into `forcedArmor` as now. Follow-up filed for E3. |
| dcm-6ju Money Talks, Double or Nothing | **not** | Money Talks needs a hit-PC answer the attacker grants (gold instead of HP): a new stored `HitChoice` kind in `convex/lib/validators/combatRequests.ts` (outside owns) plus E3's `optional.by`. Double or Nothing is a roll (E1). Follow-up filed. |
| dcm-9gw Breaking Blow, Chokehold | **not** | Damage other attackers deal to the bearer of an `attackedRider`: the PC attack path (`convex/lib/combatActions.ts`, E1) and the instance effect store (`instanceEffectValidator`, V's note 3). Follow-up filed. |
| dcm-kti conditions with riders | **not** | Riders on the bearer's own rolls and actions run where the bearer rolls or acts: PCs in E1's roll path, adversaries in E7's engine. Follow-up filed. |
| dcm-bxp.99.19.3 Poisoned's 1d10 each time the bearer acts | **not** | Same as dcm-kti (`bearerRider on: "acts"`). Follow-up filed. |
| dcm-raa Grace-Touched, would force HP | **not** | The PC's own attacks and `markHp` steps (`combatActions.ts` E1, `cardRunner.ts` E4); the window only sees damage to PCs. Follow-up filed. |

Not in this lane's label but named in the brief: dcm-22q (Grace-Touched's Armor Slot instead of a Stress; label
`lane:w0-a-drawer-engine`). Not built: "asked each time, every Stress" is a prompt before every server Stress mark
(costs paid in the card runner, feature runner, Hand, rests, hits), most of it outside E2's files.

## What changed

| File | What |
|---|---|
| `src/lib/domain/adversary-actions/severity.ts` | `ArmorCost`, `slotsPerStep`, `armorSteps`; `armorOptions`, `armorPreview`, `applyHitToPc` in whole steps and `alsoMark`. |
| `src/lib/domain/adversary-actions/window.ts` | `wouldMarkArmor` (dcm-98d); `realStepsChosen` (dcm-s77) in `substituteBlocked`, `progress`, `targetPrompt`, `targetArmorPreview`; `armorSlotAutos`, `allFolds`, `endsOnNoHp`, `WindowResolution.endedOnNoHp` (dcm-sim). |
| `convex/lib/adversaryHits.ts` | `pcResistance`, `resistanceHolds` in `windowPcOf` (dcm-nt4); `hitArmorCost`, `armorCostOf`, `windowHitOf(…, armorCost)`, `rebuildWindow` (dcm-s77). |
| `convex/lib/incomingHits.ts` | `openIncomingHit` reads the armor cost; `respondToHit` refuses a part step; `resolveIncomingHit`: `expire(…, "hit")` (dcm-fyb), `endedOnNoHp` (dcm-sim), `HitResolution.usedArmor` (dcm-sos). |
| `src/components/combat-map/actions/reactions/{model.ts,prompt.tsx}` | `armorCounts`: the slot counts from the server's preview; the question for one dearer step. |
| `tests/convex/lane-e2-window.test.ts`, `tests/convex/lane-e2-hits.test.ts` | New. |

No schema or validator change, no new public function (no authz entry needed). `pending`'s returns validator is unchanged:
the prompt reads the dearer slots from the existing `armorPreview`.

## Tests

- `tests/convex/lane-e2-window.test.ts` (pure, fixture entries): dearer slots in `armorOptions` / `armorPreview` /
  `applyHitToPc` (2 slots one step, 1 slot nothing, an extra allowance in whole steps, Boiling Blast's Stress and its
  overflow), the window and the prompt model for Armor Eater, `hitArmorCost` on fixture stat blocks; Unyielding Armor
  offered before the armor answer only, a 6 is the armor reduction, no 6 leaves the slot; Shield Aura's auto step on a
  marked slot, its end at 0 HP only when the aura made the difference, `endedOnNoHp` on the sheet; `resistanceHolds`;
  `attackSucceeded`.
- `tests/convex/lane-e2-hits.test.ts` (convex-test): Dodge ends on a successful Bear attack and comes back on undo, stays
  without an attack roll and on an ally; Retract halves 17 to Major (2 HP); a fixture Armor Eater on the Bear (the stat
  block's entries mocked): preview 0 / 2, one slot INVALID, two slots Minor.

## Checks

`pnpm lint` clean; `pnpm typecheck` clean; `pnpm test`: 366 files, 9086 passed + 1 expected fail, 4 failures on a loaded
machine (load average ~38: three jsdom 15 s timeouts and the sign-up flood's rate-limit count) that pass when rerun alone
with `--testTimeout=60000` (`auth-signup`, `domain-deck-level-up`, `sheet-render`, `sprite-cut`; none touches this lane).
e2e (`incoming-hit.spec.ts`, `combat-feature-reactions.spec.ts` on ports 3161 / 3434): the backend set up, but the e2e
build failed before any test ran (`next/font/google` could not fetch IBM Plex Sans from the sandbox), so the prompt change
(`armorCounts`) is covered by the model test only; the orchestrator's wave e2e run covers it.
`node scripts/tracer-guard.mjs .omc/plans/lanes.yaml E2 rebuild HEAD` passes.

## QUESTIONS

1. **Rejuvenation Barrier outside the barrier** (CB p.339: "you and all allies within have resistance to physical damage
   from outside the barrier"). Without E4's area runtime the engine can't tell whether the attacker stands inside, so the
   built reading keeps the resistance (as Q18 reads an unknown range). Should an unknown position drop it instead?
2. **Dearer slots and an extra slot** (Armor Eater, HF p.71: "must mark an additional Armor Slot to reduce the severity";
   Iron Will, CB p.36: "you can mark an additional Armor Slot"). Built: an extra allowance is one more step at the dearer
   price (Iron Will under Armor Eater: 4 slots for 2 steps). Or should Iron Will's extra slot pay Armor Eater's extra
   slot (2 slots, 1 step)?
3. **Dearer slots and a slot substitute** (Stable, HF p.12: "spend a Focus instead of an Armor Slot"; Celestial Wings).
   Built: unchanged, one Focus / Hope is the hit's one step even under Armor Eater. Should it cost 2 Focus / Hope?
4. **Boiling Blast per slot** (CB p.236: "If a target marks an Armor Slot to reduce the damage, they must also mark a
   Stress"): built as one Stress per slot marked (V's `alsoMark` "per slot used"); with I Am Your Shield's several slots,
   is it one Stress per hit instead?

## Follow-ups filed

| Bead | Lane label | For |
|---|---|---|
| dcm-nsjj | `lane:w1-e3-steps-saves` | dcm-18i: `markArmor.ifUnable` in `card-effects/run.ts` |
| dcm-ehgy | `lane:w1-e7-adversary-engine` | dcm-sos: re-run the gated steps in `afterHitTriggers` (reads `HitResolution.usedArmor`) |
| dcm-5cn5 | `lane:w1-e2-damage-window` | dcm-6ju: a granted hit-PC answer (needs the stored choice and `respond` / `pending` validators widened) |
| dcm-yd5h | `lane:w1-e1-triggers-rolls` | dcm-9gw: `attackedRider` damage on attacks against the bearer |
| dcm-mm0f | `lane:w1-e1-triggers-rolls`, `lane:w1-e7-adversary-engine` | dcm-kti, dcm-bxp.99.19.3: bearer riders where the bearer rolls or acts |
| dcm-gtmp | `lane:w1-e1-triggers-rolls` | dcm-raa: "would force a target to mark HP" on the PC's own attacks and `markHp` steps |
