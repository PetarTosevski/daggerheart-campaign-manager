# TASK LN2-E8: feature runner, delegates, prompts, companion, rests (round 2)

Plan `.omc/plans/lanes-2.yaml`, tracer E8 (label `w1-e8-session-features-rests`), wave 8. Status: Review.
Book pages are printed pages (CB = Core Book, HF = Hope & Fear). Tests: `tests/convex/lane-e8-round2.test.ts` (inline
fixtures; the SRD entries switch in wave 9). Round 1: `docs/tasks/TASK-LN-E8.md`. Triage: `docs/tasks/TASK-LN-V2.md`.

## What landed

- **Sheet numbers** (`src/lib/domain/feature-effects/run.ts` `sheetNumbers`, `bindSheetNumbers`): `tideTokens`,
  `classDie` (Unstoppable's value, a held class die's rolled value) and `stat` with `who: "self"` (Armor Score, Evasion,
  thresholds after gear and effects) are written into the use as fixed numbers before it runs. `pickFeature`
  (`convex/lib/featureRunner.ts`) applies it through its `transform`. Stands in until run.ts copies them from the actor
  (dcm-rs1z, E3); harmless after.
- **Own facts** (`ownFacts`): the feature's own tokens (`cardTokens` under `feat:<id>`), the moon die (`moonPhase`),
  the items carried and the weapons' ranges are added to the facts a feature's checks read.
- **Non-stacking effects** (`refuseStacked`, `effectLabelsOn`): a `stacking: "refuse"` effect on a creature that already
  carries that label becomes a table note instead.
- **Gifts** (`giftsOf`, `giveTo`): `inventory giveGold` (default 1 handful, through `addGold`, CB p.104) and
  `giveItem` with a `text` are written to the PC recipients (actor and allies) and noted; an unnamed item stays a prompt
  (the GM's pick).
- **setStance** (`stancesOf`): a `setStance` step (V's manual fallback or a future plan step) shifts the actor's stance
  through `convex/lib/stanceDrop.ts setStance` (the old stance drops first; its adversary writes go to the GM row's
  `adversaryBefore`, so undo restores them).
- **Unstoppable** after a delegated D5 action (`afterUnstoppable`) and **usedAgain** endings of the feature's own effects
  (`endOnSheet` with `ownsEffect`).
- **Held dice picks** (`splitFeatureChoices` takes `{id: "heldDicePicks", value: [ids]}`; `pickFeature({heldDicePicks})`
  passes them to `runFeature` / run.ts).
- **Delegate reads the use's roll** (`delegate.ts`): `DelegateRequest.roll` (the use's own roll) wins over the caller's
  latest roll; a target the roll missed (`hit: false`) reads it as the failure with the same die (`missedFor`).
- **Count rolled from a chosen number** (`convex/lib/featurePrompts.ts` `countChoices`, `withChosenCount`, `chosenMark`,
  `isMarkOf`; `convex/featurePrompts.ts rollCount` new optional arg `choices: Record<string, number>`): Otherworldly Ire
  rolls its Patron Dice from the Favor chosen. The player must hold the Favor when rolling (FEATURE_COST_UNPAID); the
  chosen number is stored as a scene mark beside the roll's mark, and the use must repeat it (INVALID otherwise), so the
  use's costs pay the Favor the roll was made with. Undo / scene end drop the marks with the roll's mark.
- **Vitality** (`onChooseUse`, `runOnChoose`): runs an entry's `whenYouChooseThisCard` use once, without its limit; the
  caller writes the plan's permanent picks. Runner side only.

## Beads

| Bead | State | Note |
|---|---|---|
| dcm-vf7i gold / item gifts | done (engine) | data wave 9 (ranger-rogue.ts) |
| dcm-40mj Vitality's permanent pick | partly | runner side; the level-up / card flow: follow-up dcm-31hq |
| dcm-bxp.99.19.4 Armored Shell's Armor Score | done (E8 half) | `stat armorScore` bound from the sheet |
| dcm-q3t1 Otherworldly Ire count from the Favor | done (E8 half) | featurePrompts side; run.ts rollTargetCount still gets no choices (bound before the call instead). Drawer input is combat-ui |
| dcm-gov | done with dcm-q3t1 | |
| dcm-rm9 tideTokens / moonPhase facts | done (E8 half) | |
| dcm-me3 StateFacts for features | done | own tokens, moon die, tide tokens, class dice |
| dcm-kkx Blight Seed doesn't stack | done (E8 half) | `replace` stays E6 (dcm-9z2z) |
| dcm-awh Stance Fighter sets the stance | done (E8 half) | |
| dcm-4xl setStance + Unstoppable lapse | done | |
| dcm-v17 Unstoppable's end, classDie | done (E8 half) | |
| dcm-lk8 Lunar Phases moon die | done | `moonPhase` fact |
| dcm-qbn Prayer Dice picks | partly | runner side; convex/combatFeatures.ts (E6) must pass them: follow-up dcm-ef77 |
| dcm-78x Know the Tide tokens | done | |
| dcm-d1d / dcm-8dhe delegate reads the use's roll | done | |
| dcm-ii4 Circle of Power subject areas | not | E4's point / tokensGone first (dcm-u2wx) |
| dcm-gvr / dcm-bn1 / dcm-1kvg riders on feature uses with a roll | not | needs a Host around `useFeature` in convex/combatFeatures.ts (E6's) as `cardWithRiders` does; dcm-1kvg stays open |
| dcm-22q Grace-Touched | not | cross-lane (every Stress path); stays open as the triage says |
| dcm-2z2 / dcm-b9hc companion | not (this round) | the remaining work is combatFeatures.prepare (E6) and run.ts (E3), tracked in dcm-b9hc |
| dcm-sa2 reroll Slayer 1s | not | E3 (dcm-inou) |

## Follow-ups filed

- dcm-ef77 (lane:w1-e6-endings-durations): `useFeature` passes `heldDicePicks` to `pickFeature`.
- dcm-31hq (lane:w3-cross): the card acquisition flow calls `runOnChoose` (Vitality).

## Public function changes

`featurePrompts.rollCount` gained an optional arg `choices: v.record(v.string(), v.number())` (at most 10, whole numbers
0-99). Same access (`need: "view"`, editable character); the authz entry needs no change unless it lists args exactly.

## Stored shapes

No validator changed. The chosen number of a rolled count is a `featureUses` entry
`rolledCount:<requestId>:<choice>=<n>` until "scene" (existing shape).

## QUESTIONS (none blocking)

1. Otherworldly Ire's Favor is paid by the use, not at the roll: the roll only checks the Favor is held and binds the
   number (HF p.15: "spend any number of Favor to roll that many Patron Dice and target a number of creatures within
   Close range equal to the highest result"). A roll the player abandons costs nothing; if it should, the roll must pay.
2. A gift to a PC at the gold cap (a second chest full) refuses the whole use (INVALID) rather than dropping the gold
   (CB p.104).
