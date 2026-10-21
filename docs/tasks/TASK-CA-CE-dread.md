# TASK CE-dread: Card effects - Dread (21 cards, Hope & Fear)

Plan `.omc/plans/combat-actions.yaml`, tracer CE-dread (wave 3). Book pages are printed pages; HF = Hope & Fear, CB = Core
Book. The Dread cards are on HF p.180 (Blighting Strike to Darkfire) and p.181 (Jump Scare to Invoke Torment). The card
texts in `src/lib/srd/domain-cards.ts` match the book word for word.

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/dread.ts` | `DREAD_EFFECTS`: one entry for each of the 21 Dread cards (19 combat, 2 passive), each quoting its card text |
| `tests/unit/card-effects/dread.test.ts` | 53 tests: the table matches the classification and `DOMAIN_CARDS` exactly (a missing or extra id fails), every use runs through `run()`, and each card is run with fixed dice and checked for costs, limit, roll, targets and outcomes |

The vocabulary (`src/lib/domain/card-effects/types.ts`) and the runner are unchanged. I filed a bead for each new gap and
commented on the existing beads that already cover the rest (see "Vocabulary gaps").

User answers implemented: **U3** every combat-usable Dread card has an entry. **Q3/Q4** limits are stored as `card:<id>`
(or `card:<id>:<useId>`). "Once per long rest on a success" (Siphon Essence, Dark Army) uses `consumedOn: "success"`, so a
failure keeps the card. Umbral Veil, Shared Trauma and Dread-Touched's bonus are used up by any use. **Q9** works like this.
Movement is a prompt: Terrify's flee and Jump Scare's teleport. Temporary conditions go on the tracker: Restrained,
Vulnerable, and the Chained tag. Choices are dialog numbers (tokens, Hope, Stress, HP) or an `optional` (Terrify's flee,
Wall of Hunger's Hope). What is left is a `manual` step that carries the card's words.

## Cards and readings

| Lv | Card | Uses | Reading |
|---:|------|------|---------|
| 1 | Blighting Strike | `main` action | CA0's reading. Spellcast Roll against one enemy within Far. On a hit with Hope: (Proficiency)d6+1 magic. On a hit with Fear: (Proficiency)d10+1 magic. A critical counts as Hope (CB p.90). A hit also gives the effect "Blighted" (`flag halfDamage`, duration `hit`). On a failure, a `pay` of a Hope or a Stress (the player picks). |
| 1 | Umbral Veil | `main` action, `spend` reaction, `scene-end` auto | `main`: once per rest, mark a Stress; tokens = the GM's Fear, plus the effect "Umbral Veil" until the end of the scene. `spend` (needs that effect): after an attack roll against you, choose how many tokens to spend (1 up to the tokens on the card), then fold `modifyRoll add −tokens` onto the attacker's roll. `scene-end` clears the tokens. |
| 1 | Voice of Dread | `main` action | Spellcast Roll against one enemy you can see (no range, `sight`). On a hit: mark 1 Stress and temporarily Restrained. |
| 2 | Hideous Retribution | `main` reaction (an ally within Close takes damage from a source you can see) | A reaction roll with Spellcast against the attacker's Difficulty (the trigger's source). On a success, `pay` a Stress, then (Proficiency)d6 magic to the attacker. No Hope or Fear, and a critical adds no maximum (CB p.99, reaction rolls). |
| 2 | Siphon Essence | `main` action | Once per long rest, used up only by a success. Spellcast Roll against one enemy within Very Close. With Hope: (Proficiency)d12+4 magic. With Fear: (Proficiency+1)d12+4. A critical counts as Hope. If the target marked HP, a manual step tells you to clear that many HP (runner gap, below). |
| 3 | Shared Trauma | `main` action | Once per rest. Choose an HP number. The step's `pick` (any willing creature within Melee, you included) marks that many HP. The use's target (another willing creature within Melee) clears as many. |
| 3 | Terrify | `main` action | Spellcast Roll against one enemy within Close. On a hit: it marks 1d4 Stress. The optional "flee" gives a `flee` move prompt (one range away from you). With Fear the target is also temporarily Vulnerable. |
| 4 | Summon Horror | `main` action | Mark a Stress. **No attack roll**: the creature deals (Spellcast)d8+1 magic to one enemy within Far. If the target marked HP, it makes a Reaction Roll (12). On a failure it marks Stress equal to the HP it marked from this attack. |
| 4 | Chains of Affliction | `main` action | Mark 2 Stress. No roll. One enemy within Close gets the tag "Chained" (temporary) and the effect `stat hpMarked −1` (temporary). `exclusive`: Chaining another ends the old one. |
| 5 | Dire Strike | `main` reaction (`whenTargetMarksHp`) | Spend a Hope; the GM loses a Fear (never below 0). |
| 5 | Spectral Mist | `main` action | Spend 2 Hope. You and the allies you pick within Close get the effect "Incorporeal" (`resistance physical immune`). Its duration is `nextRoll`, and `endsWhen` names the solid object and the scene end. |
| 6 | Darkfire | `main` action | Choose how much Hope to spend (at least 1); that many enemies within Close at most (more targets are refused). Each target makes a Reaction Roll (15). A failure takes (Spellcast)d8+6 magic; a success takes half, rounded up (CB p.107). One damage roll for all targets (CB p.104). No attack roll, so no critical. |
| 6 | Jump Scare | `main` reaction (`whenYouDealDamage` magic) | Mark a Stress. A teleport prompt into Melee of the damaged creature (the trigger's subject), which becomes Vulnerable (duration `manual`, `endsWhen` "they mark 1 or more Hit Points"). |
| 7 | Dread-Touched | `prevent` reaction (`gmWouldGainFear`), `bonus` rider (before an action roll) | Both need 4 or more Dread cards in the loadout. `prevent`: the player also confirms "You succeeded with Fear on this roll", marks 2 Stress, and `negate effect` is folded onto the GM's Fear gain. `bonus`: once per rest, fold `modifyRoll add` = the GM's Fear. |
| 7 | Wall of Hunger | `main` action | Spellcast Roll (10). On a success, the optional "wall" costs a Hope (the roll's own Hope may pay, R8). It gives the effect "Wall of Hunger" (manual end: you mark a Hit Point or cast it again; `exclusive`) and 2 Stress to each creature the player picks inside the wall (any side, Far, `area: line`). Crossing the wall later is a manual step. |
| 8 | Dark Army | `main` action, `strike` rider, `guard` reaction, `rest` auto | `main`: Spellcast Roll (14), once per long rest, used up only by a success. On a success: 8 tokens and the effect "Dark Army" until a rest. `strike`: when you deal damage, the player confirms the target is within Very Close, picks how many tokens to spend, and (tokens)d8 is folded onto the damage. `guard`: when you would take damage, (tokens)d8 is folded as `reduceDamage`. `rest`: clears the tokens. |
| 8 | Eldritch Flesh | `armor` reaction (after an action roll with Fear), `passive` | `passive`: `majorThreshold` and `severeThreshold` +1 per marked Stress (`marked self stress`, read live). `armor`: spend 2 Hope to clear an Armor Slot. |
| 9 | Damnation | `main` action | Choose a Stress number (at least 1). Spellcast Roll against one enemy within Far. On a success, `pay` that Stress, then roll that many d20s as magic damage (a critical adds 20 per die, CB p.98). If the attack defeats the target, every enemy the player picks within Far of the target marks a Stress. |
| 9 | Savor the Anguish | `main` auto (`whenEnemyTakesDamage` Close, Severe) | Clear a Stress. No prompt (classified passive). |
| 10 | Avatar of Terror | `main` action, `damage` auto, `spotlight` auto, `upkeep` auto | `main`: mark a Stress for the effect "Avatar of Terror" (manual end; `exclusive`). The other three need that effect. `damage`: when you deal damage, (GM Fear)d6 is folded onto it. `spotlight`: gain a Hope when the GM spends a Fear to spotlight an adversary within Very Close. `upkeep`: before each action roll, pay a Hope. With 0 Hope a manual step says you revert. |
| 10 | Invoke Torment | `double` auto (`whenYouDealDamage`), `hope` auto (`whenEnemyDefeated` Close, full Stress) | `double`: `modifyDamage multiply 2`, folded only for targets whose Stress is all marked (`targetStressFull`). `hope`: gain a Hope. |

## Manual steps

| Card | Manual step (card words) | Why | Page |
|------|--------------------------|-----|------|
| Siphon Essence | "You clear a number of Hit Points equal to the number of Hit Points the target marked from this attack." | The vocabulary has the right source (`markedThisMove who: target`, and types.ts names this card for it). But the runner resolves `who: target` against the step's recipient, so with `to: self` it reads you and gives 0 (bead dcm-0ib). The prompt appears only when the target marked HP | HF p.180 |
| Wall of Hunger | "The wall stands between two points within Far range. A creature that passes through it must mark 2 Stress. The wall lasts until you mark a Hit Point or cast this spell again." | The map has no walls, nothing triggers on crossing an area (dcm-cma), and no step ends a card's own effect (dcm-8x8). The creatures inside when the wall appears are automated (a picked `markStress 2`) | HF p.181 |
| Avatar of Terror (`upkeep`) | "You can't spend a Hope: you revert to your normal form (end Avatar of Terror)." | No step ends a card's own effect (dcm-8x8). The Hope payment itself is automated | HF p.181 |

Partly expressed (no manual step, with a note):
- **Dread-Touched `prevent`**: the player confirms the success with Fear as a situation, because `gmWouldGainFear` also
  fires on a failure with Fear (bead dcm-1o3).
- **Dark Army `strike`**: the player confirms the target is within Very Close, because `whenYouDealDamage` has no range
  (bead dcm-ofy).
- **Spectral Mist**: the scene end is cleared by hand, because a duration can't be "next action roll or scene end"
  (bead dcm-0ey).
- **Jump Scare**: Vulnerable ends by hand when the target marks HP (existing bead dcm-utu, commented).
- **Shared Trauma**: the HP choice has no upper bound. The clear uses the chosen number, not what the marking creature
  actually marked; they differ only when that creature has fewer free HP than chosen (existing bead dcm-fnq, commented).
- **Damnation**: the Stress choice has no upper bound. If you choose more Stress than you have free slots, the `pay`
  fails and no damage is dealt (existing bead dcm-8x8, commented).

## Vocabulary gaps (beads)

- dcm-0ib (new): runner reads `markedThisMove who: target` from the recipient (Siphon Essence)
- dcm-0ey (new): duration that ends on the next action roll or at scene end (Spectral Mist)
- dcm-1o3 (new): no trigger for "when you succeed with Fear" (Dread-Touched)
- dcm-ofy (new): `whenYouDealDamage` has no target range (Dark Army)
- dcm-utu (existing, commented): no duration "until the bearer marks HP" (Jump Scare)
- dcm-cma (existing, commented): no persistent area that triggers on crossing (Wall of Hunger)
- dcm-8x8 (existing, commented): no step that ends a card's own effect; a choice max can't read free Stress slots (Avatar
  of Terror, Wall of Hunger, Damnation)
- dcm-fnq (existing, commented): a choice max can't read another creature (Shared Trauma)

## Book checks (quoted briefly)

- HF p.180, Blighting Strike: "On a roll with Hope, deal d6+1 magic damage using your Proficiency. On a roll with Fear,
  deal d10+1 magic damage using your Proficiency."
- HF p.180, Summon Horror: "Mark a Stress to summon an otherworldly creature that deals d8+1 magic damage using your
  Spellcast trait to a target within Far range." (no Spellcast Roll is printed)
- HF p.180, Siphon Essence: "Once per long rest on a success, the target takes d12+4 magic damage".
- HF p.181, Dread-Touched: "When you succeed with Fear, you can mark 2 Stress to prevent the GM from gaining a Fear."
- CB p.90: "A critical success counts as a roll with Hope" (Blighting Strike's and Siphon Essence's dice on a critical).
- CB p.99, reaction rolls: "they don't generate Hope, Fear, or additional GM moves" (Hideous Retribution).
- CB p.104: "roll damage once and apply the total to each target" (Darkfire's half damage).
- CB p.107: "round up unless otherwise specified" (Darkfire's half damage).

## QUESTIONS (rule readings to confirm)

1. **Summon Horror has no attack roll** (HF p.180: "summon an otherworldly creature that deals d8+1 magic damage using
   your Spellcast trait to a target within Far range"). I read it as automatic damage with no roll and no critical, and it
   can't miss. Confirm, or should it need a Spellcast Roll?
2. **"Using your Spellcast trait" as the dice count** (Summon Horror d8+1, Darkfire d8+6, HF p.180). Following CB p.98,
   the number of dice equals your Spellcast trait value. With a Spellcast of 0 or less, no dice are rolled (only the +1
   or +6). Should it be at least 1 die?
3. **Dread-Touched's Fear prevention** (HF p.181: "When you succeed with Fear, you can mark 2 Stress to prevent the GM
   from gaining a Fear"). This is a reaction when the GM would gain a Fear, and the player confirms the success with Fear.
   Should it instead be a toggle in your own roll dialog (a rider that fires only on a success with Fear)?
4. **Umbral Veil's tokens** (HF p.180: "place a number of tokens on this card equal to the number of Fear in the GM's
   pool"). The tokens equal the Fear at the moment you cast. The penalty is folded onto the attacker's roll after it is
   made, so it can turn a hit into a miss. Confirm.
5. **Voice of Dread's target** (HF p.180: "a creature you can see"). I allow enemies only, with no range but line of
   sight required. Should allies or neutral creatures be targetable too?
6. **Wall of Hunger's victims** (HF p.181: "A creature inside the wall when it appears … must mark 2 Stress"). The player
   picks the creatures inside, of any side, allies included, because the map has no wall shape. Confirm that allies
   inside also mark the Stress.
7. **Damnation's spread** (HF p.181: "all adversaries within Far range of the target must mark a Stress"). The player
   (or the server) picks those adversaries. The defeated target itself is not included. Confirm.
8. **Dark Army's tokens without the effect** (HF p.181: "When you take a rest, clear all unspent tokens"). The `strike`
   and `guard` uses need tokens but not the "Dark Army" effect. Tokens and effect both go at a rest, so this only matters
   if the GM edits tokens by hand.
9. **Avatar of Terror's damage bonus** (HF p.181: "a 1d6 bonus to your damage rolls for each Fear in the GM's pool").
   It applies by itself (auto) to every damage roll you make in the form, including card damage, and uses the GM's Fear at
   that moment. Confirm.
10. **Invoke Torment's double damage** (HF p.181: "You deal double damage to targets that have all their Stress marked").
    It doubles the move's total against each such target before thresholds. The target's Stress is read as the server
    passes it when the damage is dealt, so Stress the same move marks after the damage doesn't count. Confirm.
