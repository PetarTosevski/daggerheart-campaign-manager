# TASK SD FE-assassin-brawler: Feature effects of Assassin and Brawler

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-assassin-brawler (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status:
Review.

The Assassin and Brawler effect table: one entry for each of the 25 features classified combat or passive. The other 3
features get no entry: Get In & Get Out and Limit Breaker are out of combat, and Adder's Blessing is narrative. Each entry
quotes its book text with the printed page in a comment. The vocabulary is unchanged. No Convex function, validator or UI
change.

## Files

| File | What |
|------|------|
| `src/lib/srd/feature-effects/assassin-brawler.ts` | `ASSASSIN_BRAWLER_EFFECTS` (25 entries) and `MARKED_FOR_DEATH` (the tag name). |
| `tests/unit/feature-effects/assassin-brawler.test.ts` | 40 tests, all through `runFeature` with queued dice. |

## User answers implemented

- **Q1:** True Strike is an after-roll answer on your own failed attack.
- **Q2:** Keen Defenses is a before-roll answer (`whenAttacked`, stage `targeted`).
- **Q4 (CB p.107):** Deadly Determination has no roll, so it can be used more than once (`times`).
- **Q5:** Focus is paid from `pool: "focus"` (Keen Defenses, Focus Cannon, Stance Fighter, and Combo Strike with Flow State).
- **Q7:** First Strike is limited to once per scene (`limit.per: "scene"`, stored `until: "scene"`).
- **Q9:** Overwhelm's throw is a movement prompt.
- **Q13:** Surrounded's "Melee weapon" is a situation check box (see the gap below).

## Readings (book text in the table's comments; HF = Hope & Fear, printed pages)

| Feature | Page | Entry |
|---|---|---|
| Deadly Determination | HF p.8 | action, 3 Hope, clear 2 Stress |
| Marked for Death | HF p.8 | `main`: rider on a successful weapon attack, 1 Stress, tags the target `Marked for Death` (duration rest, `exclusive`: one at a time) and delegates to D5 `markedForDeath` (its sheet effect stays the one record, NV2). `damage`: auto on damage dealt, `+tier d4` to the tagged target only. Upgrades: Ambush d6, Backstab d8 (NV3, `useId: damage`). |
| First Strike | HF p.8 | auto on `whenYouAttack {success, firstInScene}`, damage x2, once per scene |
| Ambush, Backstab | HF p.8 | passive markers; the change is an upgrade on Marked for Death |
| Death Strike | HF p.8 | rider on `whenTargetMarksHp {severe}`, 1 Stress, the subject marks 1 more HP |
| Scorpion's Poise | HF p.8 | passive +2 Evasion `versus` the tagged creature, `attacksByThem` (NV9) |
| True Strike | HF p.8 | reaction `afterYouRoll {attack, failure}`, once per long rest, 1 Hope, `setOutcome: success` |
| Toxic Concoctions | HF p.9 | `brew`: 1 Stress, add 1d4+1 tokens. `poison`: rider on a successful weapon attack, 1 token, choose a poison. `long-rest`: clear the tokens after a long rest. |
| Poison Compendium, Venomancer | HF p.9 | passive markers; their poisons are `extraOptions` on the `poison` and `second-poison` choices |
| Twin Fang | HF p.9 | passive marker; its upgrade adds an optional step to `poison` (gated on the tag, 1 more token, a `second-poison` choice). It is an upgrade because the tokens are Toxic Concoctions' |
| Square Up | HF p.10 | action, 3 Hope, an enemy within Close is temporarily Vulnerable |
| I Am the Weapon | HF p.10 | passive, no mods: D5's `brawlersStrike` override already applies the weapon and the +1 Evasion in derived stats, so SD2 must not count it twice |
| Combo Strike | HF p.10 | rider on `whenYouAttack {success, weapon, melee}`; pays inside a `cost` choice (Stress) and then delegates to D5 `comboStrike` (`delegateRoll` = the damage roll). Flow State adds the Focus option. |
| Rugged | HF p.10 | passive +3 Severe threshold (SD2 replaces `SUBCLASS_BONUSES.juggernaut` with it) |
| Overwhelm | HF p.10 | rider on a successful attack, 1 Hope, choose: throw within Close (prompt) or the target marks a Stress |
| Surrounded | HF p.10 | rider `beforeYouRoll weaponAttack`, choice `hope` (min 1), that much Hope, `addTargets` for that many creatures within Melee (NV18) |
| Eye for an Eye | HF p.10 | reaction `whenYouMarkHp {sourceWithin: melee}`, once per rest, 1 Stress, the source marks `triggerAmount` HP |
| Pummeljoy | HF p.10 | auto on a Melee weapon critical: +1 Hope, clear 1 Stress, +1 Proficiency on that damage |
| Not Done Yet | HF p.10 | reaction `whenYouTakeDamage {severe}`, choose: gain a Hope or clear a Stress |
| Stance Fighter | HF p.11-12 | `shift`: pays inside a `cost` choice (1 Focus; Flow State adds 1 Stress), then a manual step. SD3's `shiftStance` sets the stance and should run this use to take the payment. |
| Keen Defenses | HF p.11 | reaction when targeted, 1 Focus, `+tier` Evasion against that attack (fold) |
| Focus Cannon | HF p.11 | action, 1 Focus, Instinct Roll against an enemy within Far, on a hit `Proficiency d20 + 3` magic |
| Flow State | HF p.11 | passive marker; it is an upgrade on Combo Strike and Stance Fighter |

Why the `cost` choice: Flow State changes what Combo Strike and a stance shift cost. An `UpgradePatch` can't change a use's
`costs`, so these two uses pay with a `pay` step inside a `choose` step, and Flow State adds the other payment as an extra
option. A `pay` step that can't be paid stops its option, so nothing runs. The cost badge (`featureCostShort`) can't see
these costs, because they are not upfront.

## Manual steps and gaps (beads labelled `feature-effects vocabulary-gap`)

- **Stance shift** (dcm-awh): no step sets `classState.martial.active`. The use shows a manual step, and SD3's
  `shiftStance` does the shift.
- **Blight Seed "can't stack"** (dcm-kkx): no field stops an effect from stacking. The words are in the step's note.
- **Surrounded's Melee weapon** (dcm-wut): no requirement can read the weapon's range before the roll. The player
  confirms it with a check box.
- **Twin Fang's "second" poison** (dcm-40m): two `choose` steps can't be kept distinct. The dialog must keep the first
  pick out of the second list.
- **Marked for Death ends on defeat or when the GM spends Fear** (dcm-8bv): no end event exists for either. The duration
  is rest plus the `endsWhen` text, and the GM ends it by hand.
- **Fear Leaf** (existing dcm-d1b, comment added): no number source reads the host roll's Fear Die. The `poison` use has a
  dialog number `fearDie` (0-12), as CE-midnight's Midnight-Touched does.

## Open rulings (no mechanic decided here)

1. **First Strike and added dice.** The book (HF p.8) says "you deal double damage". Does that double the dice other
   features add to the same attack (Marked for Death's d4s, Leech Weed's d6, a combo strike)? The entry doubles the
   attack's damage total when it runs. The order is the player's (CB p.107, Simultaneous Effects).
   - (a) Recommended: double the attack's whole damage, added dice included.
   - (b) Double only the attack's own damage roll.
2. **Surrounded: which "additional creatures"?** The book (HF p.10) says "target an equal number of additional creatures
   within Melee range". The entry allows any creature except yourself (`side: "any"`).
   - (a) As written: any creatures, allies included.
   - (b) Adversaries only.

## Tests

`tests/unit/feature-effects/assassin-brawler.test.ts` (40 tests):

- **Table:** exactly the 25 classified ids, none extra and none missing (the 16 stances are FE-stances'); source, owner and
  card match the data; passive features have only passive uses; upgrades and D5 keys exist.
- **Assassin:** Deadly Determination (and times 2). Marked for Death: the tag, `exclusive`, D5's sheet effect, a D5
  refusal, tier 2d4 = 7 on the tagged target only, tier 4, Ambush d6 and Backstab d8 from `owned()` / `holdingsFor`,
  Poisoners Guild keeps d4.
- **Executioners Guild:** First Strike's scene limit and "Back after the scene"; Death Strike; Scorpion's Poise; True
  Strike's long-rest limit.
- **Poisoners Guild:** Toxic Concoctions brew 1d4+1, each base poison, no token refused; the lists at each rank (3 / 5 /
  8); each extra poison; Twin Fang on a tagged and an untagged target and without the feature; the long-rest clear.
- **Upgrade-only markers:** each one points at its upgrade.
- **Brawler:** Square Up; I Am the Weapon (D5 override, +1 Evasion); Combo Strike through D5 (2, 3, 1 → +6, total 14), a
  refusal without the damage roll, full Stress, Flow State's Focus option.
- **Juggernaut:** Rugged; Overwhelm both options; Surrounded's Hope count, cost and check box; Eye for an Eye; Pummeljoy;
  Not Done Yet.
- **Martial Artist:** Stance Fighter's Focus, Flow State's Stress, unpaid; Keen Defenses' tier 3 Evasion and refusal;
  Focus Cannon hit (13 against 12, 2d20+3 = 18 magic, Severe, 3 HP), miss, no Focus.

## Checks

See the commit's tracer report: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run --maxWorkers=2 --testTimeout=60000`,
`pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-assassin-brawler`.
