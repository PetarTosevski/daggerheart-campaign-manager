# TASK SD3: Server - the drawer query and useFeature (reusing CA4's card path)

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD3 (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status: Review.

A player (or the GM playing for them) reads their drawer and uses any owned feature from the map or without one. The
server checks ownership, limits and costs, rolls, applies to enemy instances, self and allies through the card runner
path, records the use, and logs public (hit / miss) and GM rows that the existing undo reverts.

## User answers implemented

- **U1 / CF6**: the drawer's and every result's `returns` validator is built from the character's own sheet and the
  player's own dice; no enemy HP, Stress, thresholds or Difficulty (tests check the keys).
- **U4**: one actionLog group per use (public row, a row per other changed character, manual steps, GM row with
  `adversaryBefore`); `actionLog.undo` restores sheets (featureUses, cardTokens, classState, held dice) and instances.
- **combat-actions Q1 / Q2**: a target outside the use's range opens a GM sanction (`combatRequests` kind `sanction`,
  action kind `feature`); line of sight as cards (`Creatures.resolve`).
- **Q3 / Q7**: limits come from SD1's `feat:` keys with their period; the drawer shows the reset label.
- **Q5**: `shiftStance` (spend a Focus, or a Stress with Flow State) and `refocus` (once per rest, Instinct d6s, keep
  the highest, max 6), HF p.12.
- **Q13**: a situation the engine can't read refuses (INVALID) until the player confirms it in `choices.situations`.
- **Q15**: out-of-combat and narrative features are listed with state `outOfCombat` / `narrative` and refuse a Use
  (FEATURE_NOT_COMBAT).
- **Q16**: `setFlying` writes the sheet effect `flying` (until turned off) for a character holding a feature whose
  classification reads "Fly"; the requirement facts read it.

## What changed

| File | What |
|------|------|
| `convex/lib/cardRunner.ts` | `UsePick {effect, use, name, limitKey, run?, refusal?, actor?}` (`CardPick` is its alias; `pickCard` sets `limitKey: cardId`). `buildRun` takes `scene: AttackScene \| null` (off the map: the actor's id is its character id, a self use targets the actor, no token can be named: `Creatures.scene` throws FEATURE_NEEDS_MAP). `runCard` runs `pick.run` (default the card runner), maps refusals with `pick.refusal`, and returns the runner's `delegated` (D5 sheets and rolls). Feature effect ids `feat:<hash>:<n>` (`effectKeyOf`, `ownsEffect`, `featureIdOfEffect`, `effectOption`); tokens under `feat:<featureId>` (`tokenKeyOf`). `actorSheetAfter` also writes Favor, Focus and the held dice left, and keeps up to `FEATURE_USES_MAX` (60) uses. Card behaviour unchanged. |
| `convex/lib/cardRows.ts` | Instance modifiers of a feature are `feat:<featureId>:<n>`; the exclusive filter is per use (cards unchanged). |
| `convex/lib/classFeatureCost.ts` | `payCost`, moved unchanged from `convex/classFeatures.ts`. |
| `convex/classFeatures.ts` | Imports `payCost` from there. |
| `convex/lib/featureRunner.ts` | `pickFeature` (ownership through `owned()` with the campaign's Hope & Fear option, classification, effect entry, passive use, upgrades, D5 party for delegation, actor extras and NV7 facts), `featureRefusal` (FEATURE_EXHAUSTED, FEATURE_COST_UNPAID, INVALID, COMBAT_TARGET_INVALID), `splitFeatureChoices` (`times` 1-10, `dieIndexes`), `needsMap`, per-target keys (`storedLimitKey` / `expandedLimitKey`), `delegateLine` (Rally's die from the plan), `resolveFeatureUse` (sheets, others, instances, Fear, rows, countdown tick, PC hits). |
| `convex/lib/featureDrawer.ts` | `drawerValidator` and `drawerOf`: trackers with maxima, Flying, Martial state, D5 counters, held dice, every owned feature (source, card, multiclass, usage, how, automated, state, reset label, tokens, upgrades) with its uses (activation, ready, uses left, rolls, targets, choices, cost and limit badges, repeatable, situations). |
| `convex/combatFeatures.ts` | `drawer`, `useFeature`, `pending`, `sanction`, `setFlying`, `shiftStance`, `refocus`. |
| `tests/convex/combat-features.test.ts`, `tests/convex/authz/features.*` | Below. |

### Public functions (authz area `features`)

| Function | Wrapper | Who |
|----------|---------|-----|
| `combatFeatures.drawer {characterId}` | campaignQuery view | the character's player and the GM; another player while hands are shared (as `combatCards.hand`) |
| `combatFeatures.useFeature {characterId, mapId?, featureId, useId?, targetTokenIds, choices, roll?}` | keyedCampaignMutation view + edit on the character | player for their own, GM for any |
| `combatFeatures.pending {}` | campaignQuery view (enough owner) | own sanctions; all for the GM |
| `combatFeatures.sanction {requestId, approve}` | keyedGmMutation | GM |
| `combatFeatures.setFlying {characterId, flying}` | keyedCampaignMutation view + edit | as useFeature |
| `combatFeatures.shiftStance {characterId, stance, payWith?}` | keyedCampaignMutation view + edit | as useFeature |
| `combatFeatures.refocus {characterId, calm}` | keyedCampaignMutation view + edit | as useFeature |

## Book passages checked (printed pages)

- CB p.107, Spending Resources: "Unless an effect states otherwise, you can't spend Hope or mark Stress multiple times on
  the same feature to increase or repeat its effects on the same roll. … However, on an effect like the Guardian's Hope
  Feature, which says 'Spend 3 Hope to clear 2 Armor Slots,' you can spend 6 Hope to clear 4 Armor Slots, because this
  effect isn't applying its bonus to a specific roll—you're just activating the feature more than once." (`times`.)
- CB p.107: "As always, if there's any uncertainty, the GM arbitrates how effects apply." (Q13 check box, GM undo.)
- CB p.57, Wings: "You can fly. While flying, you can mark a Stress after an adversary makes an attack against you to gain
  a +2 bonus to your Evasion against that attack." (Q16.)
- HF p.12, Focus: "Once per rest during a moment of calm, you can clear your mind and refocus your martial instincts.
  Clear your Focus track, then roll a number of d6s equal to your Instinct and gain Focus equal to the highest result
  rolled. You can hold a maximum of 6 Focus." Shifting into Stances: "You can spend a Focus to shift into a martial stance
  and gain its effects. You can shift only into stances you've marked as known. … You can't shift into or have more than
  one active stance at a time." Dropping out: "If you are already in a stance when you shift into a different stance, you
  automatically drop out of the previously active stance."
- HF p.11, Flow State: "You can mark a Stress instead of spending a Focus to shift into a different stance."
- CB p.29, Epic Poetry: "Your Rally Die increases to a d10." (The D5 feed line now reads the die the plan gave.)

## Tests

- `tests/convex/combat-features.test.ts` (12; the FE-* entries are injected with `vi.mock`, named after the feature
  each stands in for): refusals (not owned, out of combat, needs map, cost); Q13 confirmation, once per rest, repeat of a
  limited feature refused; Frontline Tank ×2 off the map (6 Hope, 4 Armor Slots) and undo; Make a Scene on the instance
  (tag, Difficulty −2 as `feat:hope:bard:1`), GM row `adversaryBefore`, public row words, no stat for the player, undo;
  Rally delegated to D5 (d10 for the bard and the ally, feed says d10, D5's `rally` key exhausts it, undo clears the
  ally's die); out of range → pending → GM approval; the drawer (trackers, states, badges, hand sharing, reset label);
  Flying; stances and Refocus; per-target keys within 80 characters; one feature per group table that has entries
  (real tables; see open point 7).

## Checks

- `pnpm lint`, `pnpm typecheck` (with `convex/_generated` regenerated locally, not committed): clean.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 302 files, 7948 passed, 1 expected fail.
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml SD3`: OK. No e2e is named.
- `tests/convex/authz/features.entries.ts`: every new function for anonymous, outsider, player, other player and GM.
- Every combat-cards and class-features test passes untouched.

## Open points (no mechanic decided here)

1. **Refocus with Instinct 0 or below.** HF p.12 says "roll a number of d6s equal to your Instinct"; with Instinct ≤ 0
   the server rolls no dice and the Focus becomes 0 (the literal reading). Question for the user: (a) keep that; (b) roll
   at least one d6; (c) refuse Refocus.
2. `holdLimit` (NV15, "up to N creatures at once") is passed through in the plan but not enforced across instances; D5's
   Hex refuses past the Spellcast limit through delegation.
3. Area steps (Q14) only note "an area to place on the map"; writing `combatAreas` is SD-A's. Help steps (Q12) are noted
   in the feed; the named Help flow is SD-H's.
4. The Party sheet's D5 `classFeatures.use` path still gives Rally d6 / d8 (it doesn't read the effect entries'
   upgrades); only the drawer path applies Epic Poetry.
5. A delegated D5 feature's `params.choice` (Hex's target name) is whatever the entry gives; the enemy's label is not
   filled in automatically.
6. Card Minion offers are not made for feature damage (no feature in the analysis deals Minion damage on its own use).
7. The branch is based on `rebuild` at b3ff31b, where the tables are empty. With the twelve tables from the current
   `rebuild` checked out over it, `combat-features.test.ts` and the features matrix still pass (46 tests, one feature
   per table through `useFeature`); the orchestrator reruns them after the merge.
