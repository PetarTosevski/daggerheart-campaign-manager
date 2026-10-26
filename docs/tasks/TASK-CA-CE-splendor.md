# TASK CA CE-splendor: Card effects, Splendor

Plan `.omc/plans/combat-actions.yaml`, tracer CE-splendor. Book pages are printed pages; CB = Core Book (Splendor domain
card reference: Levels 1-7 on CB p.340, Levels 8-10 on CB p.341). Implements **U3** ("Automate EVERY domain card usable in
combat") for the Splendor domain, with **Q3/Q4** (once-per limits; "on a success" limits are used up only by a success) and
**Q9** (movement as a prompt, temporary conditions on the tracker, choices in a dialog, leftovers as a manual step with the
card text).

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/splendor.ts` | `SPLENDOR_EFFECTS`: 20 entries (every Splendor card classified combat or passive; Divination is out of combat), **31 uses**. Each entry quotes its card text. |
| `tests/unit/card-effects/splendor.test.ts` | 50 tests: the table matches the classification (no missing, extra or duplicate id), every use runs through `run()`, and one or more fixed-dice tests per use that check costs, limit, roll, targets and outcomes against the card text. |

No vocabulary change. 11 `manual` steps; 4 new vocabulary-gap beads, 4 existing ones reused (below).

## Readings used throughout

- **Roll Difficulty.** "Make a Spellcast Roll against a target" = the target's Difficulty (`hit` gate); "Spellcast Roll (13)"
  = fixed (`success` gate). CB p.96: "If a Spellcast Roll can damage a target, it's also considered an attack roll."
- **"On a success, spend …"** is a `pay` step after the roll: the roll's own Hope may pay (CB p.90, R8: "if you rolled with
  Hope for that action, the Hope you gain from that roll can be spent on that feature"). An unpaid `pay` stops the rest of
  the card (Bolt Beacon with 0 Hope after a hit with Fear sends no bolt).
- **Healing.** "clear N Hit Points or N Stress" is a `choose` step (a dialog choice, Q9). Healing targets are "a creature"
  (`side: any`) where the card says so.
- **Conditions placed by a card that later cards test** (Life Ward's sigil, Shield Aura) are condition **tags** on the
  bearer, so the follow-up use can gate on `targetHas` the trigger subject and clear the tag itself. "temporarily" =
  `temporary` (CB p.102: "clearing a temporary condition, though the GM might have you clear it in another way").
- **Limits.** Healing Hands' "You can't heal the same target again until your next long rest" = `perTarget` long-rest limit
  (key `card:healing-hands:<targetId>`), spent on a failure too (a failure also heals). "Once per long rest on a success"
  (Zone of Protection) = `consumedOn: success` (Q4). Per-use limits use `card:<id>:<useId>` (Mending Touch's `bond`,
  Splendor-Touched's `convert`).
- **"exclusive"**: Life Ward ("you cast Life Ward on another target") and Shield Aura ("only hold Shield Aura on one
  creature at a time").

## Every card

| Lv | Card (page) | Use id | Reading | Manual step (why) |
|---:|-------------|--------|---------|-------------------|
| 1 | Bolt Beacon (p.340) | `main` | Spellcast vs target, enemy Far; `pay` 1 Hope on success; hit: `{Prof}d8+2` magic + Vulnerable (temporary) | — |
| 1 | Mending Touch (p.340) | `main` | Situation "a few minutes"; 2 Hope; a creature in Melee; choose 1 HP or 1 Stress | — |
| | | `bond` | Both situations (few minutes + learning something new); once per long rest; 2 Hope; choose 2 HP or 2 Stress | — |
| 1 | Reassurance (p.340) | `main` | Reaction `afterAllyRolls`; once per rest; fold `modifyRoll reroll all` on the ally | — |
| 2 | Final Words (p.340) | `main` | Spellcast (13) | the corpse's answers: three on Hope, one on Fear, dust on a failure (narrative, by design) |
| 2 | Healing Hands (p.340) | `main` | Spellcast (13), a creature other than you in Melee; success: `pay` 1 Stress, choose 2 HP / 2 Stress; failure: `pay` 1 Stress, choose 1 HP / 1 Stress; once per target per long rest | — |
| 3 | Second Wind (p.340) | `main` | Rider on a successful attack; once per rest; choose 3 Stress / 1 HP on you; the ally's clear (picked, ally in Close) gated on the situation "The attack succeeded with Hope" | — (the Hope check is a confirmation: gap dcm-jx6) |
| 3 | Voice of Reason (p.340) | `main` | Passive; requires full Stress; Proficiency +1 | — |
| | | `authority` | Passive; situation "de-escalate / follow your lead"; advantage on action rolls | — |
| 4 | Life Ward (p.340) | `main` | 3 Hope; an ally in Close gets tag **Life Ward** until long rest (endsWhen: saves them / recast); exclusive | — |
| | | `save` | Auto on `wouldMakeDeathMove` (ally) with the tag: negate the death move (fold), clear 1 HP, clear the tag | — |
| 5 | Shape Material (p.340) | `main` | 1 Hope; an object in Melee | the shaping (narrative, by design) |
| 5 | Smite (p.340) | `main` | Once per rest; 3 Hope; self effect "Smite charged", duration manual until the next successful weapon attack | — |
| | | `strike` | Rider on a successful weapon attack; requires the Smite effect; fold `modifyDamage multiply 2` + `type magic` | end the charge (gap dcm-8x8) |
| 6 | Restoration (p.340) | `main` | Choose tokens (1..card tokens), spend them; a creature in Melee; per token choose 2 HP or 2 Stress (`choose` with count = tokens spent) | — |
| | | `cure` | 1 token; choose: clear Vulnerable, or an ailment | heal an ailment; the GM may ask for more tokens (GM ruling, by design) |
| | | `long-rest` | Auto after a long rest: tokens set to Spellcast (the clear of unspent tokens is folded in) | — |
| 6 | Zone of Protection (p.340) | `main` | Spellcast (16); once per long rest on a success; you and allies around a point in Far (Very Close radius); d6 on the card at 1 (tokens, die 6); effect on each | — |
| | | `reduce` | Auto on `whenAllyWouldTakeDamage` (includeSelf), situation "inside your zone"; fold `reduceDamage` = the die; die +1 | the zone ends when the die would exceed 6 (gap dcm-7n7); the zone on the map (gap dcm-cma) |
| 7 | Healing Strike (p.340) | `main` | Reaction on `whenYouDealDamage` to an enemy; 2 Hope; an ally in Close (picked) clears 1 HP | — |
| 7 | Splendor-Touched (p.340) | `main` | Passive; 4 Splendor cards; Severe threshold +3 | — |
| | | `convert` | Reaction on `whenYouWouldTakeDamage`; 4 Splendor cards; once per long rest; choose fold `convertMarks hp → stress` or `hp → hope` | — |
| 8 | Shield Aura (p.341) | `main` | 1 Stress; you or an ally in Very Close gets tag **Shield Aura** (duration manual); exclusive | — |
| | | `aura-ally` | Auto on `whenArmorSlotMarked` (ally) with the tag: fold `reduceSeverity 1` | the aura ends if the bearer marked no HP (gap dcm-sim) |
| | | `aura-self` | Auto on `whenArmorSlotMarked` (self), situation "You hold your own Shield Aura": fold `reduceSeverity 1` | same end (dcm-sim); the self check is a confirmation (gap dcm-qdm) |
| 8 | Stunning Sunlight (p.341) | `main` | Choose Hope ≥ 1; Spellcast vs target, every enemy in front within Far; on success `pay` that Hope; the picked targets (max = Hope) save (14): success `3d20+3` magic, failure `4d20+5` magic + tag **Stunned** (temporary) + effect flags cannotReact, cannotAct; each expression rolled once (R9) | — (picks must be hit targets: gap dcm-y45) |
| 9 | Overwhelming Aura (p.341) | `main` | Spellcast (15); `pay` 2 Hope on success; self effect: set Presence to Spellcast until long rest | — |
| | | `attacked` | Auto on `whenAttacked` (targeted), requires the effect; the attacker marks a Stress | — |
| 9 | Salvation Beam (p.341) | `main` | Choose Stress ≥ 1; Spellcast (16); allies in a line within Far; on success `pay` that Stress; clear that many HP split among them (`splits`, else a split prompt) | — |
| 10 | Invigoration (p.341) | `main` | Reaction on `featureExhausted` (Close); choose Hope ≥ 1, pay it; `check` that many d6, any 6: fold `refreshFeature` on the trigger subject | — |
| 10 | Resurrection (p.341) | `main` | Spellcast (20); success: d6 `check`, 5 or lower: to the vault permanently | restore the creature (narrative, by design); failure: no cast for a week (gap dcm-aym) |

Not in the table: **Divination** (Level 4, p.340), out of combat (CA0).

## Manual steps (11)

| Card / use | Text shown | Why |
|------------|-----------|-----|
| Final Words (×3: Hope, Fear, failure) | the answers / "The body turns to dust." | Questioning a corpse is narrative; the roll and its branches are automated. |
| Shape Material | shaping natural material | Narrative; the Hope cost is automated. |
| Smite `strike` | "Smite is spent: end its charge" | No step ends a card's own sheet effect (dcm-8x8). |
| Restoration `cure` (ailment) | heal an ailment; GM may require more tokens | GM ruling (p.340: "the GM might require additional tokens"). |
| Zone of Protection `reduce` | the zone ends when the die would exceed 6 | No gate on card tokens (dcm-7n7). |
| Shield Aura `aura-ally`, `aura-self` | the aura ends when it left no HP marked | The fold is resolved later by AA1; no gate on its result (dcm-sim). |
| Resurrection (success) | restore a creature dead ≤ 100 years | The dead creature is not a combatant. |
| Resurrection (failure) | no cast for a week | No limit longer than a long rest (dcm-aym). |

## Vocabulary gaps (beads)

| Bead | Gap | Cards | New |
|------|-----|-------|-----|
| dcm-sim | No gate on the damage result after Armor Slots | Shield Aura | yes |
| dcm-aym | No usage limit longer than a long rest (a week) | Resurrection | yes |
| dcm-y45 | A step's pick can't be limited to the targets the roll hit | Stunning Sunlight | yes |
| dcm-qdm | No gate or requirement on a condition tag the actor carries | Shield Aura (on yourself) | yes |
| dcm-jx6 | A rider can't gate on its host roll's result | Second Wind | reused |
| dcm-8x8 | No step that ends a card's own sheet effect | Smite | reused |
| dcm-7n7 | No gate or requirement on card tokens | Zone of Protection | reused |
| dcm-cma | No persistent area | Zone of Protection | reused |

## For CA4 / CA5 / AA1

- Pass `useId` for every non-`main` use; `main` is the default action.
- **Second Wind**: put "The attack succeeded with Hope" in `situations` when the host attack rolled with Hope (no checkbox
  needed); pass the ally as `picked`.
- **Stunning Sunlight**: pass every enemy in front within Far as `targets`, and as `picked` only the hit targets the player
  chose, at most the Hope chosen (dcm-y45).
- **Life Ward `save`** and **Shield Aura `aura-ally`**: AA1 offers them with the ally as `trigger.subject` carrying its
  `tags`; they do nothing for an ally without the tag.
- **Zone of Protection `reduce`**: offered to the caster when an ally (or the caster) in the zone would take damage; the
  situation text is "The creature taking damage is inside your zone of protection".
- **Salvation Beam**: pass the clears per ally as `splits`; without them the plan holds a `split` prompt.

## Book checks (quoted briefly)

- CB p.90: "if you rolled with Hope for that action, the Hope you gain from that roll can be spent on that feature" (Bolt
  Beacon, Overwhelming Aura, Stunning Sunlight pay after the roll).
- CB p.96: "If a Spellcast Roll can damage a target, it's also considered an attack roll" (Stunning Sunlight's critical adds
  the dice maximum).
- CB p.102: temporary conditions are cleared by the target or by the GM.
- CB p.104 (R9): damage rolled once and applied to each target (Stunning Sunlight's two expressions).
- CB p.106: "when you mark your last Hit Point" you make a death move (Life Ward's trigger).

## QUESTIONS (rule readings to confirm)

1. **Stunning Sunlight** (p.341): "On a success, spend any number of Hope and force that many targets you succeeded against to
   make a Reaction Roll (14). Targets who succeed take 3d20+3 magic damage. Targets who fail take 4d20+5 …" Read as: only the
   targets forced to roll take damage; hit targets you spent no Hope on take nothing. Confirm (the alternative: every hit
   target takes 4d20+5 unless it was forced to roll and succeeded).
2. **Healing Hands** (p.340): "You can't heal the same target again until your next long rest." Read as: a failure (which
   still heals one) also locks that target. Confirm.
3. **Mending Touch / Restoration** (p.340): "a creature" / "Touch a creature": read as any creature in Melee, including
   yourself and adversaries. Should yourself be excluded, or adversaries?
4. **Restoration** (p.340): "spend any number of tokens to clear 2 Hit Points or 2 Stress for each token spent." Read as a
   choice per token (2 tokens can clear 2 HP and 2 Stress). Confirm, or one choice for all tokens?
5. **Zone of Protection** (p.340): "for all allies within Very Close range of that point." Read as including you when you
   stand in the zone. Confirm.
6. **Shield Aura** (p.341): "a target within Very Close range" read as you or an ally (adversaries have no Armor Slots).
   Confirm that you can cast it on yourself.
7. **Voice of Reason** (p.340): "+1 bonus to your Proficiency for damage rolls" is stored as Proficiency +1 while Stress is
   full. Proficiency only sets damage dice in the core rules, but Codex-Touched adds Proficiency to a Spellcast Roll. Is the
   +1 meant to count there too? (Read: no; the sheet should apply it to damage only.)
8. **Second Wind** (p.340): "when you succeed on an attack against an adversary" read as any attack (weapon or a damaging
   Spellcast Roll, CB p.96). Should it be weapon attacks only?
9. **Splendor-Touched** (p.340): "mark that much Stress or spend that much Hope instead." Read as all of the HP converted to
   one track (no mix), and only when you have that much Stress / Hope free. Confirm.
