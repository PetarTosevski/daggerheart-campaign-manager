# TASK SD FE-beastforms: Beastform effect table (plan sheet-drawer, bead dcm-bxp.99.19)

User answer **Q10 (a)**: full Beastform. The form's attack replaces the weapon, weapons and domain spells are blocked,
the form's Evasion and trait bonus apply, its features are automated, and the druid drops out on the last Hit Point (and
on Major or greater damage for Fragile forms).

## Files

| File | What |
|---|---|
| `src/lib/srd/feature-effects/beastforms.ts` | `BEASTFORM_EFFECTS` (61 entries: 24 attack entries, 37 feature entries), `BEASTFORM_STATS`, `EVOLVED_FORMS`, `evolvedBases`, `HYBRID_EXTRA_STRESS`, `FRAGILE_FORMS`, `beastformEndsOn`, `BEASTFORM_IDS`. |
| `tests/unit/feature-effects/beastforms.test.ts` | 39 tests: coverage (a missing or extra id fails), statistics against `src/lib/srd/beastforms.ts`, every use run through `runFeature`, one test per feature with numbers worked out from the book, ownership. |

## Book rules (printed pages, CB = Core Book)

- CB p.30, Beastform: "While transformed, you can't use weapons or cast spells from domain cards … you gain the
  Beastform's features, add their Evasion bonus to your Evasion, and use the trait specified in their statistics for your
  attack. … If you mark your last Hit Point, you automatically drop out of this form."
- CB p.32, Beastform Options: "When you make an attack while transformed, you use the creature's listed range, trait, and
  damage dice, but you use your Proficiency." Advantages: "When you make an action or reaction roll related to one of the
  verbs listed for that creature category, you gain advantage on that roll."
- CB p.96: "If you succeed, make a damage roll to determine how much damage the target takes." So Takedown and Venomous
  Strike ("make an attack") deal the form's damage on a success.
- Forms: Tier 1 CB p.32, Tier 2 p.33, Tier 3 p.34, Tier 4 p.35. The data in `src/lib/srd/beastforms.ts` matches the book
  (a test checks every trait, bonus, Evasion, range, damage and advantage list).

## Shape of the table

- `beastform:<form>:attack`:
  - `main`: action, a roll of the form's trait against each target's Difficulty, the form's range, damage dice x
    Proficiency (+ the printed bonus), physical.
  - `form`: passive, trait +N, Evasion +N, flag `noWeaponsOrSpells`, and `advantage on attack` when "attack" is one of
    the form's verbs.
  - `advantage`: rider before any roll, the player confirms "The roll is related to one of these: …" (Q13).
  - Legendary Beast and Mythic Beast print no statistics: their attack entry has one use per base form (use id = the base
    form id) with the Evolved damage (+6, or +9 and the die one size up).
- One entry per feature classified combat or passive; the 8 narrative ones (Aquatic x2, Carrier x5, Massive Stride) have
  none.
- Every use requires `inBeastform` (no `formId`): `owned()` already scopes which form's features are held, and Evolved and
  Hybrid forms hold other forms' features.

## Entries

| Feature | Reading |
|---|---|
| Attack (24) | trait roll, damage dice x Proficiency; Evolved per base form |
| Fragile (4) | two `auto` uses on `whenYouTakeDamage` severity major and severe; feed prompt; drop-out via `beastformEndsOn` |
| Agile, Fleet | 1 Hope, move prompt up to Far |
| Companion | `set helpDie 8` (Q12) |
| Elusive Prey | reaction `whenAttacked succeeded`, 1 Stress, +d4 Evasion fold |
| Hobbling Strike | rider on a Melee success, 1 Stress, temporarily Vulnerable |
| Pack Hunting | rider on a success, player confirms the ally acted just before, +d8 damage |
| Venomous Bite | auto on a Melee success, Poisoned tag (temporary) + prompt for the per-act damage |
| Webslinger | Finesse roll vs a target within Close, temporarily Restrained |
| Armored Shell | passive physical resistance; `retract` (1 Armor Slot, effect option `retracted`, `cannotAct`); `shell` auto on physical damage while retracted (manual reduction) |
| Cannonball | 1 Stress, picked ally, manual throw; optional 1 Hope second target (manual) |
| Trample | 1 Stress, Agility vs all along a Close path, d8+1 x Proficiency, temporarily Vulnerable |
| Takedown | 1 Stress, move prompt, Instinct attack, d8+6 with Proficiency +2, target marks a Stress |
| Rampage | rider: each damage 1 adds a d10; rider before an attack roll: 1 Stress, +1 Proficiency |
| Thick Hide / Physical Defense / Undaunted / Hollow Bones | thresholds +2 / +3 / +2 / -2 |
| Venomous Strike | Finesse vs any targets within Very Close, d8+4 x Proficiency, Poisoned |
| Warning Hiss | 1 Stress, any targets within Melee knocked back to Very Close (prompt) |
| Bird's-Eye View | passive (fly at will: the drawer's Flying toggle, Q16); `question` once per rest while flying (manual) |
| Vicious Maul | rider on a success, 1 Hope, Vulnerable (Great Predator temporary; Aquatic Predator see Q-FB2), +1 Proficiency |
| Evolved | passive per base form: trait +1 / +2, Evasion +2 / +3 (damage is in the attack entry) |
| Hybrid Features | passive marker; `HYBRID_EXTRA_STRESS` for the transformation |
| Snapping Strike | rider on a Melee success, 1 Hope, temporarily Restrained and Vulnerable |
| Ocean Master | rider on a Melee success, temporarily Restrained |
| Unyielding | auto when you mark an Armor Slot: d6, on 5+ clear that slot (the reduction stands without the slot) |
| Demolish | 1 Hope, Strength vs all along a Far path, d8+10 x Proficiency, temporarily Vulnerable |
| Deadly Raptor | passive (fly, move Far); rider after the charge (player confirms): reroll damage dice below Proficiency |
| Devastating Strikes | rider on `whenTargetMarksHp` Severe, player confirms Melee, 1 Stress, target marks 1 more HP |

"Against a target within Melee range" riders use `whenYouAttack { weaponRange: "melee" }`: the form's attack range is
its weapon range.

## Manual steps and beads

| Manual step | Bead |
|---|---|
| Poisoned: 1d10 direct physical damage each time the creature acts (Venomous Bite, Venomous Strike) | dcm-bxp.99.19.3 |
| Armored Shell in the shell: reduce physical damage by the Armor Score | dcm-bxp.99.19.4 |
| Cannonball: the ally's throw roll, damage and the half-damage second target | dcm-bxp.99.19.5 |
| Fragile drop-out shown as a feed prompt; the effect ends through `beastformEndsOn` | dcm-bxp.99.19.6 |
| Bird's-Eye View question to the GM | text by nature, no bead |

Integration (dcm-bxp.99.19.6, no wave-3 tracer owns it): the Beastform sheet effect carries `beastformEndsOn`; D5's
`beastform` effect already adds the form's trait and Evasion, which duplicates the `form` use (Q-FB1); Evolved forms need
the base form's entries held; Hybrid forms need `HYBRID_EXTRA_STRESS` charged and their chosen features held; SD5 must
treat the form attack's trait roll as an attack roll (`rollMatches("attack")` is false for a `trait` roll, so Rampage's
"before you make an attack roll" rider is not offered yet).

## Questions for the user

**Q-FB1. Form statistics: one source.** D5's Beastform (`classes/druid.ts`) already puts the form's Evasion and trait
bonus on its sheet effect; the table's `form` use carries them too (CB p.30: "add their Evasion bonus to your Evasion").
- (a) Recommended: the table is the source; the integrator drops D5's mods when it reads the table.
- (b) Keep D5's mods; the engine skips the `form` use's trait and Evasion mods.

**Q-FB2. Aquatic Predator's Vicious Maul, CB p.34:** "you can spend a Hope to make them Vulnerable" (Great Predator's
reads "temporarily Vulnerable"). Implemented literally: Vulnerable with no printed end, cleared by the GM.
- (a) Keep the literal reading.
- (b) Treat it as temporary, like Great Predator's.
- (c) Until the end of the scene.

**Q-FB3. Cannonball, CB p.33:** "the ally makes an attack roll using Agility or Strength (their choice) against a target
within Close range. On a success, the adversary takes d12+2 physical damage using the thrower's Proficiency."
Implemented: the druid pays the Stress (and the Hope), the throw is a manual prompt.
- (a) The druid's use opens a throw prompt for the ally, who rolls from their own drawer with their trait and Proficiency.
- (b) The druid enters the ally's roll result and Proficiency.
- (c) Keep it manual.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm vitest run --maxWorkers=2 --testTimeout=60000`,
`pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-beastforms`.
