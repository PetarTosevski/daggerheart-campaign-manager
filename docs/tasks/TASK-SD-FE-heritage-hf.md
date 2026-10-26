# TASK FE-heritage-hf: Feature effects - Hope & Fear ancestries and all communities

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-heritage-hf (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status: Review.
Book pages are printed pages: CB = Core Book, HF = Hope & Fear. The vocabulary and the runner are unchanged.

## What landed

| File | What |
|------|------|
| `src/lib/srd/feature-effects/heritage-hf.ts` | `HERITAGE_HF_EFFECTS`: 28 entries, each quoting its feature with the page. `HERITAGE_SITUATIONS` holds the situation texts the player confirms (Q13). |
| `tests/unit/feature-effects/heritage-hf.test.ts` | 22 tests through `runFeature`. The table must match exactly, so a missing, extra or duplicate id fails. Every use runs. Each feature is checked for costs, limits, triggers, folds and prompts, using values taken from the book by hand. |

Scope, from the plan entry and Q13 and Q15 (b):

- **Combat or passive features (16).** These are the Hope & Fear ancestry features and the community features that the classification marks combat or passive.
- **Roll options (8).** These are passive advantages that apply only while the player ticks the situation. They include Dread Visage (Infernis) and Natural Climber (Simiah), which are Core ancestries but are named in this tracer's acceptance.
- **Rest-trigger entries (4).** Hardy, Oasis, Efficient (Clank) and Celestial Trance (Elf). Tracer SD-R runs them.
- **No entry.** Immovable, Tidekin Amphibious, Nomadic Pack and Luckbringer (see open point 1) have no entry.

## User answers implemented

- **Q1:** Hallowed Aura, Unbound and Nimble Fingers are after-roll reactions.
- **Q7:** Celestial Wings and Flicker Step have scene limits. Ignition's effect lasts for the scene.
- **Q9:** movements (Flicker Step, Gale Force) are prompts.
- **Q13:** situations are player check boxes. These cover the principle for Dedicated, the water for Lifespring, the flame for Fireproof, Ignition's weapon and the social situations. Dedicated comes only from `communityId` orderborne, and a test checks every other community.
- **Q15 (b):** social advantages are roll options. The rest-time features use `timing` triggers.
- **Q16:** the Celestial Wings requirement uses `check: flying`, which reads the drawer's Flying toggle.

## Features and readings

| Feature | Page | Uses | Reading |
|---------|------|------|---------|
| Hallowed Aura | HF p.19 | reaction `afterAllyRolls` Close, withFear | Once per long rest. Folds `modifyRoll withHope` onto the ally who rolled. |
| Celestial Wings | HF p.19 | reaction `whenArmorSlotMarked` self | Needs flying. Once per scene. Folds `convertMarks armor→hope`: the Armor Slot mark is paid with a Hope instead. Like Splendor-Touched, the convert itself spends the Hope. |
| Stoneskin | HF p.21 | passive | +1 `armorScore`, +1 `majorThreshold`, +1 `severeThreshold`. SD2 sums these. |
| Fireproof | HF p.22 | reaction `whenYouWouldTakeDamage` | The player confirms the damage is flame, then the damage is negated (CB p.99: immune means "ignore incoming damage"). |
| Ignition | HF p.22 | `main` action, `ablaze` rider | `main`: costs a Stress and adds a scene-long effect with the label. `ablaze`: on a successful weapon attack while the Ignition effect is active (featureEffect check) and the player confirms the primary weapon, `modifyDamage add 1d6`, rolled on each damage roll. |
| Nimble Fingers | HF p.25 | reaction `afterYouRoll` finesse | Costs 2 Hope. Folds `reroll hope`. |
| Flicker Step | HF p.25 | action | Once per scene. Gives a teleport prompt within Far. |
| Gale Force | HF p.23 | action, self or ally within Very Close | Costs a Stress. Gives a move prompt up to Very Far. Controlling your fall is fiction. |
| Eye of the Storm | HF p.23 | `main` (you), `ally` actions | Costs 2 Hope. Gives +1 Evasion, `exclusive`. On you it ends on `takeSevere` or `usedAgain`. On an ally it ends on `usedAgain`, plus `endsWhen` for the skykin's Severe damage (gap). |
| Lifespring | HF p.24 | action | Once per rest. Needs water (check box). Costs a Stress. Clears 1 HP on you or an ally within Very Close. |
| Dread Visage, Natural Climber | CB p.66, p.70 | passive roll options | Advantage on action rolls. Natural Climber's advantage is on Agility Rolls. |
| Efficient | CB p.53 | reaction `timing afterRest` | Situation "This is a short rest". A manual step: choose a long rest move instead. |
| Celestial Trance | CB p.56 | reaction `timing afterRest` | A manual step: one more downtime move. |
| Privilege, Well-Read, Steady, Scoundrel, Low-Light Living, Lightfoot | CB p.73, 74, 76, 78, 79, 81 | passive roll options | Advantage on action rolls while the situation is confirmed. |
| Dedicated | CB p.75 | rider `beforeYouRoll` action | Once per rest. The principle is confirmed by check box. Folds `hopeDie 20`. |
| Know the Tide | CB p.77 | rider `beforeYouRoll` action | Choice `tokens` from 1 up to your level. Adds `delegate knowTheTide` with that amount, the session feature's `spendTideTokens`. Folds `modifyRoll add tokens`. Placing tokens and clearing them at session end stay in the dice and session paths that already do them. |
| Oasis | HF p.27 | reaction `timing afterRest` | Situation "This is a short rest". A manual step: reroll a downtime die and keep the higher result. |
| Unbound | HF p.28 | reaction `afterYouRoll` any, withFear | Once per session. Folds `withHope`. |
| Hardy | HF p.29 | auto `timing afterRest` | Clears 1 HP. Fully expressed. |
| Close-Knit | HF p.30 | action, ally within Far | Once per long rest. Choice `hope` (min 1). Costs that much Hope. The ally gains the Hope spent. |
| Found Family | HF p.31 | rider `beforeYouRoll` action | Once per rest. Costs a Hope. Folds `experience borrowAlly`. Trading the card is a sheet edit. |
| Brave Face | HF p.32 | reaction `wouldMarkStress` forced | Once per session. Folds `convertMarks stress→hope`. |

Activation notes: the classification lists Nimble Fingers as a `rider` and Fireproof and Brave Face as `passive` or `auto`. Its `how` column is guidance only. These entries use reactions instead, because each one is an optional "you can" decided after the roll or hit.

## Manual steps and vocabulary gaps (beads)

| Feature | What is manual or player-confirmed | Bead |
|---------|-----------------------------------|------|
| Ignition | "with that weapon": a check box, because no damage rider can be narrowed to the primary weapon | dcm-ab5 |
| Eye of the Storm (ally) | "until you take Severe damage": `endsWhen`, ended by hand | dcm-wjv |
| Know the Tide | `delegate` reaches only D5's registry, so `runFeature` with a sheet refuses (a test pins this). There is also no number source for the tokens held. | dcm-78x |
| Efficient, Celestial Trance, Oasis | There is no short-rest or during-rest timing and no downtime-move step. Manual text is used, and SD-R implements them. | dcm-2a1 |
| Fireproof | There is no fire damage keyword, so the player confirms the flame | dcm-dv6 (comment added) |

Integration notes for later tracers (not vocabulary): the reaction window (`window.ts` `foldsFromPlan`) folds `convertMarks` only from `hp`. SD4 needs `armor→hope` for Celestial Wings and `stress→hope` for Brave Face. SD5 needs a route for `knowTheTide`.

## Open points and questions

1. **Luckbringer** (Halfling, CB p.64) is named in this tracer's tests clause ("Know the Tide and Luckbringer delegated to the session features"). However, it is a Core ancestry feature classified `passive`, so FE-ancestry-core's acceptance ("every core ancestry feature classified combat or passive") puts it in that table. Writing it here too would make `mergeFeatureTables` throw. It is left to FE-ancestry-core. The orchestrator should confirm.
2. **Celestial Wings (HF p.19):** "Once per scene while flying, you can spend a Hope instead of marking an Armor Slot." (a) Only when you could mark an Armor Slot (armor worn, a slot free); the Hope replaces that mark (as written: trigger `whenArmorSlotMarked`). (b) Any hit while flying, even with no armor or every slot marked: a Hope reduces severity by one. (c) As (a), and it also stacks with a real Armor Slot mark on the same hit.
3. **Found Family (HF p.31):** "spend a Hope to use an ally's Experience as if it were your own." (a) That Hope is the Experience's usual Hope (1 Hope in total, as written). (b) The usual Experience Hope is paid too (2 Hope).
4. **Brave Face (HF p.32):** "when you would be forced to mark a Stress, you can spend a Hope instead." When an effect forces 2 or more Stress at once: (a) one Hope replaces one Stress and the rest is marked; (b) one Hope replaces the whole forced mark. As written, the `convertMarks` fold carries no count, so SD4 decides. Also: (a) "forced" means any Stress that is not paid as a cost you chose (as written: `forced: true`).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 300 of 301 files pass; 7915 passed, 1 expected fail. The one
  failure is SD0's old assertion in `tests/unit/feature-classification.test.ts` ("empty until their FE tracers fill
  them"). It fails as soon as any table is filled, and on `rebuild` it has already been replaced by a check that every
  entry is classified.
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-heritage-hf`: OK.
