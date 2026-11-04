# TASK-LN3-E5: checks, limits, numbers round 3 (lanes-2, wave 9, tracer E5.3)

Plan `.omc/plans/lanes-2.yaml`, tracer E5.3, label `lane:w1-e5-checks-limits-numbers`, branch `lane3-e5`.
Earlier rounds: `docs/tasks/TASK-LN-E5.md`, `docs/tasks/TASK-LN2-E5.md`. (The plan's `owns` names this file
`TASK-LN3-E5.md`; the brief's `TASK-LN3-<ID>.md` would be `TASK-LN3-E5.3.md`.)

## What landed

No Convex function or args changed (no authz entries). One stored-shape widen (no migration, no version bump).

| Bead | State | Where |
| --- | --- | --- |
| dcm-pg8x widen `featureUses.until` with `campaign` | closable | `validation/characters.ts` `FEATURE_USE_UNTIL` gains `"campaign"` (feeds `convex/lib/validators/characters.ts` through `literals()`; old rows stay valid). `availability.ts`: `USED_ON_EVER = CAMPAIGN_UNTIL`, `RESET_LABEL` / exhaust order typed on `FeatureUse["until"]`. `expire` ends only the periods it lists, so nothing ends `campaign` (tested for every `ExpiryEvent`) |
| dcm-c75 Words of Discord whole-campaign memory | closable | `recordUsedOn` without `since` stores `campaign`; every later cast sees `usedOnBefore` (user answer 2026-10-31) |
| dcm-bc67 limitUntil half | E5 half done | `EXPIRING_UNTIL` is now `EXPIRING_FEATURE_USES` (expiry.ts); `limitUntil` / `featureLimitUntil` store `limitPeriod(limit)` (week, day, gmTurn), cards still store a plain scene as session. `limitPeriod` returns `Limit["per"] \| Limit["period"]`. Left: CT fires `day` / `week` (and the GM turn end `gmTurn`) — CT's half |
| dcm-753y inArea for subject / target | E5 half done | Already in `availability.ts` since round 1 (`CreatureFacts.areas`, read for `who: subject / target`); now tested. Left: the callers fill it — follow-up **dcm-iia9** (E1 combatActions creatureFacts, E2 incomingHits subject facts, E8 featureRunner) |
| dcm-rm9 tideTokens / moonPhase | closable | `resolveNumber` reads `env.tideTokens`, `stateCheckMet` reads `facts.moonPhase`; E3 copies `actor.tideTokens` (card run.ts), E8 fills `moonPhase` (featureRunner `ownFacts`) and binds tideTokens (`sheetNumbers`) |

Tests: `tests/unit/lane3-e5-campaign-limits-areas.test.ts` (9).

### Out-of-owns edits (orchestrator: please accept or move)

- `tests/unit/lane-e5-checks-limits-numbers.test.ts` (E5's round-1 test, owned by the round-1 E5 tracer, not by any
  wave-9 tracer): its assertions encoded the pre-dcm-bc67 / pre-dcm-pg8x contract (week stored as session, Words of
  Discord memory as session, `EXPIRING_UNTIL` the old four). Updated to the new contract; otherwise `pnpm test` fails.
- `convex/lib/adversaryFeatures.ts` (E7.3's file), one line in `storedUses`: the widened `FeatureUse["until"]` no longer
  fits `InstanceFeatureUse` (encounters validator has no `campaign`), so typecheck failed. A sheet's campaign memory has no
  instance period: mapped to `session` like `scene` (an instance lasts the encounter). E7.3 may prefer to widen
  `instanceFeatureUseValidator` instead; merge note: possible textual conflict with E7.3 near line 284.

## Vocabulary beads (E5-labelled), verified

Every E5 half is in place in the E5 files; what is left lives in other lanes.

| Bead | E5 half | Left elsewhere |
| --- | --- | --- |
| dcm-wut Surrounded (Melee weapon) | done: `weaponRange` with `weapon: "attacking"` reads `facts.weapons.attacking` | feature riders' weapons fact (dcm-576v, E1); data assassin-brawler.ts |
| dcm-fjh Attack of Opportunity / At Ease | done: `slots.ts` `slotsFromMods` / `gainSlots` read `stressMax` | E3 anyTrait done; At Ease gainSlots caller dcm-o3j (E4); data guardian-warrior.ts |
| dcm-13s Spirit Weapon / Sacred Resonance | done: `weaponRange` equipped check | the "Use as Spirit Weapon" check box dcm-xbtw (E1.3b); data seraph-witch.ts |
| dcm-3i4 Enchanted Talisman | done: `holdsItem` (self / subject / target) | E2 unlimited ally trigger (done per wave 8); data switch to holdsItem |
| dcm-85u Sneak Attack | done: `allyNear`, `anyOf` | card riders' nearestAlly fact (dcm-576v, E1) |
| dcm-9l4 Kick / Tusks | done: `within` reads `distance` | card riders' distance fact (dcm-576v, E1) |
| dcm-a7o Blade of the Forest | done: `stat` source (majorThreshold) reads `env.target.stats` | adversary NumberEnv target stats (dcm-8rh, E7); data t3-core.ts |
| dcm-ttz Hive Mind / Shallow Cuts / Stolen Armor | done: `creatureCount` | card-runner creatures dcm-ldom (E3); creatureTokens dcm-n3mp (E7); data t4-hf.ts |
| dcm-aym Resurrection's week | done (this round, dcm-bc67): stored as `week` | CT fires `week`; then closable (data already `period: "week"`) |
| dcm-u6z Vitality slots | done: `slots.ts` hpMax / stressMax mods | level-up pick UI applying it (not E5) |
| dcm-uj0 Rune Ward ally pays | done: `unaffordableBy` / payers | cardRunner payers dcm-q40t (E3); data arcana.ts |
| dcm-war Rune Ward exhaust on 8 | done: `exhaustKey` | server apply dcm-q40t (E3); data arcana.ts |
| dcm-8yr Tactician ally pays | done: `unaffordableBy` | cardRunner payers dcm-q40t (E3); data bone.ts (costs + paidBy) |
| dcm-7n7 Invisibility / Never Upstaged tokens | done: `tokens` check reads `cardTokens` | tokensGone end dcm-erhv (E6), gate (E3); verify data |
| dcm-bxp.99.19.4 Armored Shell | done: `stat` source armorScore reads `env.self.stats` | window fills self stats (dcm-91tx E3, then E2); data beastforms.ts shell |

## Follow-ups

- **dcm-iia9** (new, lane:w1-e1-triggers-rolls): fill `CreatureFacts.areas` for the subject / target (E1, E2, E8 callers).
- dcm-bc67 callers: CT (campaign time `day` / `week`, GM turn end `gmTurn`).
- E7.3: decide `campaign` on instance uses (mapped to session here) or widen the instance validator.

## Data switches ready for wave 10

None new from E5: the data already uses the V2 terms (Resurrection `period: "week"`, Summon Tormentors `period: "day"`,
Ravenous `period: "gmTurn"` now store their real period).

## QUESTIONS

1. **Campaigns without a calendar** (dcm-55k, still open): a limit with `period: "day"` / `"week"` is now stored as day /
   week. CT's answer (dcm-ztb8) gives every campaign days of a week and an End day button, so these come back on End
   day / after 7 days. If a frame never ends days, such a use stays exhausted until the GM ends a day.
2. Round-1 QUESTIONS 1 and 3 (TASK-LN-E5.md) remain as before.
