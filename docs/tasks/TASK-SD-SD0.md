# TASK SD0: Sheet-drawer foundation

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD0 (wave 1, foundation, no dependencies). Bead `dcm-bxp.99.19`. Status:
Review.

SD0 lays the shared ground for the Combat Map sheet drawer: the widened card vocabulary (NV1-NV19), the feature-effect
model with its ids, the classification of every feature, twelve empty effect tables, the widened sheet, combat-request
and combat-map validators, the `combatAreas` table with its retention cron, the six error codes, and a Sheet button on
the Combat Map that opens a drawer stub. No new public Convex function (the authz matrix is unchanged); one internal
cron mutation (`cleanup.expireCombatAreas`).

## User answers implemented (plan header, analysis section 6)

- **Q2 (a)** before-roll prompt: the `preRoll` request kind (an adversary attack held before its roll), its responders
  and a feature answer in the stored responses.
- **Q4 (a)** companion token: token ref kind `companion {characterId}`; `CardUse.actor: "companion"` and
  `TargetSpec.companion` in the vocabulary.
- **Q5 (a)** stances as rule data, Focus track: `classState.martial {known, active?, focus 0-6}`; the 16 stance ids are
  classified (`stance:martial-artist:<slug>`); the `activeStance` state check gates the stance table.
- **Q7 (a)** scenes: `featureUses.until` gains `scene`; scene end is already a `timing` trigger and a `Duration`.
- **Q10 (a), Q11 (a)** Beastform and transformation features are classified (45 + 12) and get their own tables;
  `beastformAttackId` names a form's attack entry.
- **Q13 (a)** situations: `situation` requirements keep their check box; SD0's `check` lets the engine decide the ones it
  can read and falls back to the box until it does. Dedicated is `community:orderborne:dedicated`, so only Orderborne
  characters hold it (the user's note).
- **Q14 (a)** live map areas: the `area` step (`AreaSpec`), the `combatAreas` table (`blocksSight` for Dark Cloud).
- **Q15 (b)** the rest-time features (Hardy, Efficient, Celestial Trance, Oasis) are classified out of combat for the
  drawer; SD-R runs them in the rest flow.
- **Q16 (a)** "while flying" reads a `flying` state check (the drawer's toggle, SD3/SD6).
- **U1**: no new value reaches a player; the new error messages name no enemy number.

## What changed

| File | What |
|------|------|
| `src/lib/domain/card-effects/types.ts` | NV1-NV19, widen only (table below). 7 new outcome step kinds appended to `STEP_KINDS`; the drift check still compiles. No member renamed or narrowed. |
| `src/lib/domain/feature-effects/types.ts` | `FeatureEffect {featureId, source, owner, card?, uses: CardUse[], upgrades?}`, `FEATURE_SOURCES`, `FEATURE_USAGES`. |
| `src/lib/domain/feature-effects/ids.ts` | `featureSlug`, `featureId` (`<source>:<owner>:<slug>`, `hope:<classId>`), `beastformAttackId`, `parseFeatureId`, `featureKey` (`feat:<featureId>[:<useId>]`, throws past 60 / 80 characters), `isFeatureKey`. |
| `src/lib/srd/feature-effects/classification.ts` | 306 rows: the 217 data features with the analysis readings verbatim, 45 Beastform, 12 transformation and 16 stance features classified here; `MARTIAL_STANCE_SLUGS`, `featureClass`, `featureUsage`. |
| `src/lib/srd/feature-effects/<group>.ts` (12) | Empty `readonly FeatureEffect[]` tables, one per FE tracer. |
| `src/lib/srd/feature-effects/index.ts` | `FEATURE_EFFECT_TABLES`, `mergeFeatureTables` (throws on a duplicate id), `FEATURE_EFFECTS`, `featureEffect`. |
| `src/lib/errors/combatFeatures.ts`, `app-error.ts`, `src/lib/convex-errors.ts` | `FEATURE_NOT_OWNED`, `FEATURE_EXHAUSTED`, `FEATURE_COST_UNPAID`, `FEATURE_NOT_COMBAT`, `FEATURE_NEEDS_MAP`, `FEATURE_STATE_MISSING`, in `AppErrorCode` and the client map. |
| `src/lib/validation/characters.ts`, `convex/lib/validators/characters.ts` | `FEATURE_USE_UNTIL` gains `scene`; `classState.martial` (`martialStateSchema`, `FOCUS_HOLD_MAX = 6`); `featureUses` cap 40 → `FEATURE_USES_MAX = 60` (worst case below). Optional and widened: stored sheets parse unchanged, no version bump. |
| `convex/lib/validators/combatRequests.ts` | Sanction action kind `feature {featureId, useId, targetTokenIds, choices, roll?}`; request kind `preRoll` with `preRollPayloadValidator` (`heldAttack`, responders with feature ids, schemaVersion 1); stored responses accept a `feature` answer. The public `respond` args are unchanged. |
| `convex/lib/validators/combatMaps.ts` | Token ref kind `companion {characterId}`; `combatAreaFields` (`AREA_RADII`, `AREA_EXPIRES`, `areaCentreValidator`). |
| `convex/tables/combatAreas.ts`, `convex/schema.ts` | The `combatAreas` table: `by_map`, `by_campaign`, `by_status_ended`. |
| `convex/cleanup.ts`, `convex/crons.ts` | `expireCombatAreas` (internal, `BATCH` per run, reschedules itself): ended areas a day after `endedAt`; hourly at :19. `purgeCampaign` deletes a campaign's areas. |
| `src/components/combat-map/slots.ts` | The drawer contract: `SheetDrawerProps`, `FeatureUseProps`, `sheetCharacterId`, `sheetHref`. |
| `src/components/combat-map/drawer/index.tsx`, `drawer/use/index.tsx` | Stubs: `SheetDrawer` is a modal (native dialog via `Modal`) with the "Full sheet" link; `FeatureUse` renders nothing. |
| `src/app/(gm)/campaigns/[campaignId]/combat-map/page.tsx` | The Sheet button in Play: in the header tools (hidden at 760 px and below) and in a bar under the map (shown only there), for a player whose PC has a token on the map and for the GM with a PC token selected (`combatTokens.party`). The drawer mounts once, in its own error boundary, and stays mounted after its first open. |

### Files outside `owns` (compile-only, need the orchestrator's OK)

The widening the acceptance asks for does not compile without these one-line changes in files SD0 does not own. Each is
a dead branch or a label until a later tracer writes the new values; none changes today's behaviour.

| File | Why | Change |
|------|-----|--------|
| `src/lib/domain/card-effects/availability.ts` (SD1) | `RESET_LABEL: Record<FeatureUse["until"], string>` needs the new `scene` | `scene: "Back after the scene"` |
| `src/lib/domain/class-features/index.ts` | `CLASS_STATE_LABELS: Record<keyof ClassState, string>` needs `martial` | `martial: "Stances and Focus"` |
| `src/components/party/features/panel.tsx` | `stateEntries` printed every object counter as `value / dmax` | prints `martial` as "N Focus · stance" |
| `convex/lib/adversaryFeatures.ts` | an instance's stored use `until` excludes `scene` | maps `scene` to `session` (what `limitUntil` already does) |
| `convex/lib/adversaryHits.ts` | the window replay expects only hit answers | skips a `feature` answer (SD4 folds them in) |
| `convex/combatTokens.ts` | token views handled pc / adversary / custom | skips a `companion` token (its view is SD-C's) |
| `convex/combatCards.ts` | a sanction's target name handled pc / adversary / custom | names a companion token "Companion" |

Recommendation: add these seven paths to SD0's `owns` (no wave-1 tracer owns them; SD-ST owns only its stance files).
`tracer:guard` reports exactly these seven.

## Vocabulary (analysis section 3) and how each piece is expressed

New members were placed so every existing switch in the runner, the reaction window and the adversary engine still
compiles (`run.ts`, `availability.ts` and `combat-actions/numbers.ts` switch exhaustively over `Requirement`, `Cost`,
`NumberSource`, `Recipient`, `Gate` and `Duration`, and `cardRunner.ts` / `cardRows.ts` map every `Duration`). So new
outcome steps join `OutcomeStep`, and the rest are optional fields or new literals inside existing members.

| Id | Piece | Shape |
|----|-------|-------|
| NV1 | favor / focus / heldDie | `Resource` gains `favor`, `focus`, `heldDie`; `Cost tokens` gains `pool: TokenPool` (`card`, `favor`, `focus`, a held-die kind); `DiceExpr.sidesOf` (the class die's size); `resource` step (gain / lose / set Favor or Focus); a spent die's value is `{kind: "spent", resource: "heldDie"}`. |
| NV2 | delegate | `delegate` step `{feature: FeatureMeta.key, params?: {choice, choiceFrom, amount}}`. |
| NV3 | upgrades | `Upgrade {when: rank / feature / level, useId?, patch: {limitTimes, dieSides, diceCount, range, extraSteps, chooseId + extraOptions}}`, on `FeatureEffect.upgrades`. |
| NV4 | adjustHpMarked | `adjustHpMarked` step `{change: fewer / more, amount}`. |
| NV5 | durations | `EndEvent` (`takeSevere`, `dealSevere`, `markHp`, `rollWithFear`, `bearerFails`, `bearerMarksStress`, `usedAgain`, `dealDamage`, `attackSucceeds`, `lastHp`, `majorDamage`) as `endsOn` on `condition`, `effect` and `AreaSpec`; the `Duration` still ends it too ("until Severe damage or your next rest"). |
| NV6 | triggers | New: `wouldMarkStress {forced?}`, `whenYouMarkStress {last?}`, `whenCreatureAttacked {subject, subjectWithin?, attackerWithin?, stage}`, `whenEnemyFailsAttack {range?, source?}`, `whenEnemyLeavesRange`, `whenYouUseExperience`, `whenYouGainHope`, `whenYouGiveDie`, `whenHelping`. Widened: `whenYouAttack` (`successWithFear`, `firstInScene`), `whenTargetMarksHp.severity`, `whenEnemyTakesDamage.byYou`, `whenYouMarkHp.sourceWithin`. |
| NV7 | requirements and gates | `situation.check: StateCheck` (`hasCondition`, `flying`, `featureEffect` + option, `inBeastform`, `hopeAtLeast`, `hpUnmarkedAtMost` for self / subject / target, `rollUsedExperience`, `activeStance`, `inArea`, `isolated`); gates use it through `{kind: "requires"}`; `effect.option` names the channel. New flags: `actionDisadvantage`, `cannotMove`, `cannotBeMoved`, `ignoreAgilityDisadvantage`, `noWeaponsOrSpells`. |
| NV8 | roll and damage changes | `RollChange`: `setOutcome`, `dieBonus`, `fearDie`, `experience` (`payWithStress` + `double`, `freeOnCheck`, `borrowAlly`), `reroll.ifAtMost` / `.advantage`. `DamageChange`: `rerollChosen {below?}`, `doubleDice` (matching / chosen), `addWeaponDie`, `extraDie`, `ones {asMax / add}`, `dieSize`, `add.type`. |
| NV9 | attacker-keyed defences | `Versus {creature: CreatureKey, on}` on `stat`, `advantage`, `disadvantageAgainst` mods; `CreatureKey` = `tagged`, `hexed`, `inCompanionReach`, `damagedAlly` (Q8). |
| NV10 | range modifiers | `ModStat` `primaryRange`, `meleeWeaponRange`, `meleeRange` (steps along the Defined Ranges); `TargetSpec.rangeSteps`. |
| NV11 | areas | `area` step with `AreaSpec {label, centre, radius, side, mods?, blocksSight?, duration, endsOn?}`; rows in `combatAreas`. |
| NV12 | dice at or above | `dice` source `keep: "countAtLeast"` + `atLeast`. |
| NV13 | companion | `CardUse.actor: "companion"`; `TargetSpec.companion` (with `to: "picked"`, the companion recipient); token ref `companion`. |
| NV14 | adversary-side mods | `ModStat` `attackDie`, `reactionDifficulty`; flags `attackDisadvantage`, `reactionDisadvantage`, `attackersMarkStress`, `doubleMagicDamage`; `bearerMarksStress` end event. |
| NV15 | chosen trait, hold count | `trait` mod `choice`; `CardUse.holdLimit`. |
| NV16 | scene limits | `featureUses.until` `scene` (validators); `Limit.per: "scene"`, `Duration "scene"` and the `sceneEnd` timing already existed; `whenYouAttack.firstInScene`. |
| NV17 | instead of Hope | `replaceHopeGain` step `{with: favor / removeFear}`. |
| NV18 | target-adding riders | `addTargets` step `{count, targets, damage?: same / half}`. |
| NV19 | named Help and table moves | `help` step `{die, free?}`; `ModStat` `helpDie`, `tagTeamUses`, `tagTeamAllyCost`, `consumableClear`; `whenHelping` trigger. |

## Book passages checked (printed pages)

- HF p.12, Martial Stances: "You can hold a maximum of 6 Focus." "You can spend a Focus to shift into a martial stance
  … You also drop out of your active stance when you take Severe damage or mark your last Hit Point. Otherwise, you drop
  out of your active stance at the end of the scene." The 16 stances: Favored, Invigorating, Quick, Reliable (Tier 1);
  Aggressive, Anchored, Defensive, Otherworldly (Tier 2); Grappling, Scary, Stable, Vigilant (Tier 3); Crushing,
  Exacting, Honed, Isolating (Tier 4).
- CB p.107, End of the Scene: "At the GM's discretion, a scene continues until the current narrative situation has played
  out." (Q7: `scene` resets.)
- CB p.30, Elemental Incarnation: "until you take Severe damage or until your next rest" (the `endsOn` example).
- HF p.14, Harrowing Invocation: "When an adversary targets you or an ally within Very Close range with an attack, you
  can spend a Favor to give them disadvantage on the roll." (Q2: the `preRoll` request.) HF p.14, Favor: "when you
  succeed on an action roll with Hope, you can choose to gain a Favor instead of a Hope." (NV17.)
- CB p.42, Dark Cloud: "Anyone in this cloud can't see outside of it, and anyone outside of it can't see in." (Q14:
  `blocksSight`.) HF p.16, Circle of Power: "This spell lasts until the last token is removed or you exit the circle."
  (`expires: "manual"`.)
- CB p.40, Companion: "When you command your companion to attack, they gain any benefits that would normally only apply
  to you … their damage roll uses your Proficiency and their damage die." (Q4: `actor: "companion"`.)
- HF p.32, Brave Face: "Once per session when you would be forced to mark a Stress, you can spend a Hope instead."
  (`wouldMarkStress.forced`.) CB p.62, Reach: "Treat any weapon, ability, spell, or other feature that has a Melee range
  as though it has a Very Close range instead." (`meleeRange`.)
- Beastform pages: Tier 1 CB p.32, Tier 2 p.33, Tier 3 p.34, Tier 4 p.35. Transformations: demigod HF p.35, ghost p.36,
  reanimated p.37, shapeshifter p.38, vampire p.39, werewolf p.40.

## `featureUses` worst case

13 once-per features (class, subclass, multiclass, heritage, transformation), Gifted Performer's three songs twice each
with Virtuoso (6, CB p.28), five loadout cards with three per-use entries each (15), a per-target card on six allies
(6) and five D5 keys: 45 entries, over CA0's 40. The cap is now 60 (widened; a test parses the 45 and refuses 61).
Longest key: `feat:subclass:warden-of-the-elements:elemental-incarnation` (58 of 60 characters).

## Tests

- `tests/unit/feature-classification.test.ts` (new, 22): one row per data feature and none extra (217 + 45 + 12 + 16);
  the analysis counts (131 / 50 / 24 / 12) and the per-card counts of section 0; stances 4 per tier; how / usage
  consistency; `featureUsage`; Dedicated and the rest-time features; slugs, ids, `parseFeatureId` on every row; the
  longest `feat:` key against the `cardTokens` and `featureUses` schemas; key caps; the twelve empty tables and the
  duplicate-id throw; `scene`, `martial` (Focus 0-6, at most 16 stances) and an old sheet read back unchanged; the
  worst-case `featureUses`; the six error codes through `errorMessage`; `sheetCharacterId` and `sheetHref`.
- `tests/unit/card-effects/types-widen.test.ts` (new, 6): every CE-* and AE-* table still merges (imported through
  their registries); CA0's step kinds kept in order, the SD0 kinds appended, the adversary step kinds carry them; the
  card tables use only known kinds; one typed feature per new piece (NV1-NV19).
- `tests/convex/schema-guard.test.ts` (+3): `combatAreas` classified (campaign-scoped, retention job); a feature
  sanction, a `preRoll` row and a feature answer store and read back; bad `preRoll` rows are refused; a companion token
  and an area store and read back (`by_map`), bad areas are refused.
- `tests/convex/cleanup.test.ts` (+2): the seeded campaign has an area (the purge test proves it goes); ended areas are
  swept a day after `endedAt` past a full batch, recent and active ones stay; the cron runs hourly at :19.

## Follow-ups and open points (no game mechanic decided here)

- `src/lib/domain/combat-actions/numbers.ts` resolves `NumberSource` and `DiceExpr`; no sheet-drawer tracer owns it, but
  SD1 must teach it `keep: "countAtLeast"` and `sidesOf` (today they read as a sum and as `sides`).
- `src/lib/domain/characters/expiry.ts` (SD8) does not clear `scene` feature uses yet: SD8 adds them to the `scene` and
  `session` events (Q7: session end also ends a scene).
- A deleted combat map leaves its areas until they end or the campaign is purged: `deleteMapChildren`
  (`convex/lib/combatMaps.ts`, not in this plan) should delete them (SD-A or the orchestrator).
- Who sets `combatAreas.status = "ended"` on scene, session and rest end: SD8 / SD-A.
- Where the Flying toggle (Q16) is stored is SD3's `setFlying` (a sheet effect is the analysis' reading).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 293 files, 7789 passed, 1 expected fail.
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml SD0`: reports the seven files outside `owns` listed above; nothing else.
- No e2e is named by the plan entry. `convex/_generated` and `tsconfig.json` untouched (no new public module).

## Classification (306 rows, for the user's review)

`usage`: combat | passive | outOfCombat | narrative. `how`: the activation the FE tracer is expected to use (`text` = none).
The 217 data rows carry the analysis readings (section 2) verbatim; the Beastform, transformation and stance rows are
SD0's readings of CB p.32-35 and HF p.12, p.35-40.

### Hope features (13)

| Feature id | Usage | How | Reading |
|---|---|---|---|
| `hope:bard` | combat | action | Distracted (temporary) + Difficulty -2 on one enemy in Close; dcm-bxp.47 |
| `hope:druid` | combat | action | 3 Hope: Beastform without Stress, +1 to a chosen trait while transformed |
| `hope:guardian` | combat | action | 3 Hope: clear 2 Armor Slots; repeatable (CB p.107) |
| `hope:ranger` | combat | rider | 3 Hope after a successful weapon attack: same roll vs two more adversaries in range; dcm-bxp.47 |
| `hope:rogue` | combat | action | 3 Hope: +2 Evasion until an attack succeeds against you, else until next rest |
| `hope:seraph` | combat | action | 3 Hope: an ally within Close clears 1 HP |
| `hope:sorcerer` | combat | reaction | 3 Hope: reroll any damage dice of a magic attack (after-roll window, Q1) |
| `hope:warrior` | combat | action | 3 Hope: +1 to attack rolls until next rest |
| `hope:wizard` | combat | reaction | 3 Hope: an adversary within Far rerolls an attack or damage roll (Q3); dcm-bxp.47 |
| `hope:assassin` | combat | action | 3 Hope: clear 2 Stress |
| `hope:brawler` | combat | action | 3 Hope: a target within Close is temporarily Vulnerable; dcm-bxp.47 |
| `hope:warlock` | combat | reaction | Fail a roll: 3 Hope, reroll with advantage (after-roll window, Q1) |
| `hope:witch` | combat | reaction | You or an ally within Far fails an action roll: 3 Hope, success with Fear (after-roll window, Q1) |

### Class features (23)

| Feature id | Usage | How | Reading |
|---|---|---|---|
| `class:bard:rally` | combat | action | Once per session; Rally Dice for self + allies (held dice); spent from roll options; d8 at level 5 (NV3) |
| `class:druid:beastform` | combat | action | Mark a Stress: transform; weapons and domain spells blocked; form attack and features (Q10) |
| `class:druid:wildtouch` | narrative | text | Harmless nature effects at will |
| `class:guardian:unstoppable` | combat | action | Once per long rest; Unstoppable Die, physical severity -1, +die to damage, no Restrained/Vulnerable; scene end |
| `class:ranger:rangers-focus` | combat | action | Hope + attack; Focus tag on the target: its damage marks Stress, end Focus to reroll a failed attack |
| `class:rogue:cloaked` | passive | passive | Hidden becomes Cloaked; ends after an attack or a move ending in an adversary's line of sight (Q9) |
| `class:rogue:sneak-attack` | combat | rider | +tier d6 damage while Cloaked or with an ally in Melee of the target (Q9) |
| `class:seraph:prayer-dice` | combat | reaction | Session d4s = Spellcast; spend on any PC within Far: reduce incoming damage, add to a roll after it, or gain Hope |
| `class:sorcerer:arcane-sense` | narrative | text | Sense magic within Close |
| `class:sorcerer:minor-illusion` | narrative | action | Spellcast (10): a minor illusion (roll only) |
| `class:sorcerer:channel-raw-power` | combat | action | Once per long rest: vault a loadout card for Hope = level or +2x level damage on a spell |
| `class:warrior:attack-of-opportunity` | combat | reaction | Adversary in Melee tries to leave: reaction roll vs its Difficulty, 1 effect (2 on a crit) |
| `class:warrior:combat-training` | passive | passive | Ignore burden; + level to physical damage (done as an auto roll option) |
| `class:wizard:prestidigitation` | narrative | text | Harmless magic at will |
| `class:wizard:strange-patterns` | combat | auto | Your number on a Duality Die: +1 Hope or clear 1 Stress (prompt, done) |
| `class:assassin:marked-for-death` | combat | rider | Successful weapon attack, mark a Stress: Marked for Death (one at a time), +tier d4 damage vs it |
| `class:assassin:get-in-get-out` | outOfCombat | action | Spend a Hope: ask for a way in/out; next roll on it has advantage |
| `class:brawler:i-am-the-weapon` | passive | passive | Brawler's Strike weapon override, +1 Evasion (done) |
| `class:brawler:combo-strike` | combat | rider | After damage on a Melee success, mark a Stress: Combo Die chain |
| `class:warlock:patrons-pact` | combat | rider | Spend a Favor before an action roll in your patron's sphere: + Patron Die |
| `class:warlock:favor` | combat | auto | 3 Favor; tribute downtime move; success with Hope may take a Favor instead of Hope |
| `class:witch:hex` | combat | action | Mark a Stress: Hex a target within Far, - tier to its damage rolls and Difficulty; up to Spellcast targets |
| `class:witch:commune` | outOfCombat | action | Once per long rest in calm: ask a question, roll Spellcast d6s |

### Subclass features (118)

| Feature id | Usage | How | Reading |
|---|---|---|---|
| `subclass:troubadour:gifted-performer` | combat | action | Three songs, each once per long rest (one use each); Virtuoso makes it twice |
| `subclass:troubadour:maestro` | combat | auto | When you give a Rally Die, each ally picks +1 Hope or clear 1 Stress (per-recipient choice) |
| `subclass:troubadour:virtuoso` | passive | passive | Upgrade: Gifted Performer songs twice per long rest |
| `subclass:wordsmith:rousing-speech` | combat | action | Once per long rest; all allies within Far clear 2 Stress |
| `subclass:wordsmith:heart-of-a-poet` | outOfCombat | rider | After a social action roll: spend a Hope, +d4 (situation confirm) |
| `subclass:wordsmith:eloquent` | combat | action | Once per session; options: mundane object (text), Help without Hope, extra downtime move (rest) |
| `subclass:wordsmith:epic-poetry` | passive | passive | Rally Die d10; Help an Ally rolls a d10 advantage die |
| `subclass:warden-of-the-elements:elemental-incarnation` | combat | action | Mark a Stress: Channel Fire/Earth/Water/Air until Severe damage or next rest; each element a lasting rider |
| `subclass:warden-of-the-elements:elemental-aura` | combat | action | Once per rest while Channeling: aura in Close matching the element |
| `subclass:warden-of-the-elements:elemental-dominion` | passive | passive | While Channeling: Fire +1 Proficiency; Earth d6 per HP; Water reaction Vulnerable; Air +1 Evasion, fly |
| `subclass:warden-of-renewal:clarity-of-nature` | outOfCombat | action | Once per long rest; a few minutes resting: clear Stress = Instinct, split among party |
| `subclass:warden-of-renewal:regeneration` | combat | action | Touch, 3 Hope: target clears 1d4 HP (Very Close with Regenerative Reach) |
| `subclass:warden-of-renewal:regenerative-reach` | passive | passive | Upgrade: Regeneration reaches Very Close |
| `subclass:warden-of-renewal:wardens-protection` | combat | action | Once per long rest, 2 Hope: 1d4 allies within Close clear 2 HP |
| `subclass:warden-of-renewal:defender` | combat | reaction | In Beastform: ally within Close marks 2+ HP, mark a Stress, they mark 1 fewer |
| `subclass:stalwart:unwavering` | passive | passive | +1 thresholds (done) |
| `subclass:stalwart:iron-will` | combat | reaction | Physical damage: one extra Armor Slot (reaction window) |
| `subclass:stalwart:unrelenting` | passive | passive | +2 thresholds (done) |
| `subclass:stalwart:partners-in-arms` | combat | reaction | Ally within Very Close takes damage: mark an Armor Slot, their severity -1 |
| `subclass:stalwart:undaunted` | passive | passive | +3 thresholds (done) |
| `subclass:stalwart:loyal-protector` | combat | reaction | Ally within Close with 2 or fewer HP unmarked would take damage: mark a Stress, take it instead |
| `subclass:vengeance:at-ease` | passive | passive | +1 Stress slot (done) |
| `subclass:vengeance:revenge` | combat | reaction | Adversary in Melee hits you: mark 2 Stress, it marks 1 HP |
| `subclass:vengeance:act-of-reprisal` | combat | auto | Adversary damages an ally within Melee: +1 Proficiency on your next successful attack on it (Q8) |
| `subclass:vengeance:nemesis` | combat | action | 2 Hope: Prioritize one adversary until next rest; may swap Hope/Fear dice on attacks vs it |
| `subclass:beastbound:companion` | combat | action | Animal companion with its own attack (Spellcast Roll to command, Proficiency + its die); Q4 |
| `subclass:beastbound:expert-training` | passive | passive | Companion level-up option (companion sheet) |
| `subclass:beastbound:battle-bonded` | passive | passive | +2 Evasion vs an adversary inside the companion's Melee range |
| `subclass:beastbound:advanced-training` | passive | passive | Two companion level-up options |
| `subclass:beastbound:loyal-friend` | combat | reaction | Once per long rest: take the damage for your companion or vice versa |
| `subclass:wayfinder:ruthless-predator` | combat | rider | Mark a Stress for +1 Proficiency on a damage roll; your Severe damage makes the adversary mark a Stress |
| `subclass:wayfinder:path-forward` | narrative | text | Shortest path to a known place |
| `subclass:wayfinder:elusive-predator` | passive | passive | +2 Evasion vs attacks by your Focus |
| `subclass:wayfinder:apex-predator` | combat | rider | Spend a Hope before attacking your Focus; on a success the GM loses a Fear |
| `subclass:nightwalker:shadow-stepper` | combat | action | In darkness: mark a Stress, reappear in a shadow within Far, Cloaked (move prompt) |
| `subclass:nightwalker:dark-cloud` | combat | action | Spellcast (15): a dark cloud in Close blocks sight in and out; Cloaked from those it blocks |
| `subclass:nightwalker:adrenaline` | passive | passive | While Vulnerable: + level to damage rolls |
| `subclass:nightwalker:fleeting-shadow` | passive | passive | +1 Evasion (done); Shadow Stepper reaches Very Far |
| `subclass:nightwalker:vanishing-act` | combat | action | Mark a Stress: Cloaked, clear Restrained, until you roll with Fear or next rest |
| `subclass:syndicate:well-connected` | narrative | text | Know somebody in each prominent town |
| `subclass:syndicate:contacts-everywhere` | combat | action | Once per session: gold/tool, +3 to your Hope or Fear Die on the next action roll, or +2d8 on the next damage |
| `subclass:syndicate:reliable-backup` | passive | passive | Contacts Everywhere 3x per session; adds: 1 fewer HP marked, d20 Hope Die on a Presence Roll in conversation |
| `subclass:divine-wielder:spirit-weapon` | combat | rider | Melee/Very Close weapon attacks within Close; mark a Stress for one more target, same roll |
| `subclass:divine-wielder:sparing-touch` | combat | action | Once per long rest (twice with Devout): touch, clear 2 HP or 2 Stress |
| `subclass:divine-wielder:devout` | passive | passive | Prayer Dice: roll one extra, drop the lowest; Sparing Touch twice |
| `subclass:divine-wielder:sacred-resonance` | passive | passive | Spirit Weapon damage: matching dice are doubled |
| `subclass:winged-sentinel:wings-of-light` | combat | rider | Fly; mark a Stress to carry a creature; while flying spend a Hope for +1d8 damage on a successful attack |
| `subclass:winged-sentinel:ethereal-visage` | passive | passive | While flying advantage on Presence Rolls; success with Hope on a Presence Roll may remove a Fear instead of gaining Hope |
| `subclass:winged-sentinel:ascendant` | passive | passive | +4 Severe threshold (done) |
| `subclass:winged-sentinel:power-of-the-gods` | passive | passive | Upgrade: Wings of Light deals 1d12 |
| `subclass:elemental-origin:elementalist` | combat | rider | Spend a Hope before an action roll: +2 to the roll or +3 to its damage |
| `subclass:elemental-origin:natural-evasion` | combat | reaction | An attack roll against you succeeds: mark a Stress, +d6 Evasion vs it |
| `subclass:elemental-origin:transcendence` | combat | action | Once per long rest: two of +4 Severe, +1 trait (choice), +1 Proficiency, +2 Evasion until next rest |
| `subclass:primal-origin:manipulate-magic` | combat | rider | After a magic spell or attack, mark a Stress: +1 range, +2 to the roll, double a damage die, or one more target |
| `subclass:primal-origin:enchanted-aid` | combat | reaction | Help with a Spellcast Roll: d8 advantage die; once per long rest swap that ally's Duality Dice |
| `subclass:primal-origin:arcane-charge` | combat | auto | Charged by taking magic damage or 2 Hope; spend Charge for +10 damage or +3 to a reaction roll's Difficulty |
| `subclass:call-of-the-brave:courage` | combat | auto | Fail a roll with Fear: gain a Hope |
| `subclass:call-of-the-brave:battle-ritual` | combat | action | Once per long rest before something dangerous: clear 2 Stress, gain 2 Hope |
| `subclass:call-of-the-brave:rise-to-the-challenge` | passive | passive | 2 or fewer HP unmarked: d20 Hope Die |
| `subclass:call-of-the-brave:camaraderie` | passive | passive | One more Tag Team per session; allies pay 2 Hope to Tag Team with you |
| `subclass:call-of-the-slayer:slayer` | combat | rider | Slayer Dice pool (done in session features); spend on attack or damage rolls |
| `subclass:call-of-the-slayer:weapon-specialist` | combat | rider | On a success spend a Hope: + one secondary weapon damage die; once per long rest reroll Slayer 1s |
| `subclass:call-of-the-slayer:martial-preparation` | outOfCombat | action | Downtime move: each participant gains a d6 Slayer Die |
| `subclass:school-of-knowledge:prepared` | outOfCombat | passive | Build: one extra domain card |
| `subclass:school-of-knowledge:adept` | combat | rider | Utilize an Experience with a Stress instead of a Hope: double the modifier |
| `subclass:school-of-knowledge:accomplished` | outOfCombat | passive | Build: one extra domain card |
| `subclass:school-of-knowledge:perfect-recall` | combat | rider | Once per rest: Recall Cost -1 when recalling a vault card (map Hand recall) |
| `subclass:school-of-knowledge:brilliant` | outOfCombat | passive | Build: one extra domain card |
| `subclass:school-of-knowledge:honed-expertise` | combat | auto | Using an Experience: d6, on 5+ no Hope spent |
| `subclass:school-of-war:battlemage` | passive | passive | +1 HP slot (done) |
| `subclass:school-of-war:face-your-fear` | combat | auto | Success with Fear on an attack: +1d10 magic damage (2d10, 3d10 with upgrades) |
| `subclass:school-of-war:conjure-shield` | passive | passive | With at least 2 Hope: + Proficiency to Evasion |
| `subclass:school-of-war:fueled-by-fear` | passive | passive | Upgrade: Face Your Fear 2d10 |
| `subclass:school-of-war:thrive-in-chaos` | combat | rider | On a success, after damage: mark a Stress, the target marks one more HP |
| `subclass:school-of-war:have-no-fear` | passive | passive | Upgrade: Face Your Fear 3d10 |
| `subclass:executioners-guild:first-strike` | combat | auto | First successful attack in a scene: double damage |
| `subclass:executioners-guild:ambush` | passive | passive | Marked for Death uses d6s |
| `subclass:executioners-guild:death-strike` | combat | rider | You deal Severe damage: mark a Stress, the target marks one more HP |
| `subclass:executioners-guild:scorpions-poise` | passive | passive | +2 Evasion vs attacks by your Marked for Death target |
| `subclass:executioners-guild:true-strike` | combat | reaction | Once per long rest a failed attack: spend a Hope, it succeeds |
| `subclass:executioners-guild:backstab` | passive | passive | Marked for Death uses d8s |
| `subclass:poisoners-guild:toxic-concoctions` | combat | rider | Mark a Stress for 1d4+1 tokens; spend one on a successful weapon attack for a poison (lists grow with rank) |
| `subclass:poisoners-guild:poison-compendium` | passive | passive | Adds Midnight Vine, Gorgon Root |
| `subclass:poisoners-guild:twin-fang` | combat | rider | Poisoning a Marked target: one more token for a second poison |
| `subclass:poisoners-guild:venomancer` | passive | passive | Adds Blight Seed, Fear Leaf, Corpse Thorn |
| `subclass:poisoners-guild:adders-blessing` | narrative | passive | Immune to poisons and toxins (no poison damage type in the app) |
| `subclass:juggernaut:rugged` | passive | passive | +3 Severe threshold (done) |
| `subclass:juggernaut:overwhelm` | combat | rider | On a success spend a Hope: throw the target within Close or it marks a Stress |
| `subclass:juggernaut:surrounded` | combat | rider | Melee attack: spend any Hope for that many extra targets in Melee |
| `subclass:juggernaut:eye-for-an-eye` | combat | reaction | Once per rest an adversary in Melee makes you mark HP: mark a Stress, it marks as many |
| `subclass:juggernaut:pummeljoy` | combat | auto | Melee weapon crit: +1 Hope, clear 1 Stress, +1 Proficiency on that attack |
| `subclass:juggernaut:not-done-yet` | combat | reaction | Take Severe damage: gain a Hope or clear a Stress |
| `subclass:martial-artist:stance-fighter` | combat | action | Martial Stances sheet (16 stances, Focus); the data is not in the codebase (Q5) |
| `subclass:martial-artist:keen-defenses` | combat | reaction | Targeted by an attack: spend a Focus, + tier Evasion |
| `subclass:martial-artist:focus-cannon` | combat | action | Spend a Focus: Instinct Roll vs an adversary within Far, d20+3 magic using Proficiency |
| `subclass:martial-artist:limit-breaker` | outOfCombat | action | Once per rest: an athletic feat without rolling, +1 Hope, clear a Stress |
| `subclass:martial-artist:flow-state` | passive | passive | Stress instead of Focus to shift stance; Focus instead of Stress for a combo strike |
| `subclass:pact-of-the-endless:patrons-mantle` | combat | action | Spend a Favor: + tier thresholds and advantage to intimidate until Severe damage or scene end |
| `subclass:pact-of-the-endless:deathless-embrace` | combat | action | Once per rest: spend Favor, roll that many Patron Dice, clear 1 HP per 4+ |
| `subclass:pact-of-the-endless:harrowing-invocation` | combat | reaction | Adversary targets you or an ally within Very Close: spend a Favor, disadvantage; on a miss it marks a Stress (Q2) |
| `subclass:pact-of-the-endless:damage-sink` | combat | reaction | Once per rest: spend a Favor, halve incoming damage (Q6) |
| `subclass:pact-of-the-endless:dark-aegis` | combat | reaction | Once per long rest: spend a Favor instead of marking Hit Points |
| `subclass:pact-of-the-endless:draining-bane` | combat | reaction | Adversary targets you or an ally within Very Close: spend a Favor, it marks a Stress, you clear one, it rolls d12 until it fails |
| `subclass:pact-of-the-wrathful:patrons-fury` | combat | action | Spend a Favor: + tier Patron Dice to damage until you deal Severe damage or scene end |
| `subclass:pact-of-the-wrathful:deadly-vengeance` | combat | reaction | You mark HP from an attack: spend a Favor, Patron Dice per HP, attacker marks 1 HP per 4+ |
| `subclass:pact-of-the-wrathful:menacing-reach` | combat | action | Spend a Favor: primary weapon range +1 step until a successful attack with it |
| `subclass:pact-of-the-wrathful:diminish-my-foes` | combat | rider | Success with Hope vs a target: spend any Favor, it marks that many Stress |
| `subclass:pact-of-the-wrathful:fearsome-attack` | combat | rider | Spend a Favor to reroll any damage dice, repeatable |
| `subclass:pact-of-the-wrathful:otherworldly-ire` | combat | reaction | Once per rest when you take damage: spend Favor, Patron Dice, the highest = targets within Close that mark 1 HP |
| `subclass:hedge:herbal-remedies` | passive | passive | Consumables clear 1 more HP or Stress (consumable use is not on the map) |
| `subclass:hedge:enchanted-talisman` | combat | reaction | Once per rest: Hope into tokens; the holder spends one to mark 1 fewer HP |
| `subclass:hedge:walk-between-worlds` | outOfCombat | action | Spellcast (13) in calm: talk to spirits (tokens) |
| `subclass:hedge:vexing-malison` | passive | passive | Advantage on attacks against Hexed creatures |
| `subclass:hedge:circle-of-power` | combat | action | Once per rest: Very Close circle, tokens = Spellcast; +2 thresholds, attack, Evasion inside; a token per roll or evade |
| `subclass:moon:nights-glamour` | combat | action | Spellcast (13): Glamoured; adversaries within Close mark a Stress to attack you; drops on HP marked or damage dealt |
| `subclass:moon:moonbeam` | combat | action | Once per session: Close moonlight until scene end, +1 Spellcast Rolls inside |
| `subclass:moon:ire-of-pale-light` | combat | auto | A Hexed creature within Very Far fails an attack: it marks a Stress |
| `subclass:moon:lunar-phases` | passive | passive | Session d6 phase effects (done in session features); once per rest a Hope bumps the die |

### Ancestry features (48)

| Feature id | Usage | How | Reading |
|---|---|---|---|
| `ancestry:clank:purposeful-design` | passive | passive | Build: +1 to one Experience |
| `ancestry:clank:efficient` | outOfCombat | passive | Short rest: take a long rest move |
| `ancestry:drakona:scales` | combat | reaction | Would take Severe damage: mark a Stress, mark 1 fewer HP |
| `ancestry:drakona:elemental-breath` | combat | action | Instinct weapon, Very Close, a target or group, d8 magic using Proficiency |
| `ancestry:dwarf:thick-skin` | combat | reaction | Take Minor damage: mark 2 Stress instead of 1 HP |
| `ancestry:dwarf:increased-fortitude` | combat | reaction | 3 Hope: halve incoming physical damage (Q6) |
| `ancestry:elf:quick-reactions` | combat | rider | Mark a Stress: advantage on a reaction roll |
| `ancestry:elf:celestial-trance` | outOfCombat | passive | Rest: one more downtime move |
| `ancestry:faerie:luckbender` | combat | reaction | Once per session after you or an ally within Close rolls: 3 Hope, reroll the Duality Dice (Q1) |
| `ancestry:faerie:wings` | combat | reaction | Fly; after an adversary attacks you while flying, mark a Stress for +2 Evasion (Q2) |
| `ancestry:faun:caprine-leap` | narrative | passive | Leap within Close as normal movement |
| `ancestry:faun:kick` | combat | rider | Melee success, mark a Stress: +2d6 damage, knock yourself or the target to Very Close |
| `ancestry:firbolg:charge` | combat | action | Agility Roll to move from Far into Melee, mark a Stress: 1d12 physical to all in Melee |
| `ancestry:firbolg:unshakable` | combat | auto | Would mark a Stress: d6, on 6 don't |
| `ancestry:fungril:fungril-network` | outOfCombat | action | Instinct Roll (12): talk to other fungril at any distance |
| `ancestry:fungril:death-connection` | narrative | action | Mark a Stress: a memory from a corpse |
| `ancestry:galapa:shell` | passive | passive | + Proficiency to thresholds (not in derived stats yet) |
| `ancestry:galapa:retract` | combat | action | Mark a Stress: physical resistance, disadvantage on action rolls, can't move, until you come out |
| `ancestry:giant:endurance` | passive | passive | +1 HP slot (done) |
| `ancestry:giant:reach` | passive | passive | Melee features count as Very Close |
| `ancestry:goblin:surefooted` | passive | passive | Ignore disadvantage on Agility Rolls |
| `ancestry:goblin:danger-sense` | combat | reaction | Once per rest: mark a Stress, an adversary rerolls an attack vs you or an ally within Very Close |
| `ancestry:halfling:luckbringer` | passive | auto | Session start: the party gains a Hope (done) |
| `ancestry:halfling:internal-compass` | combat | auto | Roll a 1 on the Hope Die: reroll it |
| `ancestry:human:high-stamina` | passive | passive | +1 Stress slot (done) |
| `ancestry:human:adaptability` | combat | reaction | Fail a roll that used an Experience: mark a Stress, reroll |
| `ancestry:infernis:fearless` | combat | reaction | Roll with Fear: mark 2 Stress, it is with Hope (Q1) |
| `ancestry:infernis:dread-visage` | outOfCombat | passive | Advantage to intimidate hostile creatures (roll option) |
| `ancestry:katari:feline-instincts` | combat | rider | Agility Roll: 2 Hope, reroll the Hope Die |
| `ancestry:katari:retracting-claws` | combat | action | Agility Roll vs a Melee target: temporarily Vulnerable |
| `ancestry:orc:sturdy` | passive | passive | 1 HP left: attacks against you have disadvantage (adversary engine reads it) |
| `ancestry:orc:tusks` | combat | rider | Melee success, spend a Hope: +1d6 damage |
| `ancestry:ribbet:amphibious` | narrative | passive | Breathe and move underwater |
| `ancestry:ribbet:long-tongue` | combat | action | Mark a Stress: Finesse Close weapon, d12 physical using Proficiency |
| `ancestry:simiah:natural-climber` | outOfCombat | passive | Advantage on balancing and climbing |
| `ancestry:simiah:nimble` | passive | passive | +1 Evasion (not in derived stats yet) |
| `ancestry:aetheris:hallowed-aura` | combat | reaction | Once per long rest an ally within Close rolls with Fear: it is with Hope |
| `ancestry:aetheris:celestial-wings` | combat | reaction | Fly; once per scene while flying spend a Hope instead of marking an Armor Slot |
| `ancestry:earthkin:stoneskin` | passive | passive | +1 Armor Score and thresholds (not in derived stats yet) |
| `ancestry:earthkin:immovable` | narrative | passive | Can't be moved against your will while touching the ground (movement is a prompt) |
| `ancestry:emberkin:fireproof` | passive | passive | Immune to flame damage (no fire keyword) |
| `ancestry:emberkin:ignition` | combat | action | Mark a Stress: primary weapon +1d6 damage until scene end |
| `ancestry:gnome:nimble-fingers` | combat | rider | Finesse Roll: 2 Hope, reroll the Hope Die |
| `ancestry:gnome:flicker-step` | combat | action | Once per scene: teleport within Far (move prompt) |
| `ancestry:skykin:gale-force` | combat | action | Mark a Stress: carry you or a Very Close ally up to Very Far (move prompt) |
| `ancestry:skykin:eye-of-the-storm` | combat | action | 2 Hope: you or a Melee ally +1 Evasion until you take Severe damage or use it again |
| `ancestry:tidekin:amphibious` | narrative | passive | Breathe and move underwater |
| `ancestry:tidekin:lifespring` | combat | action | Once per rest with water: mark a Stress, you or a Very Close ally clears 1 HP |

### Community features (15)

| Feature id | Usage | How | Reading |
|---|---|---|---|
| `community:highborne:privilege` | outOfCombat | passive | Advantage with nobles, prices, reputation (roll option) |
| `community:loreborne:well-read` | outOfCombat | passive | Advantage on history, culture, politics (roll option) |
| `community:orderborne:dedicated` | combat | rider | Once per rest embodying a principle: d20 Hope Die |
| `community:ridgeborne:steady` | outOfCombat | passive | Advantage on cliffs, harsh environments, survival (roll option) |
| `community:seaborne:know-the-tide` | combat | rider | Tokens on rolls with Fear, +1 per token spent (done in session features) |
| `community:slyborne:scoundrel` | outOfCombat | passive | Advantage with criminals, lies, hiding places (roll option) |
| `community:underborne:low-light-living` | outOfCombat | passive | Advantage to hide, investigate, perceive in low light (roll option) |
| `community:wanderborne:nomadic-pack` | outOfCombat | action | Once per session, a Hope: pull a mundane item |
| `community:wildborne:lightfoot` | outOfCombat | passive | Advantage to move unheard (roll option) |
| `community:duneborne:oasis` | outOfCombat | passive | Short rest: reroll a downtime die |
| `community:freeborne:unbound` | combat | reaction | Once per session a roll with Fear: it is with Hope (Q1) |
| `community:frostborne:hardy` | outOfCombat | auto | Any rest: clear 1 HP (rest flow) |
| `community:hearthborne:close-knit` | combat | action | Once per long rest: spend any Hope, an ally within Far gains as much |
| `community:reborne:found-family` | combat | rider | Once per rest, a Hope: use an ally's Experience |
| `community:warborne:brave-face` | combat | auto | Once per session forced to mark a Stress: spend a Hope instead |

### Beastform features (45, Q10)

| Feature id | Usage | How | Reading |
|---|---|---|---|
| `beastform:agile-scout:agile` | combat | action | Spend a Hope: move up to Far without rolling (move prompt); silent movement is text |
| `beastform:agile-scout:fragile` | combat | auto | Take Major or greater damage: drop out of Beastform |
| `beastform:aquatic-scout:aquatic` | narrative | passive | Breathe and move underwater |
| `beastform:aquatic-scout:fragile` | combat | auto | Take Major or greater damage: drop out of Beastform |
| `beastform:household-friend:companion` | passive | passive | Help an Ally rolls a d8 advantage die (named Help, Q12) |
| `beastform:household-friend:fragile` | combat | auto | Take Major or greater damage: drop out of Beastform |
| `beastform:nimble-grazer:elusive-prey` | combat | reaction | An attack would succeed against you: mark a Stress, +d4 Evasion against it |
| `beastform:nimble-grazer:fragile` | combat | auto | Take Major or greater damage: drop out of Beastform |
| `beastform:pack-predator:hobbling-strike` | combat | rider | Succeed on a Melee attack, mark a Stress: the target is temporarily Vulnerable |
| `beastform:pack-predator:pack-hunting` | combat | rider | Succeed against the target of the ally who acted just before you: +d8 damage (situation confirm) |
| `beastform:stalking-arachnid:venomous-bite` | combat | auto | Succeed on a Melee attack: the target is temporarily Poisoned (1d10 direct physical each time it acts) |
| `beastform:stalking-arachnid:webslinger` | combat | action | Finesse Roll against a target within Close: temporarily Restrained; web utility is text |
| `beastform:armored-sentry:armored-shell` | combat | action | Physical resistance (passive); mark an Armor Slot to retract: physical damage reduced by Armor Score, no other actions |
| `beastform:armored-sentry:cannonball` | combat | action | Mark a Stress: an ally's attack roll launches you, d12+2 physical with their Proficiency; a Hope for a second target at half |
| `beastform:mighty-strider:carrier` | narrative | passive | Carry up to two willing allies when you move |
| `beastform:mighty-strider:trample` | combat | action | Mark a Stress: move Close in a line, attack all in Melee of it, d8+1 physical, temporarily Vulnerable |
| `beastform:pouncing-predator:fleet` | combat | action | Spend a Hope: move up to Far without rolling (move prompt) |
| `beastform:pouncing-predator:takedown` | combat | action | Mark a Stress: move into Melee and attack; on a success +2 Proficiency and the target marks a Stress |
| `beastform:powerful-beast:rampage` | combat | rider | A damage die rolls 1: add a d10; before an attack mark a Stress for +1 Proficiency |
| `beastform:powerful-beast:thick-hide` | passive | passive | +2 damage thresholds |
| `beastform:striking-serpent:venomous-strike` | combat | action | Attack any number of targets within Very Close; on a success temporarily Poisoned |
| `beastform:striking-serpent:warning-hiss` | combat | action | Mark a Stress: any targets within Melee move back to Very Close (move prompt) |
| `beastform:winged-beast:birds-eye-view` | passive | passive | Fly at will (the Flying toggle, Q16); once per rest airborne, a question about the scene below (text) |
| `beastform:winged-beast:hollow-bones` | passive | passive | -2 damage thresholds |
| `beastform:aquatic-predator:aquatic` | narrative | passive | Breathe and move underwater |
| `beastform:aquatic-predator:vicious-maul` | combat | rider | Succeed on an attack, spend a Hope: the target is Vulnerable and +1 Proficiency on this attack |
| `beastform:great-predator:carrier` | narrative | passive | Carry up to two willing allies when you move |
| `beastform:great-predator:vicious-maul` | combat | rider | Succeed on an attack, spend a Hope: temporarily Vulnerable and +1 Proficiency on this attack |
| `beastform:great-winged-beast:birds-eye-view` | passive | passive | Fly at will (the Flying toggle, Q16); once per rest airborne, a question about the scene below (text) |
| `beastform:great-winged-beast:carrier` | narrative | passive | Carry up to two willing allies when you move |
| `beastform:legendary-beast:evolved` | passive | passive | A larger Tier 1 form: keeps its features, +6 damage rolls, +1 to its trait, +2 Evasion |
| `beastform:legendary-hybrid:hybrid-features` | passive | passive | One more Stress to transform; two Tier 1-2 forms: four advantages and two features from them |
| `beastform:mighty-lizard:physical-defense` | passive | passive | +3 damage thresholds |
| `beastform:mighty-lizard:snapping-strike` | combat | rider | Succeed on a Melee attack, spend a Hope: temporarily Restrained and Vulnerable |
| `beastform:epic-aquatic-beast:ocean-master` | combat | rider | Underwater (text); succeed on a Melee attack: temporarily Restrain the target |
| `beastform:epic-aquatic-beast:unyielding` | combat | auto | Would mark an Armor Slot: d6, on 5+ reduce the severity by one without marking it |
| `beastform:massive-behemoth:carrier` | narrative | passive | Carry up to four willing allies when you move |
| `beastform:massive-behemoth:demolish` | combat | action | Spend a Hope: move Far in a line, attack all in Melee of it, d8+10 physical, temporarily Vulnerable |
| `beastform:massive-behemoth:undaunted` | passive | passive | +2 damage thresholds |
| `beastform:mythic-aerial-hunter:carrier` | narrative | passive | Carry up to three willing allies when you move |
| `beastform:mythic-aerial-hunter:deadly-raptor` | combat | rider | Fly at will; a straight-line charge from Close into Melee and attack: reroll damage dice below your Proficiency |
| `beastform:mythic-beast:evolved` | passive | passive | A larger Tier 1-2 form: keeps its features, +9 damage rolls, +2 to its trait, +3 Evasion, damage die one size up |
| `beastform:mythic-hybrid:hybrid-features` | passive | passive | Two more Stress to transform; three Tier 1-3 forms: five advantages and three features from them |
| `beastform:terrible-lizard:devastating-strikes` | combat | rider | Deal Severe damage in Melee, mark a Stress: the target marks one more HP |
| `beastform:terrible-lizard:massive-stride` | narrative | passive | Move up to Far without rolling, ignore rough terrain (movement is a prompt) |

### Transformation features (12, Q11)

| Feature id | Usage | How | Reading |
|---|---|---|---|
| `transformation:demigod:gifted` | passive | passive | +1 to action, reaction and damage rolls |
| `transformation:demigod:weight-of-divinity` | combat | auto | Fail a roll: mark a Stress or the GM gains a Fear (the player picks) |
| `transformation:ghost:unfinished-business` | narrative | text | The purpose that binds you to the Mortal Realm |
| `transformation:ghost:ephemeral` | passive | passive | Physical resistance, double magic damage; mark 2 Stress to pass through a solid object (text) |
| `transformation:reanimated:corpse` | outOfCombat | passive | During a rest, clear HP only with remains of a recently deceased creature (rest flow) |
| `transformation:reanimated:wont-stay-dead` | outOfCombat | reaction | Risk It All failed: permanently mark a Hit Point to succeed (death move flow) |
| `transformation:shapeshifter:change-shape` | outOfCombat | action | A downtime move during a rest: swap your current ancestry |
| `transformation:shapeshifter:only-skin-deep` | outOfCombat | passive | Only one chosen ancestry feature (build; owned() reads the sheet's ancestry.feature) |
| `transformation:vampire:fangs` | combat | action | Attack with a trait of your choice in Melee: d6 physical using Proficiency |
| `transformation:vampire:feed` | combat | rider | Fangs success, mark a Stress: tokens = HP marked (max 6); a token before an action roll: d20 Fear Die; no tokens: disadvantage |
| `transformation:werewolf:wolf-form` | combat | reaction | Mark 1+ HP: mark a Stress to enter Wolf Form, +1d10 attack and damage; gaining Hope marks a Stress |
| `transformation:werewolf:howling-rampage` | combat | auto | Mark your last Stress in Wolf Form: tier d20s physical to all within Very Close, then drop out |

### Martial stances (16, Q5)

| Feature id | Usage | How | Reading |
|---|---|---|---|
| `stance:martial-artist:favored` | passive | passive | Bonus to damage rolls equal to a trait of your choice |
| `stance:martial-artist:invigorating` | combat | auto | Successful attack: d4, on a 4 gain a Focus |
| `stance:martial-artist:quick` | combat | rider | When you attack, spend a Focus or mark a Stress to target another creature within range |
| `stance:martial-artist:reliable` | passive | passive | +1 to attack rolls |
| `stance:martial-artist:aggressive` | passive | passive | -1 Evasion; on a successful attack an extra damage die, drop the lowest |
| `stance:martial-artist:anchored` | passive | passive | +2 damage thresholds; can't be moved against your will |
| `stance:martial-artist:defensive` | passive | passive | Attacks on you from Melee have disadvantage unless the attacker marks a Stress |
| `stance:martial-artist:otherworldly` | combat | rider | Successful attack: deal physical or magic damage (choice) |
| `stance:martial-artist:grappling` | combat | rider | Successful Melee attack, spend a Focus or mark a Stress: temporarily Restrain or throw within Close |
| `stance:martial-artist:scary` | combat | auto | Successful attack: the target marks a Stress |
| `stance:martial-artist:stable` | combat | reaction | Spend a Focus instead of an Armor Slot to reduce damage |
| `stance:martial-artist:vigilant` | combat | reaction | Targeted by an attack: mark a Stress, +d6 Evasion against it |
| `stance:martial-artist:crushing` | combat | rider | Deal Severe damage, spend a Hope: the target marks one more HP |
| `stance:martial-artist:exacting` | combat | rider | A damage die rolls 1: treat it as the die's highest value |
| `stance:martial-artist:honed` | combat | rider | Spend a Focus before an attack roll: +1 Proficiency for that attack |
| `stance:martial-artist:isolating` | passive | passive | Advantage on attacks when no other creature is within Very Close of you or your target |

