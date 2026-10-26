# TASK CE-arcana: Card effects - Arcana (21 cards)

Plan `.omc/plans/combat-actions.yaml`, tracer CE-arcana (wave 3). Book pages are printed pages; CB = Core Book. The
Arcana cards are on CB p.328 (Rune Ward to Premonition) and p.329 (Rift Walker to Falling Sky).

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/arcana.ts` | `ARCANA_EFFECTS`: one entry for each of the 21 Arcana cards (all classified combat), each quoting its card text |
| `tests/unit/card-effects/arcana.test.ts` | 47 tests: the table matches the classification and `DOMAIN_CARDS` exactly (a missing or extra id fails), every use runs through `run()`, and each card is run with fixed dice and checked for costs, limit, roll, targets and outcomes |

The vocabulary (`src/lib/domain/card-effects/types.ts`) and the runner are unchanged. I filed a bead for each vocabulary
gap (see "Vocabulary gaps").

User answers implemented: **U3** every combat-usable Arcana card has an entry. **Q3/Q4** limits are stored as
`card:<id>` (or `card:<id>:<useId>`). "Once per rest on a success" (Confusing Aura, Earthquake) uses `consumedOn:
"success"`. "Once per rest, make a Spellcast Roll" (Sensory Projection) and plain "once per long rest" (Premonition) are
used up by any use. **Q9** works like this: push and pull are `move` prompts (Blink Out, Preservation Blast, Telekinesis).
Temporary conditions go on the tracker (On Fire, Vulnerable, Cloaked). Choices are dialog numbers (tokens, Hope, Stress,
layers) or an `optional` (Telekinesis' throw). What is left is a `manual` step that carries the card's words.

## Cards and readings

| Lv | Card | Uses | Reading |
|---:|------|------|---------|
| 1 | Rune Ward | `main` reaction (you hold the ward), `ally` reaction (an ally holds it) | Trigger: you (or an ally) would take damage. Spend a Hope, roll the Ward Die (1d8) and fold `reduceDamage` by that roll into the hit. On an 8 a manual step says the ward's power ends until your next rest. In the `ally` use, the ally's Hope is a `hope lose` step on the trigger subject. |
| 1 | Unleash Chaos | `main` action, `replenish` action, `session-start` auto, `session-end` auto | `main`: choose how many tokens to spend (1 up to the tokens on the card), pay them upfront, make a Spellcast Roll against one enemy within Far, and on a hit deal (tokens spent)d10 magic damage. `replenish`: mark a Stress and set the tokens to your Spellcast trait. At session start the tokens are set to Spellcast; at session end they are cleared. |
| 1 | Wall Walk | `main` action | A Hope gives a creature you touch (any side, Melee) the effect "Wall Walk" until the end of the scene. `exclusive`: casting it again ends the old one. The effect has no mods; climbing is the label. |
| 2 | Cinder Grasp | `main` action | Spellcast Roll against one enemy in Melee. On a hit: 1d20+3 magic damage (no Proficiency, as printed) and the tag "On Fire" (temporary). The extra 2d6 when an On Fire creature acts is a manual step. |
| 2 | Floating Eye | `main` action | A Hope gives the effect "Floating Eye" (duration manual, ends when the orb takes damage or leaves Very Far range) plus a manual step for the orb. `exclusive` ("a single orb"). |
| 3 | Counterspell | `main` reaction on `magicalEffect` | A reaction roll with Spellcast against the GM's Difficulty (no number on the card, CB p.157). On a success it folds `negate effect` and the card goes to the vault. No Hope or Fear (CB p.99). |
| 3 | Flight | `main` action, `spend` auto | `main`: Spellcast Roll (15); on a success, tokens = Agility (minimum 1) and the effect "Flying" (`flag flying`). `spend`: after each action roll while Flight's effect is active, spend a token; a manual step reminds you that the last token brings you down. |
| 4 | Blink Out | `main` action | Spellcast Roll (12). On a success: pay a Hope and get a teleport prompt (Far). Then pay one Hope per willing passenger (the use's targets: any creature in Very Close, willing). If you can't pay that, nobody comes along. |
| 4 | Preservation Blast | `main` action | Spellcast Roll against every enemy in Melee. Those hit get a knock-back prompt to Far and take (Spellcast)d8+3 magic damage. |
| 5 | Chain Lightning | `main` action | Mark 2 Stress upfront. Spellcast Roll against every enemy within Close. Each one hit makes a reaction roll against your roll's total; on a failure it takes 2d8+4 magic damage. `followUp` is the first link of the chain: the server passes the adversaries not yet targeted that are within Close of a target who took damage, and they make the same save. Later links are a manual step. The damage is rolled once for the move (CB p.104). |
| 5 | Premonition | `main` reaction (after your roll) | Once per long rest: fold `modifyRoll rescind`, plus a manual step "make another move instead". |
| 6 | Rift Walker | `main` action (place the marking), `open` action | `main`: Spellcast Roll (15); on a success, the effect "Rift Walker marking" (`exclusive`) and a manual note of where you stand. `open` needs that effect: Spellcast Roll (15); on a success, a manual step opens the rift. |
| 6 | Telekinesis | `main` action | Spellcast Roll against one creature within Far (any side). On a hit, a move prompt: anywhere within Far of where it stood. The optional "throw" makes a second Spellcast Roll (a `followUp`) against an enemy; on a hit, (Proficiency)d12+4 physical damage. |
| 7 | Arcana-Touched | `swap` reaction (after your action roll), `passive` | Both need 4 or more Arcana cards in the loadout. `passive`: `stat spellcast +1`. `swap`: once per rest, fold `modifyRoll swapDuality`. |
| 7 | Cloaking Blast | `main` rider (after a successful Spellcast Roll) | A Hope gives you Cloaked until you move into or within an adversary's line of sight or attack (duration manual, with `endsWhen`). It rides on another card's roll, so it is always "a different spell". |
| 8 | Arcane Reflection | `main` reaction (you would take magic damage) | Choose how much Hope to spend (at least 1) and roll that many d6. If any shows a 6, fold `redirectDamage` to the trigger's source. This follows CA1's fixture: `to` and `target` are both `triggerSource`. |
| 8 | Confusing Aura | `main` action, `attacked` auto | `main`: Spellcast Roll (14), once per long rest on a success. On a success: 1 layer, the effect "Confusing Aura", then mark the chosen Stress and add that many layers. The layers are tokens on the card. `attacked` (needs the effect): roll one d6 per layer. If any shows 5 or more, a layer goes and `negate attack` is folded. Otherwise the layers are cleared and a manual step says you take the damage and the spell ends. |
| 9 | Earthquake | `main` action | Spellcast Roll (16), once per rest on a success. Every enemy within Very Far that isn't flying makes a reaction roll (18). A failure takes 3d10+8 physical and is temporarily Vulnerable; a success takes half (rounded up, CB p.107). One damage roll for all. The terrain and structures are a manual step. |
| 9 | Sensory Projection | `main` action | Once per rest, used up by the attempt. Spellcast Roll (15); on a success, the effect "Sensory Projection" (ends when you take damage or cast another spell) plus a manual step for the vision. |
| 10 | Adjust Reality | `main` reaction (after you or an ally roll), `other` action | `main`: 5 Hope, fold `modifyRoll setResult` on the ally's (or your) action roll. `other`: 5 Hope plus a manual step, for any other roll (damage, reaction). The Hand's Use button picks `other`, because `pickUse` defaults to the first action use; the reaction window passes `useId: "main"`. |
| 10 | Falling Sky | `main` action | Choose how much Stress to mark (at least 1) and mark it upfront. Spellcast Roll against every enemy within Far. Those hit take 1d20+2 magic damage per Stress (`repeat`), totalled before thresholds. |

## Manual steps

| Card | Manual step (card words) | Why | Page |
|------|--------------------------|-----|------|
| Rune Ward | "If the Ward Die result is 8, the ward's power ends after it reduces damage this turn. It can be recharged for free on your next rest." | A limit can't be used up by a check result, and no requirement reads "spent until rest" (bead dcm-war) | CB p.328 |
| Cinder Grasp | "When a creature acts while On Fire, they must take an extra 2d6 magic damage if they are still On Fire at the end of their action." | Nothing triggers on an adversary's own action, and tags carry no ongoing effect (bead dcm-f0m) | CB p.328 |
| Floating Eye | Creating and moving the orb, and seeing through it | The map has no orb token. This is narrative | CB p.328 |
| Flight | "After the action that spends the last token is resolved, you descend to the ground directly below you." | No gate or requirement reads the card's tokens (existing bead dcm-7n7, commented) | CB p.328 |
| Chain Lightning | "This chain continues until there are no more adversaries within range" (links after the first) | Each link depends on who failed the previous save; `followUp` is one target set (bead dcm-rou; CA0 left this manual by design) | CB p.328 |
| Premonition | "make another move instead" | The new move is the player's next action. The rescind itself is folded | CB p.328 |
| Rift Walker | Placing the marking; opening the rift | The map has no rift or marking objects. This is narrative | CB p.329 |
| Confusing Aura | "you take the damage and this spell ends" | No step ends a card's own sheet effect (bead dcm-8x8). The damage itself goes ahead because nothing negates it | CB p.329 |
| Earthquake | "all terrain within Very Far range becomes difficult to move through and structures within this range might sustain damage or crumble" | The map doesn't model terrain difficulty. This is narrative | CB p.329 |
| Sensory Projection | The vision | Narrative | CB p.329 |
| Adjust Reality (`other`) | Changing a damage, reaction or other non-action roll | `afterAllyRolls` covers action rolls only (bead dcm-3ft) | CB p.329 |

Partly expressed (no manual step, with a note): Rune Ward's `ally` use charges the ally's Hope with no affordability
check, and its trigger range is set to Very Far because the ward has no range (bead dcm-uj0). Confusing Aura's Stress
choice has no upper bound in the vocabulary. If you choose more than your free Stress, the `pay` fails and you keep
one layer (bead dcm-8x8).

## Vocabulary gaps (beads)

- dcm-war: no limit consumed by a check result (Rune Ward)
- dcm-uj0: a cost paid by another PC (Rune Ward held by an ally)
- dcm-8x8: no step that ends a card's own sheet effect; a choice max can't read free Stress slots (Confusing Aura)
- dcm-3ft: no trigger after any roll (Adjust Reality)
- dcm-rou: no repeated chain of follow-ups (Chain Lightning)
- dcm-f0m: no trigger on the bearer's own action (Cinder Grasp's On Fire)
- dcm-7n7 (existing, commented): no gate or requirement on card tokens (Flight)

## Book checks (quoted briefly)

- CB p.328, Chain Lightning: "Targets you succeed against must make a reaction roll with a Difficulty equal to the result
  of your Spellcast Roll."
- CB p.329, Confusing Aura: "Once per long rest on a success … Mark any number of Stress to make that many additional
  layers."
- CB p.99, reaction rolls: "they don't generate Hope, Fear, or additional GM moves" (Counterspell).
- CB p.102, temporary effects: "They can be ended in the same way as temporary conditions" (On Fire, Vulnerable).
- CB p.104: "roll damage once and apply the total to each target" (Chain Lightning's chain, Earthquake's half damage).

## QUESTIONS (rule readings to confirm)

1. **"All targets" means enemies** (Preservation Blast "all targets within Melee range", Chain Lightning "all targets
   within Close range", Earthquake "all targets within Very Far range who aren't flying", CB p.328-329). I read these as
   every adversary in range, not allies, following CB p.104 ("choose any that fall within the parameters"). Should allies
   in range be hit too (or be pickable)?
2. **Confusing Aura's trigger** (CB p.329: "When an adversary makes an attack against you, roll a number of d6s equal to
   the number of layers … If all the results are 4 or lower, you take the damage"). I fire it only on an attack that
   would succeed (`whenAttacked` stage `succeeded`), because "you take the damage" suggests a hit. Taken literally it fires
   on every attack, including misses, and can lose a layer or end the spell on an attack that missed anyway. Which one?
3. **Unleash Chaos on a failure** (CB p.328: "spend any number of tokens … On a success, roll a number of d10s equal to
   the tokens you spent"). I pay the tokens upfront, so a miss loses them. Should a miss keep them?
4. **Falling Sky's Stress** (CB p.329: "Make a Spellcast Roll against all adversaries within Far range. Mark any number of
   Stress …"). I mark it before the roll, so a total miss still costs it. Should the Stress be chosen after seeing the
   roll?
5. **Rune Ward's holder** (CB p.328: "held as a ward by you or an ally"). The engine doesn't track who holds the ward, so
   both uses (you, an ally) are offered. Should the holder be chosen once and stored?
6. **Adjust Reality** (CB p.329: "any roll"): non-action rolls go through a manual action use. Is that enough, or should
   damage rolls get a proper fold once the vocabulary has the trigger (dcm-3ft)?
7. **Telekinesis' target** (CB p.329: "a target within Far range"). I allow any creature, ally or enemy, as the lifted
   target; the thrown-at second target must be an enemy within Far. Confirm.
