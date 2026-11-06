# TASK-RULES-RDM: damage rules in the pure damage modules and the encounter tracker

Plan `.omc/plans/rule-switches.yaml`, tracer RDM (rules D2, D4, D5, D8, F3, Massive Damage). Built on RS0
(`docs/tasks/TASK-RULES-RS0.md`): modes come from `ruleModesOf(campaign)`, Manual notes from `postRuleNote`.

## What landed

| Piece | File |
|---|---|
| `DamageRules` (the five modes; `{}` = the Book), `isMassive`, `lastHp`, `stressFull`, `defeatedAfter`; every rule function takes the modes | `src/lib/domain/encounters/damage.ts` |
| `spotlightCostsFear(n, mode)`, `extraSpotlight(n)` | `src/lib/domain/encounters/spotlight.ts` |
| PC moves on creatures: `DamageOptions.rules`, `applyStressTo` / `applyHpTo` take the modes; results add `resistanceApplied: false`, `massive: true`, `lastHp: true` only when they apply | `src/lib/domain/combat-actions/damage.ts` |
| Hits on PCs: `pcSeverity`, `damageBeforeArmor`, `armorPreview`, `applyHitToPc` take `PcHitRules`; `stepDownMassive` | `src/lib/domain/adversary-actions/severity.ts` |
| PC sheet: `PcDamageRules`, `isMassiveDamage`, `hitPointsToMark` / `markStress` / `applyResourceDelta` take the modes, `pcVulnerableFromStress` | `src/lib/domain/characters/index.ts` |
| The tracker's mutations read `ruleModesOf(ctx.campaign)` and post the Manual notes; `applyDamage` returns `resistanceApplied`, `massive`, `lastHp` | `convex/encounterTracking.ts` |
| Tracker UI: modes from `ruleSettings.get` (Book until loaded), optimistic updates with the same modes, badges | `src/components/adversaries/tracker/{index.tsx,instance-card.tsx,use-tracker.ts}` |
| Tests | `tests/unit/rules/damage-modes.test.ts`, `tests/convex/rules-encounter-tracker.test.ts` |

Every new result field is present only when its rule changed something, so Book results are the same objects as
before and every existing test passes unchanged.

## Rules, book passages, behaviour

| Rule | Book passage | Book (unchanged) | Manual |
|---|---|---|---|
| D2 Resistance / immunity | CB p.99 "they halve damage of that type before comparing it to their damage thresholds"; CB p.107 "round up unless otherwise specified" | Halved, rounded up; immune takes none | Full damage; `resistanceApplied: false`; tracker note "Bear resists: halve? (17 taken in full; halved: 9)"; the damage box says "resists: not halved, GM's call" |
| D4 Stress overflow | CB p.92 "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead mark 1 Hit Point" | 1 HP | Extra Stress dropped, no HP, `overflow: true`; tracker note "Bear: Stress full, mark 1 HP?" |
| D5 Full Stress = Vulnerable | CB p.92 "When you mark your last Stress, you become Vulnerable"; CB p.178 | Card shows "Vulnerable · Stress full"; `vulnerable` true | Card shows "Stress full" only; `vulnerableFromStress` / `pcVulnerableFromStress` false; PC `markStress` adds `full: true` |
| D8 Defeated at last HP | CB p.208 "When an adversary marks their last Hit Point, they are defeated" | `defeated` set | `defeated` not set by marking HP; `lastHp: true`; card badge "Last HP"; note "Bear marked its last HP: defeated?" (once, when the last HP is reached); the tracker still lets the GM spotlight it. D8 is never applied to a PC target |
| F3 Extra adversary spotlight | CB p.153 "You can spend a Fear to make an additional GM move, shifting the spotlight to another adversary" | The 2nd+ spotlight of a GM turn spends 1 Fear (FEAR_EMPTY at 0) | Counted, no Fear, works at 0 Fear; note "Extra spotlight on Bear 2: spend 1 Fear?"; button "Spotlight · extra" |
| Massive Damage (optional) | CB p.91 "your table can implement a Massive threshold. If you ever take damage equal to double your Severe threshold, you mark 4 Hit Points" | Off: as today | On: damage (after resistance) at or above twice the Severe threshold marks 4 HP; severity stays `"severe"` (no new literal) with `massive: true`. PCs: Massive is a threshold above Severe, so an Armor Slot reduces it to Severe (3 HP), the next to Major |

Notes: the tracker's actions are not in the action log (no undo), so their notes carry no `groupId` and are never
undoable (a groupId would make Undo on the note look like it undoes the damage).

## Not done here (other tracers / outside owns)

- The map's attack paths (`convex/lib/combatActions.ts`, `convex/lib/adversaryActions.ts`, the reaction window) pass
  the modes in wave 2 (RC1, RC2). Until then they use the Book.
- D5 "attacks against it get advantage by themselves" and every other reader of "every HP marked = defeated"
  (`adversaryDefeated` in `convex/lib/spotlight.ts`, token `down` in `convex/lib/combatTokenViews.ts`, the HUD's
  `isDefeatedRow`, `convex/lib/adversaryFeatures.ts`) still use the Book: under D8 Manual the tracker keeps the
  adversary up, but the map greys its token and refuses its actions.
- F3 for adversary actions (`spotlightCost` in `src/lib/domain/adversary-actions/features.ts`, read by
  `convex/lib/adversaryFeatures.ts`) and the tracker panel's "Spotlight: 1 Fear" hint (`actions/model.ts`) follow the
  server's AA path, which RC2 wires.
- Bead dcm-bxp.99.32.4 (the tracker's spotlight lights the adversary's token on the live map via
  `spotlightAdversary`): not wired. Wiring it makes `combatSpotlight.gmTake({ pay: "fear" })` on an adversary already
  spotlit from the tracker a no-op (the GM already holds it), which breaks
  `tests/convex/spotlight-v2.test.ts` "an adversary already spotlit this turn is not counted twice" (expects the Fear
  paid). Needs a decision and that test file.

## Questions

1. D8 Manual, "until the GM marks it defeated": there is no "mark defeated" control. (a) add a "Defeated" button on
   the tracker card (a new mutation, an authz entry, and the other readers of "every HP marked" changed to the flag);
   (b) Manual = Book + the note only; (c) keep what landed (tracker only, the rest of the app treats every HP marked as
   defeated).
2. Massive Damage on a PC with an Armor Slot (CB p.91 "a Massive threshold"; CB p.114 "reducing the severity of the
   damage by one threshold"): (a) Massive → Severe (built); (b) Massive → Major (the slot removes Massive and one
   threshold); (c) armor can't reduce Massive.
