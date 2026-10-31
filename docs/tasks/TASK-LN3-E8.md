# TASK-LN3-E8: feature runner round 3 (plan lanes-2, wave 9, tracer E8.3)

Branch `lane3-e8`, lane `lane:w1-e8-session-features-rests`. Tests: `tests/convex/lane3-e8-round3.test.ts` (17).
Resumed after the machine crash: the first agent's uncommitted work was kept, reviewed and finished.

## What landed

- **Actor fill** (`convex/lib/featureRunner.ts` `actorFill`): a feature use's actor carries Favor / Focus / held dice /
  class dice sizes (`actorExtras`), the Beastbound companion's die (`dieSides.companion`, CB p.40) and damage type
  (`companionDamageType`), and the sheet's `tideTokens`, `classDice`, `stats` that run.ts reads.
- **Extra facts** (`withExtraFacts`): `pickFeature.extraFacts` takes `weapons` too, merged over the sheet's ranges
  (`weapons.attacking`, Surrounded HF p.10); `target` / `subject` replace. `withCreatureAreas(ctx, scene, token, facts)`
  adds `CreatureFacts.areas` (Circle of Power HF p.16) for the callers that build creature facts.
- **Payer flags** (`src/lib/domain/feature-effects/run.ts`): `featureCostShort(actor, use, choices, flags?)` passes the
  payer's rules flags to `unaffordable` (Ravenous `cannotSpendHope`, HF p.94); `flagsOf(mods)` reads them from mods.
- **Otherworldly Ire pays its Favor at the roll** (`convex/lib/featurePrompts.ts`): `paidAtRoll(use)` = the costs whose
  amount reads a number the rolled count reads; `rollAndStoreCount` checks and pays them (`payRollCosts`: Favor, Focus,
  Hope, Stress), writes a public undoable feed row with `before`, and the later use skips them (`withoutRollCosts`, applied
  in `pickFeature`'s transform). Short of Favor: FEATURE_COST_UNPAID, nothing paid.
- **Gold over the cap** (dcm-i5e1, user answer): `giveTo(sheet, gifts, overflow)` keeps what fits (`goldRoom`) and counts
  the excess; `resolveFeatureUse` offers it to another PC within Close of the recipient who has room
  (`passExcessGold`). Choice `giftExcessTo` = a token id or `"drop"`; without it the nearest PC with room takes it; what
  nobody takes is dropped with a feed note (CB p.104). A pick that is no candidate: COMBAT_TARGET_INVALID.
- **Vitality on card choice** (`convex/levelUp.ts`, `src/lib/domain/level-up/on-choose.ts`): `levelUp.apply` takes
  optional `choice.cardChoices` (card id → choose step id → option ids); each gained card (the level's card, a domain card
  option's, a trade's new card) with a `whenYouChooseThisCard` use runs `runOnChoose` once. Slots via `gainSlots`
  (keyed `card:<id>:hp+n` / `stress+n`), threshold bonuses recorded as `card:<id>:major+n` / `severe+n`
  (`permanentThresholds`), the card vaulted. A missing pick: LEVEL_UP_RULE. `undoLast` takes the picks back.
- **Locate Soul Echoes** (dcm-dvia, HF 176): `locateSoulEchoes` rest move (validator widened only), offered on either rest
  in Journey to Horizon only, no sheet change, dropped on an interrupted rest; the rest hook writes a line asking the GM
  for the bearing (the GM button in convex/trackers/horizon.ts gives it). Picker shows a hint.

## Beads

- dcm-atiu: closable (Favor paid at the roll, no backing out).
- dcm-nw7h: closable (count rolled from the chosen Favor, Patron die sizes on the actor, paid at the roll).
- dcm-i5e1: closable (server side; the excess-recipient picker in the UI waits on combat UI, default = nearest with room).
- dcm-pqbo: closable for the fill (companion die / type, stats, Tide tokens, class dice); setStance and gifts were
  already applied by `resolveFeatureUse`.
- dcm-2z2 / dcm-b9hc (3): closable (companion fill).
- dcm-576v: featureRunner half done (extraFacts `weapons`). Left: convex/lib/combatActions.ts passes
  `weapons.attacking` / areas, and the card-rider half (cardRunner.ts buildRun) → dcm-b41o and the bead itself.
- dcm-753y: helper done (`withCreatureAreas`). Left: combatActions.ts creatureFacts calls it → dcm-b41o.
- dcm-hgvx: feature run.ts caller done (`featureCostShort` flags, `flagsOf`). Left: card-effects/run.ts `payer()` (E3),
  adversary-actions/window.ts, and the combatActions.ts call (~1450) passing `flagsOf` → dcm-b41o.
- dcm-31hq / dcm-40mj: engine closable. Left: blade.ts Vitality data (S1, wave 10), thresholds read the bonus
  (dcm-u9pv, E5), level-up UI asks for the picks (dcm-txlu).
- dcm-dvia: closable.
- dcm-sa2: verified, not closable: the runner rerolls (E3, `heldReroll` plan step); left is the server applying / logging
  `heldReroll` (dcm-q40t, E3), the limit sharing `WEAPON_SPECIALIST_KEY` (dcm-inou) and guardian-warrior.ts data.
- dcm-z5a6 / dcm-lvgm: not taken (no `casterMoves` rider on feature uses to hang the carry offer on this round).

## Follow-ups filed

- dcm-b41o (lane:w1-e1-triggers-rolls): combatActions callers fill weapons.attacking, creature areas, payer flags.
- dcm-u9pv (lane:w1-e5-checks-limits-numbers): characters/derived.ts thresholds add `permanentThresholds(sheet)`.
- dcm-txlu (lane:w1-e8-session-features-rests): level-up-draft.tsx sends `cardChoices` for Vitality.
- dcm-84b2 (lane:w1-e1-triggers-rolls): combat-riders Kick test failed once on a critical (random dice; passes on rerun).

## Data switches ready for wave 10

- `src/lib/srd/card-effects/blade.ts` Vitality: an `auto` use on `whenYouChooseThisCard` with one `choose` step
  (`id: "benefits"`, count 2, distinct; options `stress` / `hp` / `thresholds`, each a permanent self `effect` with
  `stat` mods `stressMax` / `hpMax` / `majorThreshold` + `severeThreshold` +2), then `toVault` permanent. The exact shape is
  the `vitality` fixture in tests/convex/lane3-e8-round3.test.ts. Switch it together with dcm-u9pv and dcm-txlu, or keep
  the manual reminder until both land (silent reminders rule, dcm-s9md).
- `src/lib/srd/feature-effects/*` Otherworldly Ire (warlock): `choices: [{id: "favor"}]`, a `tokens` favor cost reading
  `chosen favor`, `targets.count` `upTo` `rolledFirst` with `dice {count: chosen favor, sidesOf: "patron"}, keep: highest`
  (the `ire` fixture in the test).

## Merge-time actions

- `levelUp.apply` args widened (optional `choice.cardChoices`): the authz entry needs no change unless it builds the
  args validator shape; regenerate `convex/_generated`.
- `rests` validator widened with `locateSoulEchoes` (widen only; stored rows still conform).

## QUESTIONS

1. Gold over the cap with no pick (dcm-i5e1): the default gives the excess to the nearest PC within Close who has room
   (ties: token order). Should it instead drop unless the player picks someone? CB p.104: "If you ever have more than 1
   chest, you'll need to store some of your gold before you can take more."
2. Otherworldly Ire (HF p.15: "spend any number of Favor to roll that many Patron Dice"): only the costs reading the
   chosen Favor are paid at the roll; any other cost of the use (e.g. a Hope) is still paid with the use. Is that right,
   or does every cost belong to the roll?
3. Locate Soul Echoes (HF 176: "the players gain access to an additional downtime move"): offered on both short and long
   rests, like the core downtime moves. Correct?
