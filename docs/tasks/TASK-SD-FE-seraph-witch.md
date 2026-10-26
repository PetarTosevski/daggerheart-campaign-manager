# TASK SD FE-seraph-witch: Feature effects of Seraph and Witch

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-seraph-witch (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status:
Review.

The Seraph and Witch effect table (`src/lib/srd/feature-effects/seraph-witch.ts`) has one entry for each of the 20
features that the classification marks combat or passive. Commune and Walk Between Worlds are out of combat and have no
entry. Every entry quotes its feature with the printed page (CB = Core Book p.44-45, HF = Hope & Fear p.16-17). Entries
use only the SD0 vocabulary; nothing in the vocabulary or the runner changed. Each gap is a `manual` step, a player-confirmed
situation or an engine note, and it has a bead (below).

## User answers implemented

- **Q1 (a)**: Prayer Dice "add to a roll's result after the roll is made" and Witch's Charm are reactions on
  `afterAllyRolls` (with `includeSelf`). They run in the after-roll step on the player's own roll and in the after-roll
  window on an ally's roll.
- **Q2 / Q13-Q17 window**: Prayer Dice against incoming damage and Enchanted Talisman are reactions on
  `whenAllyWouldTakeDamage` (CB p.107, "Incoming damage").
- **Q3 (a)**: limits use `rest` / `longRest` / `session` (Sparing Touch, Enchanted Talisman, Circle of Power, Moonbeam,
  the Lunar Phases bump).
- **Q4 (a)**: "on a success" (Night's Glamour) is gated on the roll's success. The use has no limit.
- **Q6 (a)**: no halving here.
- **Q7 (a)**: Moonbeam's area lasts `scene`.
- **Q13 (a)**: situations the engine can't read are player-confirmed check boxes (Spirit Weapon's weapon, Sacred
  Resonance, carrying a creature your size, the illusory appearance, the New moon phase).
- **Q14 (a)**: Circle of Power and Moonbeam draw live `area` steps.
- **Q16 (a)**: "While flying" is the `flying` state check (the drawer's Flying toggle, SD3 `setFlying`). It is used by
  Wings of Light (both options) and Ethereal Visage's advantage.

## The entries

| Feature (page) | Uses | Reading |
|---|---|---|
| Life Support `hope:seraph` (CB p.44) | `main` action | 3 Hope; an ally within Close (not you) clears 1 HP. D5's `lifeSupport` keeps no state, so the use is a plain `clear`. |
| Prayer Dice `class:seraph:prayer-dice` (CB p.44) | `damage` reaction, `roll` reaction, `hope` action | Each use spends the number of Prayer Dice the player picks (choice `dice`, NV1 pool `prayer`) and reads their stored total (`spent: heldDie`). `damage`: `reduceDamage` on the trigger's subject (you or an ally within Far). `roll`: `modifyRoll add` on the subject's roll. `hope`: Hope equal to the total for you or an ally within Far. D5 still rolls the dice at session start and clears them at session end. |
| Spirit Weapon `subclass:divine-wielder:spirit-weapon` (CB p.44) | `reach` passive, `extra-target` rider | `reach`: `meleeWeaponRange` set to Close (2). `extra-target`: before the weapon attack roll, mark a Stress to add one adversary within Close to the same roll (`addTargets`, same damage). The player confirms that it is a Spirit Weapon attack. |
| Sparing Touch `subclass:divine-wielder:sparing-touch` (CB p.44) | `main` action | Once per long rest: touch a creature (Melee, any side) and clear 2 HP or 2 Stress (choose `clear`). Upgrade: Devout makes it twice (`limitTimes: 2`). |
| Devout `subclass:divine-wielder:devout` (CB p.44) | `main` passive (no mods) | Its Sparing Touch part is the upgrade above. The extra Prayer Die is D5's session-start roll (SD8 acceptance). |
| Sacred Resonance `subclass:divine-wielder:sacred-resonance` (CB p.44) | `main` rider on a successful weapon attack | Matching damage dice are doubled (`doubleDice matching`). The player confirms that the damage is for the Spirit Weapon (question 1). |
| Wings of Light `subclass:winged-sentinel:wings-of-light` (CB p.45) | `carry` action, `strike` rider | Both need flying. `carry`: mark a Stress, then a manual step to carry a willing creature in Melee that is your size or smaller (the player confirms the size). `strike`: on a successful attack, spend a Hope for +1d8 damage. Upgrade: Power of the Gods makes it 1d12 (`dieSides: 12`). |
| Ethereal Visage `subclass:winged-sentinel:ethereal-visage` (CB p.45) | `presence` passive, `fear` reaction | `presence`: advantage on Presence Rolls while flying. `fear`: after your Presence Roll with Hope, remove a Fear instead of gaining the Hope (`replaceHopeGain removeFear`, folded into that roll). The second sentence is not limited to flying in the text. |
| Ascendant `subclass:winged-sentinel:ascendant` (CB p.45) | `main` passive | +4 Severe threshold. Today `derived.ts` applies it; SD2 swaps that for this entry. |
| Power of the Gods `subclass:winged-sentinel:power-of-the-gods` (CB p.45) | `main` passive (no mods) | The upgrade on Wings of Light's `strike`. |
| Witch's Charm `hope:witch` (HF p.16) | `main` reaction | When you or an ally within Far fails an action roll: 3 Hope, and the roll becomes a success with Fear (`setOutcome successWithFear`). When SD5 folds it into a roll made with Hope, the Hope that roll gave is taken back and the GM gains a Fear, as D5's `witchsCharm` does today. |
| Hex `class:witch:hex` (HF p.16) | `main` action | Mark a Stress; one enemy within Far. The steps: delegate to D5 `hex` (D5 keeps `classState.hexes` and clears it at rest and session end); tag `Hexed` (temporary); an effect `Hexed` with Difficulty and damage minus the tier (`byTier` −1/−2/−3/−4). `holdLimit` is the Spellcast trait. D5 refuses a Hex past that number (question 2). |
| Herbal Remedies `subclass:hedge:herbal-remedies` (HF p.16) | `main` passive | `consumableClear` +1. Consumables are used on the sheet, not on the map, and "an ally in the scene" is for the consumable flow to read. |
| Enchanted Talisman `subclass:hedge:enchanted-talisman` (HF p.16) | `imbue` action, `protect` reaction, `rest` auto | `imbue`: once per rest, spend the Hope the player picks, set that many tokens, and tag the holder (you or an ally in Melee) `Enchanted Talisman` until the rest. `protect`: when the holder would take damage (any distance; `veryFar` is the widest range the trigger takes), spend a token so they mark 1 fewer HP (`adjustHpMarked`). `rest`: clear the tokens after any rest. |
| Vexing Malison `subclass:hedge:vexing-malison` (HF p.16) | `main` passive | Advantage on attacks against Hexed creatures (`versus hexed`, NV9). |
| Circle of Power `subclass:hedge:circle-of-power` (HF p.16) | `main` action, `roll` auto, `evade` auto | `main`: once per rest, set tokens equal to your Spellcast trait and draw a Very Close area for you and your allies with +2 Major and Severe thresholds, +2 attack and +2 Evasion. The circle is "marked on the ground" and "you exit the circle" ends it, so its centre is a square (the witch's own square when drawn), not her token. `roll` / `evade`: spend a token when someone in the circle makes an action roll or evades an attack. SD-A fires these only for creatures inside the circle and ends the area on the last token or when the witch leaves (bead). |
| Night's Glamour `subclass:moon:nights-glamour` (HF p.17) | `main` action, `appearance` passive, `maintain-hp` / `maintain-damage` reactions | `main`: Spellcast Roll (13). On a success you gain the effect `Glamoured`: adversaries within Close must mark a Stress to attack you (`attackersMarkStress`). It ends when you mark a Hit Point or deal damage (`endsOn`). `appearance`: advantage on a roll the player confirms leverages the illusory appearance, while Glamoured. `maintain-*`: mark a Stress to keep the Glamour (a manual step; bead). |
| Moonbeam `subclass:moon:moonbeam` (HF p.17) | `main` action | Once per session: a Close area for you and your allies until the end of the scene, +1 to Spellcast Rolls. "Can see through illusions" is a note. It is centred on the witch (question 3). |
| Ire of Pale Light `subclass:moon:ire-of-pale-light` (HF p.17) | `main` auto | When a Hexed creature within Very Far fails an attack (`whenEnemyFailsAttack`, source `hexed`), it marks a Stress. |
| Lunar Phases `subclass:moon:lunar-phases` (HF p.17) | `phases` passive (no mods), `new` reaction, `bump` action | Waxing, Full and Waning stay with the session features (`lunarBonuses` in derived.ts and hooks.ts), so there is no double count. `new`: when you would take Minor damage, spend a Hope to negate it (the player confirms the die shows 1). `bump`: once per rest, spend a Hope; a manual step raises the moon die by one (bead). |

## Manual steps, engine notes and beads (vocabulary unchanged)

| Feature | What is not automated | Bead |
|---|---|---|
| Prayer Dice | The player can't pick which Prayer Dice to spend: the pool cost spends the first N. SD3 and SD4 must put the picked dice first in `actor.heldDice`. | dcm-qbn |
| Ethereal Visage | `afterYouRoll` has no "success with Hope" result. `withHope` also matches a failure with Hope, so SD5 must offer the use only on a success with Hope (a critical counts). | dcm-nhr |
| Circle of Power | No check that the trigger's subject is inside an area. The area doesn't end on its last token or when the caster leaves. | dcm-ii4 |
| Night's Glamour | Paying to "maintain" can't cancel an `endsOn` end; the maintain steps are manual. | dcm-4qv |
| Lunar Phases | No step changes the moon die, so the bump is manual. Its limit key `feat:subclass:moon:lunar-phases:bump` differs from D5's `lunarPhasesBump`. New's phase is a player-confirmed situation. | dcm-lk8 |
| Enchanted Talisman | No unlimited trigger range (`veryFar` is used). "Holding the talisman" is a condition tag on the holder. | dcm-3i4 |
| Spirit Weapon, Sacred Resonance | No check for the equipped weapon's range, and an attack made with the Spirit Weapon can't be told apart from other attacks (cf. dcm-bn1). Both are player-confirmed. | dcm-13s |
| Hex | D5 names the Hex "Target N", not the map instance, so the `hexed` key (Vexing Malison, Ire of Pale Light) can't find the instance. SD3 should Hex by the instance. | dcm-53f |
| Wings of Light (carry) | Carrying is a manual step: the player moves the carried token. | (movement prompt, Q9) |
| Witch's Charm | The success-with-Fear fold must take back the roll's Hope and give the GM a Fear (as D5 does). | (SD5 fold, no gap) |

## Open rulings (multiple choice; the entries follow the text literally until answered)

1. **Which attacks are Spirit Weapon attacks (for its extra target and for Sacred Resonance)?** CB p.44, Spirit Weapon:
   "When you have an equipped weapon with a range of Melee or Very Close, it can fly from your hand to attack an
   adversary within Close range and then return to you. You can mark a Stress to target an additional adversary within
   range with the same attack roll." Sacred Resonance: "When you roll damage for your 'Spirit Weapon' feature, if any of
   the die results match, double the value of each matching die."
   - (a) Every attack with an equipped Melee or Very Close weapon is a Spirit Weapon attack: the extra target and
     Sacred Resonance always apply (no check box).
   - (b) Only an attack where the weapon flies (a target beyond the weapon's own range, up to Close) is a Spirit Weapon
     attack.
   - (c) The player confirms it on each attack (the entries' current behaviour, Q13).
2. **Hex at the maximum.** HF p.16: "The maximum number of creatures you can Hex at one time is equal to your Spellcast
   trait."
   - (a) A new Hex at the maximum is refused (D5 today, and the entry as written).
   - (b) A new Hex ends your oldest Hex (the vocabulary's `holdLimit` reading).
   - (c) The player picks which Hex to end.
3. **Does Moonbeam's column follow the witch?** HF p.17: "you can conjure a column of moonlight that illuminates the area
   within Close range until the end of the scene. While bathed in this moonlight, you and your allies gain a +1 bonus to
   Spellcast Rolls".
   - (a) It stays where it was conjured: a Close area around the square the witch stood on.
   - (b) It follows the witch: Close of her token (the entry as written).
4. **Prayer Dice on damage and reaction rolls.** CB p.44: "You can use a spent die's value to reduce incoming damage, add
   to a roll's result after the roll is made, or gain Hope equal to the result."
   - (a) Action rolls only (the entry as written: the `afterAllyRolls` trigger).
   - (b) Any roll of yours or an ally's: action, reaction and damage rolls.
   - (c) Action and reaction rolls, but not damage.
5. **Enchanted Talisman, tokens per hit.** HF p.16: "When the person holding the talisman takes damage, spend a token to
   reduce the number of Hit Points they mark by one."
   - (a) One token per damage, one fewer Hit Point (the entry as written).
   - (b) Any number of tokens on the same damage, one fewer Hit Point each.

## Tests

`tests/unit/feature-effects/seraph-witch.test.ts` has 37 tests through `runFeature`, with fixed dice:
- Coverage: exactly the 20 combat or passive Seraph and Witch ids, none missing and none extra; the two out-of-combat
  features are absent; the source, owner and card match the id and `SUBCLASSES`; the registry serves each entry; use ids
  are unique; passive uses have no steps.
- Life Support: the ally clears 1 HP for 3 Hope, and the use is refused with 2 Hope.
- Prayer Dice: two dice of 3 and 2 reduce incoming damage by 5 in the window; one die adds 3 to a roll; Hope 5 to an ally
  and +3 to yourself; refused when short of dice.
- Spirit Weapon: the reach mod, and a Stress for one more adversary within Close.
- Sparing Touch: 2 HP or 2 Stress, the long-rest key, exhausted after one use, twice with Devout.
- Sacred Resonance: the matching-dice fold, refused without the confirmation.
- Wings of Light: +1d8 for a Hope while flying (6); refused when not flying; 1d12 with Power of the Gods (an 11, which a
  d8 can't roll); carrying for a Stress.
- Ethereal Visage, Ascendant: advantage while flying, the Fear fold, +4 Severe.
- Witch's Charm: 3 Hope, the success-with-Fear fold on the subject, refused with 2 Hope.
- Hex: through D5 with the sheet, the Stress, `classState.hexes`, the `Hexed` tag, −2 at tier 2, `holdLimit` 2; D5
  refuses past the maximum; −4 at tier 4; the step is left undone without a sheet.
- Herbal Remedies, Vexing Malison: the mods.
- Enchanted Talisman: 2 Hope become 2 tokens and tag the holder; 1 fewer HP for a token; refused for a non-holder and with
  no tokens; tokens cleared at rest.
- Circle of Power: tokens = Spellcast 3, the area and its mods, the rest limit, a token per roll and per evade.
- Night's Glamour: success (16 against 13) and failure; maintain for a Stress; the appearance advantage needs the Glamour.
- Moonbeam, Ire of Pale Light, Lunar Phases: the scene area and the session limit; Stress on the attacker; New's negate,
  the bump's rest limit and manual step, no phase mods.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 301 files, 7924 passed, 1 expected fail. The single failure is
  `tests/unit/feature-classification.test.ts` asserting that the tables are empty (`FEATURE_EFFECTS.size` is 0). That is
  SD0's placeholder assertion, which `rebuild` has already replaced with "entries are classified".
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-seraph-witch`: OK.
