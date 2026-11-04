# TASK-LN4-E8: feature runner round 4 (plan lanes-2, wave 10, tracer E8.4)

Branch `lane4-e8`, lane `lane:w1-e8-session-features-rests`. Tests: `tests/convex/lane4-e8-round4.test.ts` (13),
`tests/unit/lane4-e8-card-choices.test.ts` (5), e2e `tests/e2e/lane4-vitality-level-up.spec.ts` (skips until blade.ts
Vitality is data; run green against the switched data before the commit, see Checks).

## What landed

- **Otherworldly Ire pays everything at the roll** (dcm-szfg, user answer 2026-10-31; `convex/lib/featurePrompts.ts`):
  `paidAtRoll(use)` is now every cost of a `rolledFirst` use whose count reads a chosen number (Favor and any other
  cost), and `withoutRollCosts` drops the use's costs entirely, so resolution pays none. `payRollCosts` also pays Hit
  Point costs; the feed row names all ("3 Favor and 1 Hope"). Short of any cost: FEATURE_COST_UNPAID, nothing paid.
  A use with a fixed count (Warden's Protection) still pays with the use. `either` / `gold` / `armor` costs at the roll
  stay INVALID (no Ire-like use has one).
- **Plan gifts** (dcm-h1y9; `convex/lib/featureRunner.ts` `giftsOf`): run.ts's own plan `inventory` steps `giveGold`
  (handfuls, default 1) and `giveItem` (a named item) to a PC are written like the manual-prompt gifts (cap, excess gold
  passed on); an unnamed `giveItem` ("a mundane object that the situation requires") is a note "an item the GM picks".
- **Weapon Specialist** (dcm-40rt, dcm-7l0g; CB p.48): `featureLimitKey` maps the `slayer-ones` use to the dice box's
  `WEAPON_SPECIALIST_KEY` (`weaponSpecialistReroll`, until longRest), so the dice box, map attacks, the use and Slayer's
  rider share one reroll. New `ActorState.heldRerolls` (card-effects/run.ts; filled by `actorExtras` for a holder of
  Weapon Specialist): whenever any use pays held dice of that kind (Slayer's own `attack` / `damage` riders), the dice
  showing 1 are rerolled once each, the key goes into `plan.actor.featureUses`, and a `heldReroll` plan step logs it. A
  roll without a 1 keeps the reroll; a spent key rerolls nothing.
- **Vitality's thresholds** (dcm-u9pv; `characters/derived.ts`): `derivedThresholds` adds `permanentThresholds(sheet)`
  (the `card:<id>:major+n` / `severe+n` keys level-up/on-choose.ts records) to Major and Severe. It is the only threshold
  path (sheet, damage calculator, combat, runner `stats`), so all of them count it.
- **Level-up asks the card's picks** (dcm-txlu; `level-up-draft.tsx`, new `src/lib/domain/level-up/card-choices.ts`):
  `cardChoiceAsks(cardsGained(...))` lists each gained card's `whenYouChooseThisCard` choose steps; the draft keeps
  `cardChoices` (stored with the draft), sends them in `LevelUpChoice.cardChoices` (type widened, engine ignores it), and
  adds a problem "Vitality: choose 2 (Two benefits)." (target: the deck) until exactly that many distinct options are
  ticked. Plain UI (user 2026-10-31): `LevelUpCardChoices`, a fieldset of check boxes rendered by the provider on the
  Domain card and Finish steps while such a card is in the draft; further boxes disable once the count is reached.
- **Feature effects record their caster** (dcm-lztq feature writer; `withFeatureCaster`): in `resolveFeatureUse`, every
  effect the use newly wrote (on the actor or another PC) that belongs to the feature gets `casterId` = the using PC's
  character id. Effects already there keep theirs (another Skykin's Eye of the Storm keeps its caster).

## Beads

- dcm-szfg: closable.
- dcm-h1y9: closable (engine). Data: Contacts Everywhere's supply in ranger-rogue.ts (S2.4).
- dcm-40rt: closable.
- dcm-7l0g: closable (engine). Data: guardian-warrior.ts may drop the manual `slayer-ones` use (or keep it as a
  hand-run fallback; it now shares the key). dcm-sa2 and dcm-inou: closable with it (the reroll runs on the Slayer rider;
  the limit is shared). Not in the dice box's own path change: convex/lib/rolls.ts already rerolled.
- dcm-u9pv: closable.
- dcm-txlu: closable for the UI; it shows once blade.ts Vitality is data (S1.4). dcm-o03c: (1) and (2) done; (3) "in your
  vault permanently" (no recall block) and (4) the data switch are left. dcm-31hq: closable once S1.4 switches the data.
- dcm-lztq: feature writer done (`resolveFeatureUse`). Other feature paths that write sheet effects (rest hooks, cardHand,
  adversaryHits window) do not stamp it; E6.4's readers fall back to the old guess there.
- dcm-o3j (At Ease FEATURE_SLOTS from a stressMax mod): not done. It does not fit slots.ts: the SRD feature files import
  characters/slots.ts, so slots.ts reading the feature entries is an import cycle, and At Ease's data still has `mods: []`.
  Left as is (FEATURE_SLOTS stays the gain-time path).
- dcm-lvgm / dcm-z5a6 (carry offer): not taken (time).

## Follow-ups filed

- dcm-4btt (lane:w1-e1-triggers-rolls): the other sheet-effect writers (cardHand, rest hooks, the combat riders through
  cardRunner `writeSheetChanges`) stamp `casterId` with `withFeatureCaster`.
- dcm-fiuc (lane:w2-srd-data): At Ease FEATURE_SLOTS from a stressMax mod without the slots.ts import cycle.
- Vitality's vault-permanent recall block stays on dcm-o03c (3).

## Data switches ready for wave 11 / batch B

- `src/lib/srd/card-effects/blade.ts` Vitality (S1.4): the `vitality` fixture in tests/convex/lane3-e8-round3.test.ts
  (an `auto` use on `whenYouChooseThisCard`, a `choose` step `benefits` count 2 distinct of permanent self effects with
  `stressMax` / `hpMax` +1 and `majorThreshold` + `severeThreshold` +2, then `toVault` permanent). Thresholds and the
  level-up picker are live; switching un-skips tests/e2e/lane4-vitality-level-up.spec.ts.
- `src/lib/srd/feature-effects/ranger-rogue.ts` Contacts Everywhere supply (S2.4): `{ kind: "inventory", to: "self",
  op: "giveGold" }` (1 handful) and/or `giveItem` (with `text` for a named tool; without, the GM's pick note). The pin in
  tests/convex/lane3-s2-features.test.ts now shows the gift is read.
- `src/lib/srd/feature-effects/guardian-warrior.ts` Weapon Specialist (S2.4): the reroll is automatic on Slayer's riders;
  the manual `slayer-ones` use can go (or stay as a hand fallback: it spends the same key).
- `src/lib/srd/feature-effects/warlock.ts` Otherworldly Ire (S2.4): the `ire` fixture in tests/convex/lane4-e8-round4.test.ts
  (`choices: favor`, a `tokens` favor cost reading `chosen favor`, `targets.count upTo rolledFirst` from `dice {count:
  chosen favor, sidesOf: "patron"}, keep highest`); all its costs are paid at the roll.

## Edits outside owns forced by existing tests

- `tests/convex/lane3-e8-round3.test.ts`: the wave-9 assertion "only the Favor is paid at the roll" now asserts every cost
  (the user's 2026-10-31 answer this tracer builds).
- `tests/convex/lane3-s2-features.test.ts`: the pin "giftsOf doesn't read plan inventory steps" now asserts it does.
- `tests/unit/feature-effects/guardian-warrior.test.ts`: the `slayer-ones` limit key is now `weaponSpecialistReroll`.
- `tests/convex/lane-mg-vanishing-act-marker.test.ts`: "the marker exactly as the use writes it" drops the use's new
  `casterId` (a pre-deploy use wrote none; E6.4's backfill adds it).

## Merge-time actions

- No public function added or changed (levelUp.apply already took `cardChoices`): no authz entry, no codegen.
- No stored shape changed (the draft's `cardChoices` lives in sessionStorage; `ActorState.heldRerolls` is in memory).

## QUESTIONS

1. Weapon Specialist (CB p.48: "once per long rest when you roll your Slayer Dice, reroll any 1s"): the reroll now
   happens automatically the first time Slayer Dice show a 1 after a long rest (as the dice box already did). Should
   the player instead be asked whether to spend it on this roll (e.g. two 1s now vs. a later roll)?
2. Vitality (CB p.330: "Then place this card in your vault permanently"): nothing yet stops a later recall of the card
   from the vault. Block its recall, or leave it to the table?

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- Focused: lane4-e8-round4, lane4-e8-card-choices, lane3-e8-round3, lane3-s2-features, guardian-warrior,
  lane-mg-vanishing-act-marker: all pass.
- Full suite (`--maxWorkers=1 --testTimeout=120000`): 421 files, 9855 passed, 1 expected fail.
- e2e `tests/e2e/lane4-vitality-level-up.spec.ts`: passed (1) with blade.ts Vitality switched locally to the fixture
  shape (not committed), then skips (1) against the committed data.
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml E8.4 rebuild HEAD`: reports the four forced test edits above.
