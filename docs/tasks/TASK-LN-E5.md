# TASK LN-E5: state checks, requirements, limits, costs, number sources, slots

Plan `.omc/plans/lanes.yaml`, tracer E5 (label `w1-e5-checks-limits-numbers`), after tracer V widened the vocabulary
(docs/tasks/TASK-LN-V.md). E5 replaces V's fallbacks in its own files with real evaluators. Everything here is pure: a
check is decided from the facts the caller passes, and a fact the caller does not pass keeps today's behaviour (the
player confirms the situation, Q13; a number source reads 0). Filling the facts happens in other lanes' files, so each
of those got a follow-up bead (label `e5-followup`). No SRD entry changed (wave 5 switches them over).

## What changed

- `src/lib/domain/card-effects/availability.ts`
  - `stateCheckMet` decides every widened `StateCheck`: `track` (marks / free slots / Hope of self, target or subject),
    `tokens` (this card's or feature's tokens, or named tokens on a creature), `within`, `allyNear`, `weaponRange`
    (`primary` / `secondary` / `either` / `attacking`), `holdsItem`, `usedOnBefore`, `usedArmor`, `moonPhase`, `not`,
    `anyOf` (true if one holds, false if all are known false, else unknown), and `inArea` for the subject or target.
  - `StateFacts` gained `armorMax`, `cardTokens`, `tokens`, `items`, `nearestAlly`, `weapons`, `usedOnBefore`,
    `usedArmor`, `moonPhase`; `CreatureFacts` gained optional `stress`, `stressMax`, `armor`, `armorMax`, `hope`,
    `tokens`, `items`, `distance`, `nearestAlly`, `areas`; `RequirementState` gained optional `hopeMax`.
  - Per-target memory: `usedOnKey`, `usedOnBefore(sheet, key, targetId)`, `recordUsedOn(featureUses, key, targetId, since?)`.
  - Limits: `limitPeriod(limit)` (`period` over `per`); `exhaustKey(featureUses, key, per, times)` for the `exhaust`
    step; `RESET_LABEL` and `keyAvailability`'s order know `gmTurn`, `day`, `week` ahead of the validator widen.
  - Costs: `unaffordableBy(costs, paidBy, payers)` checks the paying creature (null when its state is unknown).
- `src/lib/domain/combat-actions/numbers.ts`: every widened `NumberSource` resolves: `free`, `dualityDie`, `stat`,
  `creatureCount`, `gold` (CB p.104: "10 handfuls to 1 bag"), `creatureTokens`, `classDie`, `tideTokens`. `MarkedTracks`
  gained optional slots, `stats`, `gold`, `tokens`; `NumberEnv` gained `dualityDice`, `creatures` (`MapCreature[]`),
  `classDice`, `tideTokens`.
- `src/lib/domain/characters/slots.ts`: `slotsFromMods(mods)` (fixed `hpMax` / `stressMax` mods), `gainSlots` /
  `loseSlots(sheet, key, counts)`; `gainSlotBonus` / `loseSlotBonus` now use them.
- `src/lib/domain/feature-effects/passives.ts`: a passive's `requires` reads the feature's own tokens
  (`cardTokens` under `feat:<featureId>`, none = 0), so Feed's hunger turns on by itself once its entry gets a `tokens`
  check; `PassiveMods.slots` reports `hpMax` / `stressMax` mods without adding them anywhere (slots are raised once, at
  gain time).
- `src/components/combat-map/actions/hand/model.ts`: `limitLabel` names the period ("Once per week on a failure");
  cost badges name another payer ("They pay: 1 Hope"); `formFor` offers all six traits for a reaction roll with `anyTrait`.
- `tests/unit/lane-e5-checks-limits-numbers.test.ts`: every check, source, limit, payer and slot helper, with book
  numbers in the fixtures.

## Beads

| Bead | State | Notes |
|---|---|---|
| dcm-bxp.99.19.4 Armored Shell, Armor Score | partly | `stat armorScore` resolves from `MarkedTracks.stats`; callers fill stats (dcm-gl9, dcm-me3); the shell's reduction is wave 5 data + window |
| dcm-13s Spirit Weapon range | partly | `weaponRange` decided from `facts.weapons`; facts: dcm-aeg / dcm-gl9; `fromUse` is E1's trigger |
| dcm-2f3 Hydra lacks a condition | partly | card side `not` done; adversary `hasCondition.lacks` is read in features.ts (E7): dcm-8rh |
| dcm-2g9 Feed, no tokens | done (engine) | `tokens` check; passives fill the feature's own tokens; active uses: dcm-me3; the entry switches in wave 5 |
| dcm-3i4 Enchanted Talisman | partly | `holdsItem` done; `whenAllyWouldTakeDamage.unlimited` in window.ts: dcm-ofo |
| dcm-7n7 Invisibility / Never Upstaged tokens | partly | `tokens` check done; `cardTokens` fact from cardRunner: dcm-gl9; the gate in run.ts: dcm-a9c |
| dcm-85u Sneak Attack | partly | `allyNear` + `anyOf` done; distances from the map: dcm-aeg |
| dcm-8yr Tactician, ally pays | partly | `unaffordableBy` + badge label; runner / server use: dcm-a9c, dcm-gl9 |
| dcm-9l4 Kick / Tusks | partly | `within` done; `target.distance`: dcm-aeg, dcm-gl9 |
| dcm-a7o target's Major threshold | partly | `stat majorThreshold` resolves; adversary env fills it: dcm-8rh |
| dcm-aym a week / a day | partly | `limitPeriod`, labels, order; storage needs the validator widen + expiry: dcm-55k (and QUESTION 1) |
| dcm-c75 Words of Discord memory | partly | `usedOnBefore` check + `usedOnKey` / `recordUsedOn`; server records it: dcm-gl9 (QUESTION 2) |
| dcm-fjh any trait; Stress slot | partly | `formFor` offers any trait; run.ts rolls the pick: dcm-a9c; `stressMax` via `slotsFromMods` / `PassiveMods.slots`; `choose.distinctFrom` is E3's |
| dcm-qdm actor carries a tag | done | `situation.check hasCondition who self` was covered (DA0); tested here |
| dcm-ttz count creatures | partly | `creatureCount` resolves from `NumberEnv.creatures`; adversary env: dcm-8rh |
| dcm-u6z Vitality slots | partly | `slotsFromMods`, `gainSlots` / `loseSlots`; cardRunner applies them: dcm-o3j |
| dcm-uj0 Rune Ward holder pays | partly | `unaffordableBy`; `unlimited` range: dcm-ofo; runner: dcm-a9c |
| dcm-war Ward Die 8 spends the ward | partly | `exhaustKey`; run.ts / server write it: dcm-a9c, dcm-gl9 |
| dcm-wut Surrounded | partly | `weaponRange attacking` done; `beforeYouRoll.weaponRange` matching (E1) and the fact: dcm-aeg |

## Follow-up beads (label `e5-followup`)

- dcm-gl9 (E4, cardRunner): fill StateFacts / NumberEnv for card uses; paidBy payers; exhaust; usedOn memory.
- dcm-a9c (E3, run.ts): targetCheck via `stateCheckMet`; paidBy; exhaust outcome; anyTrait; `dualityDice`.
- dcm-me3 (E8, featureRunner): feature facts (own tokens, moon die, tide tokens, class dice).
- dcm-aeg (E1, combatActions): rider facts (attacking weapon range, target distance, ally near target).
- dcm-ofo (E2, window.ts): `whenAllyWouldTakeDamage.unlimited`, `usedArmor`, holder items.
- dcm-8rh (E7, adversary features): `hasCondition.lacks`, `situation.check`, adversary NumberEnv (creatures, thresholds).
- dcm-55k (E6 + validators): store and expire `Limit.period`.
- dcm-o3j (E4, cardRunner): apply `hpMax` / `stressMax` mods with `gainSlots`.

## Validator widen for `Limit.period` (outside E5's owns; for whoever owns the validators)

1. `src/lib/validation/characters.ts:98`:
   `export const FEATURE_USE_UNTIL = ["rest", "longRest", "session", "scene", "gmTurn", "day", "week"] as const;`
   (`convex/lib/validators/characters.ts:168` follows, it uses `literals(FEATURE_USE_UNTIL)`; widening only, every stored
   entry still conforms.)
2. `convex/lib/validators/encounters.ts:99` `instanceFeatureUseValidator.until`:
   `v.union(v.literal("rest"), v.literal("longRest"), v.literal("session"), v.literal("gmTurn"), v.literal("day"))`.
3. Then in availability.ts: `limitUntil` / `featureLimitUntil` take the `Limit` and return `limitPeriod(limit)`, and
   `RESET_LABEL`'s type narrows back to `Record<FeatureUse["until"], string>`; characters/expiry.ts ends the new entries.

## QUESTIONS

1. **Days and weeks without campaign time.** Resurrection (CB p.341): "On a failure, you can't cast Resurrection again
   for a week." Oracle of Doom, Summon Tormentors (CB p.237): "Once per day, spend 2 Fear …". Only the Witherwild frame
   keeps campaign time (weeks and days). In other frames, does the GM clear these by hand, or should a day / week map to
   something (a long rest, a session)? Today the entries fall back to `per` (`session`).
2. **How long Words of Discord remembers a target.** CB p.335: "Once this attack is over, the target realizes what
   happened. The next time you cast Words of Discord on them, gain a −5 penalty to the Spellcast Roll." The book sets no
   end. `recordUsedOn` keeps the memory until the session ends (the longest period `featureUses` stores). Should it
   last longer (until the target leaves play / for the campaign), which needs a new `until` value?
3. **Gold as a number.** `gold` in handfuls counts a bag as 10 handfuls (CB p.104: "10 handfuls to 1 bag"); `unit: "bag"`
   counts whole bags only. Confirm when the steal-gold steps (dcm-0gh, E3) are built.
