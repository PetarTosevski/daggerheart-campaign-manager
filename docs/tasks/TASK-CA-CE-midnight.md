# TASK CE-midnight: Card effects - Midnight (19 combat cards)

Plan `.omc/plans/combat-actions.yaml`, tracer CE-midnight (wave 3). Book pages are printed pages; CB = Core Book. The
Midnight cards are on CB p.336 (Pick and Pull to Mass Disguise) and p.337 (Midnight-Touched to Specter of the Dark).

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/midnight.ts` | `MIDNIGHT_EFFECTS`: one entry for each of the 19 combat or passive Midnight cards, each quoting its card text; `MIDNIGHT_SITUATIONS`, the situation texts the player confirms |
| `tests/unit/card-effects/midnight.test.ts` | 42 tests: the table matches the classification exactly (a missing, extra or duplicate id fails; the two out-of-combat cards have no entry), every use runs through `run()`, and each card is run with fixed dice and checked for costs, limit, roll, targets and outcomes |

The vocabulary (`src/lib/domain/card-effects/types.ts`) and the runner are unchanged. Uncanny Disguise and Mass Disguise
are out of combat (CA0) and have no entry.

User answers implemented: **U3** every combat-usable Midnight card has an entry. **Q3/Q4** limits are stored as
`card:<id>` or `card:<id>:<useId>`: Night Terror's "Once per long rest" is used up by any use; Eclipse's "Once per long
rest on a success" uses `consumedOn: "success"`; Midnight-Touched's "Once per rest" is on its `hope` use. **Q9**:
teleports are `move` prompts (Vanishing Dodge, Phantom Retreat); temporary conditions go on the tracker (Restrained,
Vulnerable through the Chokehold and Horrified tags, Hidden); choices are dialog numbers (tokens, the Fear Die) or a
`choose` step (Dark Whispers' question); what is left is a `manual` step that carries the card's words.

## Cards and readings

| Lv | Card | Uses | Reading |
|---:|------|------|---------|
| 1 | Pick and Pull | `main` passive | `advantage` on action rolls while the player confirms the situation (picking a nonmagical lock, disarming a nonmagical trap, stealing). |
| 1 | Rain of Blades | `main` action | A Hope upfront. Spellcast Roll against every adversary within Very Close. Those hit take (Proficiency)d8+2 magic. A Vulnerable target hit takes an extra 1d8 as its own damage step: rolled once for all of them (CB p.104), maximised on a critical, and totalled with the d8+2 before thresholds (CB p.98). Type magic (the card's damage is magic). |
| 2 | Midnight Spirit | `main` action, `attack` action | `main`: a Hope, the effect "Midnight Spirit" until your next rest, `exclusive` (one spirit at a time), plus a manual step for the spirit. `attack` needs that effect: Spellcast Roll against one adversary within Very Far; on a hit (Spellcast)d6 magic; a manual step says the spirit dissipates. |
| 2 | Shadowbind | `main` action | Spellcast Roll against every adversary within Very Close; those hit are Restrained (temporary). |
| 3 | Chokehold | `main` action, `extra-damage` auto | `main`: the player confirms being behind a creature about their size; mark a Stress; the adversary in Melee gets the tag "Chokehold" (implies Vulnerable, temporary). `extra-damage`: on your own successful attack, a target with the tag takes +2d6 (`modifyDamage add`). Other creatures' attacks are a manual step. |
| 3 | Veil of Night | `main` action, `attack-through` rider | `main`: Spellcast Roll (13); on a success, the effect "Veil of Night" until you cast another spell (`exclusive`), plus a manual step for the curtain and the Hidden status. `attack-through`: while the effect is on and the player confirms the attack goes through the darkness, the attack has advantage. |
| 4 | Glyph of Nightfall | `main` action | Spellcast Roll against one adversary within Very Close. On a success, `pay` a Hope (the roll's own Hope may pay, R8). If it is paid, the target gets the effect "Glyph of Nightfall" with `difficulty -max(Knowledge, 1)`, temporary. |
| 4 | Stealth Expertise | `main` reaction, `ally` reaction | `main`: after your action roll with Fear, with the sneaking situation confirmed, mark a Stress and fold `modifyRoll withHope`. `ally`: after an ally within Close rolls with Fear while sneaking, mark a Stress and fold it on that ally. |
| 5 | Hush | `main` action | Spellcast Roll against one adversary within Close. On a success, `pay` a Hope. If paid, the target and everything within Very Close of it (`picked`, any side, passed by the server) get the effect "Silenced (Hush)" (`flag silenced`, duration manual). It ends when the GM spends a Fear on their turn, you cast Hush again (`exclusive`) or you take Major damage. A manual step covers the area following the target. |
| 5 | Phantom Retreat | `main` action, `return` action | `main`: a Hope, the effect "Phantom Retreat" until your next rest, and a manual step to note the square. `return` needs the effect: a Hope, a teleport prompt back to that square, and a manual step to end the effect. |
| 6 | Dark Whispers | `main` action, `channel` action | `main`: the player confirms physical contact; mark a Stress; Spellcast Roll against the creature (any side, no range). On a success, a `choose` step offers the four questions; the picked one is a manual step for the GM. `channel`: speaking mind to mind, a manual step with no cost. |
| 7 | Midnight-Touched | `hope` reaction, `fear-die` rider | Both need 4 or more Midnight cards in the loadout. `hope`: once per rest, when the GM would gain a Fear and you have 0 Hope, fold `negate effect` (the GM doesn't gain it) and gain a Hope. `fear-die`: on a successful attack, mark a Stress and add the Fear Die's result to the damage; the result is a dialog number from 1 to 12 (`fearDie`), because no number source reads the host roll. |
| 7 | Vanishing Dodge | `main` reaction (an attack against you that would deal physical damage fails) | A Hope: you become Hidden until your next action roll (duration `nextRoll`) and get a teleport prompt to a point within Close of the attacker. |
| 8 | Shadowhunter | `main` passive | With "shrouded in low light or darkness" confirmed: `evasion +1` and `advantage` on attack rolls. |
| 8 | Spellcharge | `spend` rider, `charge` auto | `charge`: when you take magic damage, add tokens equal to the HP you marked (`triggerAmount`), at most your Spellcast trait. `spend`: on a successful attack, choose 1 or more tokens, pay them, and add that many d6 to the damage. |
| 9 | Night Terror | `main` action | Once per long rest. Pick any adversaries within Very Close. Each makes a reaction roll (16). A failure is the tag "Horrified" (implies Vulnerable, temporary). Stolen Fear = min(Horrified count, the GM's Fear). That many d6 are rolled once and dealt to each Horrified target, then the GM loses the stolen Fear. The damage step comes before the Fear step so both read the GM's pool before the theft. The damage type isn't printed; it is magic (a spell). |
| 9 | Twilight Toll | `main` action, `toll` rider, `strike` rider, `rest` auto | `main`: choose an adversary within Far. The old tokens are cleared ("When you choose a new target"), the target gets the tag "Twilight Toll", and the card is `exclusive`. `toll`: after your successful action roll, with "against the target, no damage roll" confirmed, add a token if the target has the tag. `strike`: on a successful attack against the tagged target, pay the chosen tokens and add that many d12. Another target pays nothing and gets nothing. `rest`: a rest clears the tokens. |
| 10 | Eclipse | `main` action, `shadow` auto | `main`: Spellcast Roll (16), once per long rest on a success. You and the allies within Far (`allies`, passed by the server) get the effect "Eclipse" (`disadvantageAgainst attack`, duration manual). It ends when the GM spends a Fear on their turn or the caster takes Severe damage. A manual step covers the darkness and allies' successes with Hope. `shadow`: while the effect is on, your attack that succeeds with Hope makes each adversary hit mark a Stress. |
| 10 | Specter of the Dark | `main` action | A Stress: the effect "Spectral: float and pass through solid objects" with physical immunity. Duration manual, ending when you make an action roll targeting another creature. |

## Manual steps

| Card | Manual step (card words) | Why | Page |
|------|--------------------------|-----|------|
| Midnight Spirit (`main`) | "summon a humanoid-sized spirit that can move or carry things for you" | Summons are narrative (CA0, left manual by design); the map has no spirit token | CB p.336 |
| Midnight Spirit (`attack`) | "the spirit moves into Melee range with that target … The spirit then dissipates" | No step ends a card's own effect (bead dcm-8x8, commented) | CB p.336 |
| Chokehold | "When a creature attacks a target who is Vulnerable in this way, they deal an extra 2d6 damage" (allies' and adversaries' attacks) | No trigger on another creature's attack and no damage-taken modifier on an instance (bead dcm-9gw, commented). Your own attacks are automated | CB p.336 |
| Veil of Night | "create a temporary curtain of darkness between two points within Far range … You're considered Hidden to adversaries on the other side of the veil" | The map has no darkness wall, and Hidden is relative to which side of the veil an adversary is on. Narrative | CB p.336 |
| Hush | "encompasses everything within Very Close range of them and follows them as they move" | No persistent moving area that adds or drops creatures (bead dcm-cma, commented) | CB p.336 |
| Phantom Retreat (`main`) | Noting where you stood | The map stores no marked square. Narrative | CB p.336 |
| Phantom Retreat (`return`) | "This spell ends after you reappear" | No step ends a card's own effect (bead dcm-8x8, commented) | CB p.336 |
| Dark Whispers (`main`) | The question asked of the GM | A question for the GM (CA0, left manual by design) | CB p.336 |
| Dark Whispers (`channel`) | "speak into the mind … they can speak back into your mind" | Narrative | CB p.336 |
| Eclipse | "plunge the entire area within Far range into complete darkness …" and "when … an ally succeeds with Hope against an adversary within this shadow, the target must mark a Stress" | No trigger for an ally's success with Hope (bead dcm-0gi); the map doesn't model the darkness area | CB p.337 |

Partly expressed (no manual step): Midnight-Touched's Fear Die is a number the player types in (bead dcm-d1b).
Twilight Toll's token placement is a rider the player confirms instead of an automatic trigger (bead dcm-94h).
Specter of the Dark's end ("until you make an action roll targeting another creature", bead dcm-cwh, commented), and
the ends of Hush ("you take Major damage") and Eclipse ("you take Severe damage") (bead dcm-utu, commented), are
`endsWhen` texts the GM or player clears.

## Vocabulary gaps (beads)

- dcm-d1b (new): no number source for the host roll's Hope or Fear Die (Midnight-Touched)
- dcm-0gi (new): no trigger for an ally's success with Hope against an adversary (Eclipse)
- dcm-94h (new): no trigger filter for an action roll against a target that makes no damage roll (Twilight Toll)
- dcm-9gw (existing, commented): no damage-taken modifier on a creature (Chokehold)
- dcm-cma (existing, commented): no persistent area (Hush's moving area)
- dcm-8x8 (existing, commented): no step that ends a card's own effect (Midnight Spirit, Phantom Retreat)
- dcm-cwh (existing, commented): duration ending on the caster's next roll that targets a creature (Specter of the Dark)
- dcm-utu (existing, commented): durations ending when the caster takes damage (Hush, Eclipse)

## Book checks (quoted briefly)

- CB p.336, Rain of Blades: "Targets you succeed against take d8+2 magic damage using your Proficiency. If a target you hit
  is Vulnerable, they take an extra 1d8 damage."
- CB p.337, Night Terror: "Steal a number of Fear from the GM equal to the number of targets that are Horrified (up to the
  number of Fear in the GM's pool). Roll a number of d6s equal to the number of stolen Fear and deal the total damage to
  each Horrified target."
- CB p.337, Eclipse: "Once per long rest on a success" (Q4: only a success uses it).
- CB p.90 (R8): "the Hope you gain from that roll can be spent on that feature" (Glyph of Nightfall, Hush).
- CB p.98: "the damage is always totaled before it's applied" (Rain of Blades' extra 1d8, Chokehold's 2d6).
- CB p.104: "roll damage once and apply the total to each target" (Rain of Blades, Night Terror).

## QUESTIONS (rule readings to confirm)

1. **Midnight Spirit on a failed attack** (CB p.336: "On a success, the spirit moves into Melee range with that target.
   Roll … d6s … The spirit then dissipates."). I read "then dissipates" as part of the success, so a miss keeps the
   spirit. Or does sending it always use it up?
2. **"All targets" / "any targets" are adversaries** (Rain of Blades "all targets within Very Close range", Night Terror
   "choose any targets within Very Close range", CB p.336-337). Same reading as CE-arcana QUESTION 1. Should allies in
   range be hit too?
3. **Night Terror's damage type** isn't printed (CB p.337: "deal the total damage to each Horrified target"). I used
   magic, since it is a spell. Confirm.
4. **Specter of the Dark's "float"** (CB p.337: "can float and pass through solid objects"). I didn't set the `flying`
   flag, so Earthquake ("who aren't flying") still hits a Spectral PC. Should floating count as flying?
5. **Eclipse's shadow** (CB p.337: "plunge the entire area within Far range into complete darkness … Attack rolls have
   disadvantage when targeting you or an ally within this shadow"). The effect goes to you and the allies within Far when
   you cast it. Allies who walk in or out later are handled by hand. Is the area fixed where you cast it, or does it move
   with you?
6. **Twilight Toll's damage** (CB p.337: "When you deal damage to this target, spend any number of tokens"). I offer the
   d12s on a successful attack (a weapon attack or a damaging spell), not on other damage such as a reaction. Does a rest
   ("When you … take a rest, clear all unspent tokens") also end the target marking, or only clear the tokens?
7. **Hush's target** (CB p.336: "a target within Close range"). I allow only an adversary as the target. Everything in
   the area, allies included, is Silenced. Should an ally be a valid target?
8. **Phantom Retreat's return "at any time"** (CB p.336). It is a Hand action. Should it also be offered as a reaction,
   for example when you are attacked?
9. **Chokehold's extra 2d6** (CB p.336: "When a creature attacks a target who is Vulnerable in this way, they deal an
   extra 2d6 damage"). It applies to your own successful attacks automatically. I read "attacks" as a successful attack
   that deals damage. Confirm.
