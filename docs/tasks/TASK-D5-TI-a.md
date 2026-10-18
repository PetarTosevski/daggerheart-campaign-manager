# TASK-D5-TI-a: Integration of dice, class features and the features panel

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer TI-a (wave 4). Items 1-5, 7, 8 and 21-26 of `.omc/autopilot/d5-integration.md`, plus the coordinator's follow-up (Tribute duplicate).

## Done

| Item | What changed | Test |
|---|---|---|
| 1 Brawler +1 Evasion | `derivedDefense` adds the largest `evasionBonus` of the active weapon overrides (`overrideEvasion` in `hooks.ts`) when the sheet has `classId` and `proficiency`. Override modules now take a `WeaponSheet` (the weapon fields only). | `tests/unit/derived.test.ts` |
| 2 Filter by Hope & Fear | `rollOptions`, `weaponOverrides` and `afterDualityRoll` take a `FeatureScope` (`{ hopeAndFear, ikonis }`) as a 4th argument; a Hope & Fear class module answers only with `hopeAndFear`. `convex/rolls.ts` builds the scope from the campaign (`resolveOptions`), the dice box from its slot's `hopeAndFear` and the Motherboard module. | unit `class-features-hf` (integration), convex `rolls` (integration) |
| 3 Brawler's Strike listed twice | The dice box hides the "Primary: Brawler's Strike" entry while the `brawlersStrike` override applies; the server sends a primary-weapon request for Brawler's Strike to the override. When listed (with a secondary weapon), `weaponDice(..., scaleAll)` scales both dice (HF 10). | unit `dice`, convex `rolls`, e2e `class-features-hf` |
| 4 Target name | `FeatureMeta.inputs` (see 23): Marked for Death and Hex have a "Target name" text input (`params.choice`). | unit `class-features-hf`, e2e `class-features-hf` (Hex) |
| 5 Get In & Get Out | `FeatureCost.effectId` (roll options only): `applyRollOptions` ends that effect and refuses when it is gone. Get In & Get Out's option costs `effectId: "get-in-get-out"`; the old `featureUses` mark is gone. | unit `dice`, unit `class-features-hf`, convex `rolls` |
| 8 Crit maxes bonus dice | `DamageInput.bonusDice`: option dice (Marked for Death, Sneak Attack, Rally Die) are rolled after the base dice and a critical adds their maximum too, after `critBase` or the base dice' maximum (CB 98). | unit `dice`, unit `class-features-hf`, convex `rolls` (Brawler crit + Rally Die) |
| 21 Ikonis | `src/lib/domain/dice/ikonis.ts` `ikonisWeapon`: range dice at Proficiency, flat + Bonded (level) + Force/Sear/Bury; Converge/Target attack bonus; Override advantage (CB 301, module sheet). `rolls.ts`: damage source `{ kind: "ikonis" }` and Duality flag `ikonis: true` (uses the Ikonis's trait, implies an attack). The dice box offers "Ikonis: …" as a damage source and an "Ikonis attack" checkbox in Motherboard. | unit `dice`, convex `rolls` |
| 22 Combat Training | The Warrior's Combat Training option is not offered when `scope.ikonis` (Motherboard, CB 295). | unit `class-features-core`, convex `rolls` |
| 23 Generic inputs | `FeatureInput` kinds `text`, `select`, `number`, `heldDice`, `rollDice`, `ally`, rendered by the panel: Strange Patterns' number and benefit, Channel Raw Power's card, Beastform's form, Evolution's trait, Ranger's Focus target, Prayer Dice selection and ally, Volatile Magic's dice. | unit `class-features-core`, e2e `class-features` (Strange Patterns) |
| 24 Prompt buttons | The dice box renders each prompt choice as a button that calls `classFeatures.use({ featureKey, params: { choice } })`, also after a typed-in roll. | e2e `class-features` |
| 25 Generic held dice | `held-dice.ts`: `heldDiceOptions` (Rally Dice, added by `hooks.rollOptions` for every sheet, outside the Hope & Fear filter) and `rallyDieStress` (added to every module by the registry; `classActions` lists a shared action once). The per-class wiring in `bard.ts` and the nine Core modules is gone. | unit `class-features-hf`, convex `rolls` |
| 26 Reaction prompts | `rolls.ts` runs `afterDualityRoll` on reaction rolls too (Strange Patterns, CB 50). The Warlock's prompt checks for an action roll itself. | convex `rolls` |
| Tribute | The `tribute` class action is removed from `warlock.ts` (TI-b made it a rest move); `warlockSpellcast` stays. | unit and convex `class-features-hf` |

## Not done

- **7 Combo Die advancement.** Needs a new level-up option (`comboDie`) in `ADVANCEMENT_OPTIONS` (`src/lib/validation/characters.ts`), in the advancement validators (`convex/lib/validators/characters.ts`) and in `convex/levelUp.ts`'s `choiceValidator`; none are in TI-a's `owns`. The domain change after that: `OPTION_RULES.comboDie` (Brawler only, one slot per tier, cost 1), apply raises `classState.comboDie` one step (d4 → d6 → d8 → d10 → d12), revert lowers it, and the stepper lists it for Brawlers.
