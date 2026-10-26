# TASK CA CE-sage: Card effects, Sage

Plan `.omc/plans/combat-actions.yaml`, tracer CE-sage (wave 3). Book pages are printed pages; CB = Core Book (Sage cards:
Level 1-5 on p.338, Level 5 Wild Fortress to Level 10 on p.339). Implements **U3** ("Automate EVERY domain card usable in
combat") for the Sage domain, with **Q3/Q4** (once-per limits; "on a success" limits are used up only by a success) and
**Q9** (movement as a prompt, temporary conditions on the tracker, choices in a dialog, leftovers as a manual step with
the card text).

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/sage.ts` | `SAGE_EFFECTS`: 18 entries (every Sage card classified combat or passive; Gifted Tracker, Nature's Tongue and Forager are out of combat), **38 uses**. Each entry quotes its card text. |
| `tests/unit/card-effects/sage.test.ts` | 61 tests: the table matches the classification (no missing, extra or duplicate id), every use runs through `run()`, and one or more fixed-dice tests per use checking costs, limit, roll, targets and outcomes against the text. |

No vocabulary change. 19 `manual` steps (narrative leftovers and the gaps below), 6 new vocabulary-gap beads, 3 existing
beads extended with Sage cases.

## Readings used throughout

- **Roll Difficulty.** "Make a Spellcast Roll against a target" = the target's Difficulty (`hit` gate); "Spellcast Roll (13)"
  = fixed (`success` gate); a command with no number (Natural Familiar) = `gm`. CB p.96: "If a Spellcast Roll can damage a
  target, it's also considered an attack roll", so a critical adds the dice's maximum (CB p.98).
- **"temporarily"** = `temporary` (CB p.102, "Temporary Effects … can be ended in the same way as temporary conditions").
  Tempest's "until the GM spends a Fear on their turn to end this spell" is a tag with duration `manual` and that text.
- **Limits.** "Once per rest on a success" (Rejuvenation Barrier) and "Once per long rest on a success" (Plant Dominion) use
  `consumedOn: success` (Q4). "Once per rest, spend a Hope …" (Thorn Skin), "Once per long rest, mark a Stress …" (Wild
  Surge) and "Once per long rest, you can conjure …" (Healing Field) limit the use itself. Towering Stalk's limit covers only
  the stalk (key `card:towering-stalk:stalk`); Sage-Touched's only the trait doubling (`card:sage-touched:double`).
- **"Spend a Hope to deal …" after the roll** (Fire Flies) is a `pay` step on success, as Bolt Beacon in CA0: the roll's own
  Hope may pay (CB p.90, R8), and an unpaid Hope deals nothing.
- **Tokens as counters.** Card tokens stand for Thorn Skin's thorns, Forest Sprites' sprites, Wild Fortress's marked Hit
  Points, Fane of the Wilds' tokens, and the Wild Surge Die's face (die 6).
- **Two `check` patterns.** A check that always passes rolls dice once for everyone (Rejuvenation Barrier's 1d4, then
  `lastRoll`); a check with zero dice and a number as its modifier compares that number with a threshold (Wild Fortress's
  15/30 and 3 HP, the Wild Surge Die past 6). The second stands in for a numeric gate (bead dcm-7n7).
- **Persistent parts** get their own uses behind `effectActive` (the card's own sheet effect): the beetles' damage, the
  familiar's command / sight / +d6, the thorns, the dome's damage, the surge per roll, the sprites' benefits, Force of
  Nature's +10 / absorb / upkeep. Riders that depend on what the engine can't see use a `situation` the player confirms.
- **Riders and autos.** Optional add-ons are `rider`s (Natural Familiar's +d6, Sage-Touched, Fane spend); mandatory ones
  are `auto` (Wild Surge per roll, Force of Nature's +10, absorb and upkeep, Fane's critical token, rest clean-up).

## Every card

| Lv | Card (page) | Use id | Reading | Manual step (why) |
|---:|-------------|--------|---------|-------------------|
| 1 | Vicious Entangle (p.338) | `main` | Spellcast vs target, enemy Far; hit: `1d8+1` physical (no Proficiency) + Restrained (temporary); optional `second`: 1 Hope, Restrain one adversary within Very Close of the target (`picked`) | — |
| 2 | Conjure Swarm (p.338) | `beetles` | 1 Stress; self effect "Tekaira Armored Beetles" (manual duration); exclusive | — (duration gap dcm-utu) |
| | | `beetles-damage` | Reaction when you would take damage, needs the beetles; reduce severity by one (fold); optional `keep`: 1 Hope | "the beetles disperse" / "stay conjured" (ending a card's own effect, dcm-8x8) |
| | | `fire-flies` | Spellcast vs target, all enemies within Close; on success pay 1 Hope, then `2d8+3` magic to each hit (rolled once, R9) | — |
| 2 | Natural Familiar (p.338) | `main` | 1 Hope; self effect "Natural Familiar" until rest (ends early when the familiar is targeted); optional `flies`: 1 more Hope; exclusive | the critter itself and "can fly" (summons are manual by design, CA0) |
| | | `command` | Needs the familiar; Spellcast vs GM Difficulty | the task performed (GM) |
| | | `see` | Needs the familiar; 1 Stress | seeing through its eyes (narrative) |
| | | `damage` | Rider when you deal damage to an enemy; needs the familiar and the confirmed situation "within Melee range of your familiar"; +1d6 damage (fold) | — |
| 3 | Corrosive Projectile (p.338) | `main` | Spellcast vs target, enemy Far; hit: `{Prof}d6+4` magic; optional `corrode` on a hit: mark the chosen Stress (min 2), tag **Corroded** + effect Difficulty −⌊Stress/2⌋, both permanent; stacks (not exclusive) | — |
| 3 | Towering Stalk (p.338) | `stalk` | Once per rest; a point within Close | the stalk (map terrain is not modelled) |
| | | `attack` | 1 Stress; Spellcast vs target, any number of enemies within Close; `{Prof}d8` physical to each hit | — |
| 4 | Death Grip (p.338) | `main` | Spellcast vs target, enemy Close; `choose` (before the roll): `pull` (move prompt), `constrict` (2 Stress), `vines` (adversaries `between` you and the target save 13 or take `3d6+2` physical); then Restrained (temporary); all on a hit | — |
| 4 | Healing Field (p.338) | `main` | Once per long rest; you and allies within Close clear 1 HP; optional `two`: 2 Hope, clear 2 instead | — |
| 5 | Thorn Skin (p.338) | `main` | Once per rest; 1 Hope; tokens = Spellcast; self effect until rest | — |
| | | `thorns` | Reaction when you would take damage, needs Thorn Skin; spend chosen tokens; reduce damage by that many d6 (fold); with the confirmed situation "within Melee range of the attacker", the attacker takes the same amount (flat, physical) | — |
| | | `rest` | Auto after a rest: clear tokens | — |
| 5 | Wild Fortress (p.339) | `main` | Spellcast (13); on success pay 2 Hope; tokens to 0; you and up to one ally within Very Close get "Inside Wild Fortress" (can't be targeted, can't attack); exclusive | — (dome gap dcm-cj8) |
| | | `dome-damage` | Needs the dome; the damage dealt to it is entered; marks 1/2/3 HP (tokens) at 1+/15+/30+; at 3 tokens it falls | "the dome falls: end Wild Fortress" (dcm-8x8, dcm-cj8) |
| 6 | Conjured Steeds (p.339) | `main` | Choose Hope ≥ 1, pay it; riders = you and allies within Close, at most one per steed; effect attack −2, damage +2 until long rest (ends early when the steed takes damage) | travel speed and "move within Far without rolling" (no map rule); duration gap dcm-utu |
| 7 | Sage-Touched (p.339) | `nature` | Needs 4 Sage cards and the confirmed situation "natural environment"; rider before a Spellcast Roll: +2 (fold) | — |
| | | `double` | Needs 4 Sage cards; once per rest; rider before a roll; choose Agility or Instinct: `doubleTrait` (fold) | — |
| 7 | Wild Surge (p.339) | `main` | Once per long rest; 1 Stress; Wild Surge Die (tokens, die 6) at 1; self effect | "describe how your appearance changes" (narrative) |
| | | `surge` | Auto before each action roll while active: add the die (fold), die +1; past 6: die cleared, mark 1 Stress | "the form drops" (dcm-8x8) |
| | | `rest` | Auto after a rest while active: die cleared, mark 1 Stress | "the form drops" (dcm-8x8) |
| 8 | Forest Sprites (p.339) | `main` | Spellcast (13); on success pay the chosen Hope; tokens = Hope spent (one per sprite); points within Far; exclusive | placing the sprites (no map objects) |
| | | `attack` | Reaction after an ally's roll; needs the sprites and the confirmed situation "attack against an adversary within Melee of a sprite"; +3 to the ally's roll (fold); a sprite vanishes (token) | — (roll filter gap dcm-g6t) |
| | | `armor` | Reaction when an ally marks an Armor Slot near a sprite (confirmed); one extra Armor Slot (fold); a sprite vanishes | — |
| | | `sprite-damaged` | Needs the sprites; a sprite vanishes | — |
| 8 | Rejuvenation Barrier (p.339) | `main` | Spellcast (15); once per rest on a success; 1d4 rolled once, you and allies within Very Close clear that many HP; effect physical resistance (temporary) on the same creatures | "only from outside the barrier; it follows you" (gap dcm-nt4) |
| 9 | Fane of the Wilds (p.339) | `spend` | Rider after a Spellcast Roll; spend chosen tokens, +1 each (fold) | — |
| | | `long-rest` | Auto after a long rest: tokens = Sage cards in loadout and vault (replaces the unspent ones) | — |
| | | `critical` | Auto after a critical Spellcast Roll, confirmed "for a Sage domain spell": +1 token | — (domain filter gap dcm-z1a) |
| 9 | Plant Dominion (p.339) | `main` | Spellcast (18); once per long rest on a success | the reshaped plants (narrative / map) |
| 10 | Force of Nature (p.339) | `main` | 1 Stress; self effect "Force of Nature" (can't be Restrained); clears Restrained | — |
| | | `damage` | Auto on a successful attack while transformed: +10 damage (fold) | — |
| | | `absorb` | Auto when you defeat an enemy within Close while transformed: clear an Armor Slot | "you absorb them" (narrative) |
| | | `upkeep` | Auto before each action roll while transformed: pay 1 Hope; at 0 Hope a manual step | "revert to your normal form" (dcm-8x8) |
| 10 | Tempest (p.339) | `main` | `choose` the tempest (before the roll); Spellcast vs target, all enemies within Far; per hit: Blizzard `2d20+8` magic + Vulnerable (temporary); Hurricane `3d10+10` magic + tag **Hurricane**; Sandstorm `5d6+9` magic + tag **Sandstorm**; tags last until the GM spends a Fear | Hurricane's wind (dcm-3oe); Sandstorm's disadvantage (dcm-4dc) |

Not in the table (out of combat, CA0): **Gifted Tracker** (L1), **Nature's Tongue** (L1), **Forager** (L6).

## Vocabulary gaps (beads)

| Bead | Gap | Cards |
|------|-----|-------|
| dcm-z1a (new) | No trigger filter on the domain of the card being cast | Fane of the Wilds |
| dcm-4dc (new) | No modifier for disadvantage on the bearer's own attacks from beyond Melee | Tempest (Sandstorm) |
| dcm-3oe (new) | No movement restriction modifier | Tempest (Hurricane) |
| dcm-cj8 (new) | No damageable object with its own thresholds and HP | Wild Fortress |
| dcm-nt4 (new) | Resistance limited to damage from outside an area | Rejuvenation Barrier |
| dcm-g6t (new) | `afterAllyRolls` has no roll filter | Forest Sprites |
| dcm-utu (comment) | No duration "until the bearer takes damage / is targeted" | Conjured Steeds, Tekaira Beetles, Natural Familiar |
| dcm-8x8 (comment) | No step that ends a card's own sheet effect | Force of Nature, Wild Surge, Tekaira Beetles, Wild Fortress |
| dcm-7n7 (comment) | No gate on card tokens or a number (zero-dice check used instead) | Wild Surge, Wild Fortress |

## For CA4 / CA5 / AA1

- Pass `useId` for every use other than the first action use (`main`, or `beetles` on Conjure Swarm, `stalk` on Towering
  Stalk, `spend` on Fane of the Wilds).
- **Riders and autos with damage changes** (Natural Familiar `damage`, Force of Nature `damage`) need the attack's targets
  as `targets`, like Codex's Sigil `strike`; the fold carries their ids.
- **Death Grip vines**: pass the adversaries between you and the target as `picked`.
- **Vicious Entangle second**: pass the other adversary as `picked`.
- **Healing Field / Rejuvenation Barrier**: pass the allies in the area as `allies` (the actor is included by `selfAndAllies`).
- **Conjured Steeds**: the riders are `targets`, the actor included when riding.
- **Wild Fortress `dome-damage`**: the GM (or the caster) enters the damage an attack dealt to the dome as choice `damage`.
- **Wild Surge `rest`** reads `effectActive: wild-surge`, so run it before the rest's `expire` clears effects (its effect is
  `manual`, so `expire` won't clear it anyway).
- **Force of Nature `upkeep`**: an unpaid `pay` plus the manual prompt means the form ends; the roll itself goes ahead.

## QUESTIONS

1. **Towering Stalk** (p.338): "Once per rest, you can conjure a thick, twisting stalk … Mark a Stress to use this spell as
   an attack." Read as: only the stalk is once per rest; the attack costs a Stress and can be used any number of times,
   with or without a stalk. Confirm, or should the attack need the stalk / share the once-per-rest?
2. **Corrosive Projectile** (p.338): "On a success, deal d6+4 magic damage … Additionally, mark 2 or more Stress to make
   them permanently Corroded." Read as: Corroded only on a success (a miss marks no Stress). Confirm.
3. **Tempest: Sandstorm** (p.339): "Attacks made from beyond Melee range have disadvantage." Read as the affected targets'
   own attacks from beyond Melee range. Could it mean every attack (by anyone) made from beyond Melee range into the storm?
4. **Tempest** (p.339): "make a Spellcast Roll against all targets within Far range" read as all adversaries (as Earthquake's
   "all targets" in CE-arcana); allies are not hit. Confirm.
5. **Rejuvenation Barrier** (p.339): "clear 1d4 Hit Points" read as one 1d4 roll for everyone. Should each creature roll
   its own 1d4?
6. **Thorn Skin** (p.338): "deal that amount of damage back to them" has no damage type; read as physical (thorns). Should it
   be magic (it is a spell) or typeless?
7. **Wild Fortress** (p.339): "you and one ally" read as one ally within Very Close range (the card gives no range). Confirm
   the range. The dome's damage is entered by hand (attacks against it "automatically succeed").
8. **Conjure Swarm, Tekaira Armored Beetles** (p.338): the severity reduction is a reaction (Use / Pass) because the Hope to
   keep the beetles is a choice. Should the reduction happen by itself (auto) with only the Hope asked?
9. **Fire Flies** (p.338): "Spend a Hope to deal 2d8+3 magic damage to targets you succeeded against" read as a required
   payment after a successful roll (no Hope, no damage), like Bolt Beacon. Confirm.
10. **Natural Familiar** (p.338): the +d6 is offered as a rider (default on) when the player confirms the adversary is within
    Melee range of the familiar; the familiar has no token on the map. Should the familiar be a map token so the server can
    check the range?
11. **Conjured Steeds** (p.339): riders are picked within Close range when the spell is cast, one per steed. Is a later
    mount (an ally who joins the steeds afterwards) needed?
