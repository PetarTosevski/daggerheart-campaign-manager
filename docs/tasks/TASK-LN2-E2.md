# TASK LN2-E2: Incoming damage and the reaction window, round 2

Plan `.omc/plans/lanes-2.yaml`, tracer E2 (label `lane:w1-e2-damage-window`, wave 8). Book pages are printed pages
(CB = Core Book, HF = Hope & Fear). No SRD data and no `types.ts` were touched; the engine is tested with fixture
entries and the SRD entries that already carry the vocabulary. Which half of each bead is E2's comes from V2's triage
table (`docs/tasks/TASK-LN-V2.md`). dcm-5cn5 (moved to E7) and dcm-22q (wave-9 cross-lane tracer) are skipped, as the
brief says; dcm-6ju's E2 half is Money Talks through dcm-5cn5, so it goes with it.

## Beads

| Bead | State | How |
|---|---|---|
| dcm-dv6 Fire keyword (E2 half) | **done** | `hitKeyword` / `hitKeywordOf` (`adversaryHits.ts`): the keyword of the attacking feature's `damage` step (a PC attacker: the card's). `WindowHit.keyword`; a `whenYouWouldTakeDamage.keyword` trigger (Fireproof) doesn't fit a hit with another keyword, an unknown keyword still offers it (Q13); a `keyword` resistance holds only on a hit carrying it. Read at open and on every rebuild, like the armor cost. |
| dcm-nt4 Rejuvenation Barrier | **done** | `resistanceHolds(…, { attackerAreas, sourceId })`: `from: "outsideArea"` fails only when the attacker's token stands in a live area of the same source (`attackerAreasOnMap`: E4's `activeAreasOnMap` / `areaFactsFor`); no map or no token: it holds (Q18). |
| dcm-kvx4 Burrowing Leechpoles (E2 half: PC hits) | **done for fixed amounts** | `PcDefense.damageTakenBonus` from the PC's `damageTaken` `add` mods (`pcDamageMods`), added before resistance and thresholds in `damageBeforeArmor`; damage reduced to 0 gains nothing. A `creatureTokens` amount reads 0 until a PC's named tokens are stored (dcm-0n1u, E7). |
| dcm-fbsr Unstuck (E2 half: marks on hits) | **done** | `PcDefense.marksMultiplier` from the PC's `marksMultiplier` mod (largest factor; the tracks it names). `applyHitToPc`: HP marks, Stress instead of HP, Hope instead of HP (each covered mark costs the factor; the rest is HP) and Boiling Blast's `alsoMark` multiply; Armor Slots mark `factor` each, capped at a full track, the step-down unchanged. Previews (`armorPreview`, `progress`, `targetArmorPreview`) show the multiplied HP. E3 owns the cost side. |
| dcm-t8c Hit end events (with dcm-utu, dcm-4qv, dcm-wjv E2 halves) | **done** | `hitEndEvents` (`incomingHits.ts`) runs E6's `damageTaken` occurrence on the resolved hit: the bearer side on the hit PC (`endOnSheet`: Transform's `takeDamage`, Night's Glamour's `markHp`) and the caster side on the party (`endForCasterOnSheets`: Eye of the Storm's `takeSevere`; allies' sheets saved and logged in the hit's group, undoable). Riders skip conditions the PC's effects refuse (`refusedConditions`, Unstoppable). A maintainable effect (Night's Glamour) drops and is offered after the hit as `maintain:<effect id>` (a feature-shaped answer "Keep Glamoured"): paying (`payToMaintain`: Stress, Unshakable rolls on it) puts the effect back from the hit's logged `before`; pass leaves it dropped. |
| dcm-ofo (with dcm-3i4, dcm-uj0 E2 halves) | **done** | `whenAllyWouldTakeDamage.unlimited` ignores the range (Enchanted Talisman, Rune Ward held by an ally). `actorWithSubject` carries the subject's Stress, Armor Slots, Hope and held items; `featureActor` fills `facts.items` from the inventory names (`holdsItem`). `usedArmor` after the window was already on `HitResolution` (round 1); the gate itself (dcm-sos) is E7's. |
| dcm-bxp.99.19.4 Armored Shell's Armor Score (E2 half) | **split** | The window can't fill `NumberEnv.self.stats`: `card-effects/run.ts` (E3) builds `env.self` from hp/stress/armor and `ActorState` has no stats field. Follow-up **dcm-91tx** (E3), then E2 fills it from `derivedThresholds`. |
| dcm-zi3k Tentacle Rays (E2 half: Hope before forced HP) | **split** | Follow-up **dcm-nnbl**: needs E7's rider producer to pass `reduceWith`, then an `hp` rider widen, a `hopeReduce` hit choice and the prompt input. |

Labelled `lane:w1-e2-damage-window` but triaged to other lanes by V2 (no E2 half): dcm-bxp.99.19.3 Poisoned and
dcm-0wj1 On Fire (E7, bearer acts), dcm-kti (E7 + E1), dcm-sos (E7), dcm-18i (E3), dcm-raa (E1), dcm-9gw and dcm-kso9
(need mods on an instance effect: `convex/lib/validators/encounters.ts` is E7's, widen → migrate → narrow; then the
PC attack path in E1's `combatActions.ts`). They should be relabelled by the orchestrator.

## What changed

| File | What |
|---|---|
| `src/lib/domain/adversary-actions/severity.ts` | `PcDefense.damageTakenBonus`, `marksMultiplier`; `marksFactor`; `damageBeforeArmor`, `armorPreview`, `applyHitToPc`. |
| `src/lib/domain/adversary-actions/window.ts` | `WindowHit.keyword`; `triggerFits` (unlimited, keyword); `actorWithSubject` (subject facts); `progress` / `targetArmorPreview` multiply HP. |
| `convex/lib/adversaryHits.ts` | `pcMods` (shared), `pcResistance` (keyword, areas), `pcDamageMods`, `resistanceHolds` (keyword, outsideArea), `hitKeyword(Of)`, `attackerAreasOnMap`, `windowHitOf(…, keyword)`, `windowParty` / `rebuildWindow` scope; `featureActor` items; `applyRiders(…, refused)`. |
| `convex/lib/incomingHits.ts` | `openIncomingHit` keyword + areas; `resolveIncomingHit` end events and refused conditions; `hitEndEvents`, `maintainId`, `payToMaintain`, `maintainViews` in `hitView`, `respondAfterHit` maintain branch. |
| `tests/convex/lane-e2-round2.test.ts`, `tests/convex/lane-e2-ends.test.ts` | New. |

No schema, validator or public function args changed: no authz entry, no migration. The maintain offer rides the stored
`afterHit.cardIds` (strings) and the existing `feature` answer.

## Data switches ready for wave 9

- `heritage-hf.ts`: Fireproof's check box can go (hits carry `keyword: "fire"` from the attacker's `damage` step; adversary data must set `keyword` on its fire `damage` steps).
- `t4-hf.ts` (Burrowing Leechpoles): a `damageTaken` `add` mod works for a fixed amount; the per-leechpole count waits on dcm-0n1u.
- `t4-core.ts` (Unstuck): `marksMultiplier` on hits works (the cost side is E3's).
- Rejuvenation Barrier (`outsideArea`), Enchanted Talisman / Rune Ward (`unlimited`, `holdsItem`): engine ready.
- Transform, Night's Glamour, Eye of the Storm: already switched; now honoured on hits to PCs (R1's tokensGone / endEffect reminders are not affected by this lane).

## QUESTIONS

1. Unstuck on Armor Slots (CB p.237: "must double the amount spent or marked"): built as two slots marked for one slot's
   benefit (capped at a full track). If only one slot is free, the PC can still use it. Simplest reading; confirm.
2. Burrowing Leechpoles (HF p.90: "any damage the target takes gains a +1 bonus"): added before resistance halves it.

## Checks

`pnpm lint` clean; `pnpm typecheck` clean; `pnpm vitest run --maxWorkers=2 --testTimeout=120000`: 382 files, 9411
passed + 1 expected fail, 1 failure: the load-flaky `auth-signup` flood test, which passes when rerun alone.
