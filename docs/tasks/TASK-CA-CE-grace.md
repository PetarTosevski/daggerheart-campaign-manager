# TASK CE-grace: Card effects - Grace (16 combat cards)

Plan `.omc/plans/combat-actions.yaml`, tracer CE-grace (depends on CA1). Book pages are printed pages (CB = Core Book).
Card texts: CB p.334 (levels 1-3) and CB p.335 (levels 4-10), checked against `src/lib/srd/domain-cards.ts`.

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/grace.ts` | `GRACE_EFFECTS`: 16 entries (every Grace card classified combat; Grace has no passive cards), 26 uses. Each entry quotes its card text. |
| `tests/unit/card-effects/grace.test.ts` | 39 tests: coverage (exactly one entry per combat/passive card, none for out-of-combat cards, merged into `CARD_EFFECTS`, unique use ids) and every use run through `run()` with `queueRng`, checking costs, limits, the roll, hits, targets and outcomes against the text. |

Out of combat (no entry, per CA0): Deft Deceiver, Soothing Speech, Endless Charisma, Master of the Craft, Notorious.

User answers used: **U3** (every combat card automated), **Q3/Q4** (once-per limits as `featureUses` keys; "once per rest
on a success" is used up only by a success), **Q9** (choices in a dialog: `choose` / `NumberChoice`; temporary conditions
as tracker tags; anything left over is a `manual` step with the card's words). The vocabulary was not changed.

Book rules checked: temporary conditions (CB p.102): "When an effect imposes a condition, it might say it is
'temporary,' … You can make an action roll, with a Difficulty determined by the GM, to try clearing a temporary
condition". Stress overflow (CB p.92), rounding up (CB p.107) and once-per limits (CB p.101) come from the runner (CA1).

## Cards and readings

| Lv | Card | Uses | Reading |
|---:|------|------|---------|
| 1 | Enrapture | `main` | Spellcast vs target, one enemy within Close. Hit: tag **Enraptured** (temporary). Optional add-on "mark a Stress: the Enraptured target marks a Stress", limit once per rest, used up only on a success, stored as `card:enrapture:main:stress`. |
| 1 | Inspirational Words | `main`, `tokens` | `main`: spend 1 token, one other ally, `choose` one of clear 1 Stress / clear 1 HP / gain 1 Hope. `tokens` (auto, after a long rest): `set` tokens to Presence (this also covers "clear all unspent tokens"). |
| 2 | Tell No Lies | `main`, `refuses` | `main`: Spellcast vs target, one enemy within Very Close; hit: tag **Can't lie (Tell No Lies)**, duration manual, ends when they leave Close range or refuse. `refuses`: the target (if it carries the tag) marks 1 Stress and the tag is cleared. |
| 2 | Troublemaker | `main` | Presence Roll vs target, one enemy within Far. Limit once per rest on a success (the card itself greys out). Hit: the target marks Stress = highest of Proficiency d4s (overflow marks HP, CB p.92). |
| 3 | Hypnotic Shimmer | `main` | Spellcast vs target, all enemies in front within Close (`area: front`). Limit once per rest on a success. Each hit target: tag **Stunned** (temporary), instance effect "Stunned" with flags `cannotReact` + `cannotAct` (temporary), and 1 Stress. |
| 3 | Invisibility | `main`, `spend-token` | `main`: Spellcast (10), you or an ally within Melee; on a success pay 1 Stress (after the roll), effect **Invisible** (`disadvantageAgainst attack`, ends by hand when the last token's action resolves), tokens set to Spellcast; `exclusive` (one creature at a time). `spend-token`: spend 1 token + manual reminder that the last token ends the effect. |
| 4 | Through Your Eyes | `main` | Any creature within Very Far. Self effect "Through Your Eyes" until your next rest (`endsWhen`: you cast another spell) and a manual step for the shared senses. |
| 5 | Thought Delver | `main`, `delve` | `main`: spend 1 Hope, one creature within Far, manual "the GM tells you the surface thoughts". `delve`: Spellcast vs target; hit: manual "deeper thoughts"; with Fear (success or failure): manual "the target may notice". |
| 5 | Words of Discord | `main`, `again` | Spellcast (13), one enemy in Melee. Success: the target marks 1 Stress; its attack on another adversary is manual. `again`: the same with a −5 modifier, behind a situation the player confirms ("You have cast Words of Discord on this target before"). |
| 6 | Never Upstaged | `main`, `bonus` | `main` (reaction, `whenYouMarkHp fromAttack`): mark 1 Stress, add tokens = HP marked (`triggerAmount`). `bonus` (auto, `whenYouAttack success`, on the attacked creature): `modifyDamage add 5 × tokens` (a fold into the attack's damage), then clear the tokens. |
| 6 | Share the Burden | `main` | Once per rest. One willing other creature in Melee; the player picks N ≥ 1 Stress: the target clears N, you mark N (overflow to HP, CB p.92), you gain N Hope. |
| 7 | Grace-Touched | `armor-for-stress`, `stress-for-hp` | Both require 4+ Grace cards in the loadout. `armor-for-stress` (passive): a `convertMarks stress → armor` fold for the server. `stress-for-hp` (rider on `whenTargetMarksHp`, on that target): a `convertMarks hp → stress` fold. |
| 8 | Astral Projection | `main` | Once per long rest, mark 1 Stress. Self effect "Astral Projection" until your next rest (`endsWhen`: the projection takes any damage) and a manual step for the projection. |
| 8 | Mass Enrapture | `main`, `release` | `main`: Spellcast vs target, all enemies within Far; hits are tagged **Enraptured** (temporary). `release`: mark 1 Stress; every target carrying the tag marks 1 Stress and the tag is cleared ("ending this spell"). |
| 9 | Copycat | `main` | Once per long rest. The player picks the copied card's level (1-8); Hope cost = half the level rounded up (CB p.107). Self effect "Copycat" until your next rest (`endsWhen`: they vault the card) and a manual step: use the copied feature from their card. |
| 10 | Encore | `main` | Reaction (`whenAllyDealsDamage` within Close) on the damaged creature (trigger subject). Spellcast vs its Difficulty; hit: flat damage = the ally's damage (`sameAsTrigger`, magic; no critical maximum since it is not dice). Success with Fear: the card goes to the vault. |

## Manual steps

| Card | Manual text (shortened) | Why | Page |
|------|-------------------------|-----|------|
| Invisibility (`spend-token`) | "If that was the last token, Invisibility ends once this action is resolved." | No gate reads card tokens (bead dcm-86z); the effect's duration is `manual`. | CB p.334 |
| Through Your Eyes | "You can see through the target's eyes and hear through their ears." | Narrative senses; the map does not model another creature's view. | CB p.335 |
| Thought Delver (`main`) | "The GM tells you the target's vague surface thoughts." | Information from the GM. | CB p.335 |
| Thought Delver (`delve`, hit) | "The GM tells you the target's deeper, more hidden thoughts." | Information from the GM. | CB p.335 |
| Thought Delver (`delve`, with Fear) | "At the GM's discretion, the target becomes aware…" | GM's discretion. | CB p.335 |
| Words of Discord (both uses) | "The target makes an attack against another adversary … (the GM runs it)." | The adversary's attack is the GM's action (Part B engine), not the card's. | CB p.335 |
| Astral Projection | "Your projected copy appears anywhere you've been before…" | A projection the map does not model (CA0: summons and constructs stay manual). | CB p.335 |
| Copycat | "Pick a domain card of level 8 or lower in this player's loadout; … use its feature as written." | Copying another card's entry at run time is outside the vocabulary (CA0 lists Copycat as manual by design). | CB p.335 |

Other things the engine leaves to the table (not manual steps): the end of Tell No Lies' tag when the target leaves
Close range (duration `manual`), the end of Through Your Eyes when you cast another spell and of Astral Projection when
the projection is damaged (`endsWhen` text on a `rest` effect).

## Vocabulary gaps (beads)

- **dcm-22q** Grace-Touched: no "you would mark Stress" trigger; modelled as a passive use with a `convertMarks` fold.
- **dcm-raa** Grace-Touched: only `whenTargetMarksHp` (after the marks, attacks only) for "when you would force a target
  to mark HP"; the server must offer the rider before writing HP, and for `markHp` steps too.
- **dcm-7n7** Encore: the trigger has no damage type; dealt as magic.
- **dcm-86z** Invisibility / Never Upstaged: no gate or requirement on card tokens.
- **dcm-fnq** Share the Burden: a choice's max cannot read the target's marked Stress.
- **dcm-c75** Words of Discord: no per-target "affected before" memory; a situation requirement instead.

## For CA4 / CA7 / AA1

- Uses other than `main` are picked by `useId`: `inspirational-words:tokens` runs on the long-rest event;
  `never-upstaged:bonus` runs (auto) after each successful attack and folds `+5 × tokens` into its damage; `grace-touched`
  uses only produce folds.
- Tags written: `Enraptured`, `Stunned`, `Can't lie (Tell No Lies)`. Clearing Stunned should also end the "Stunned"
  instance effect from the same use.
- Share the Burden: cap the `stress` choice at the target's marked Stress before calling `run`.

## QUESTIONS

1. **Enrapture's once-per-rest Stress** (CB p.334: "Once per rest on a success, you can mark a Stress to force the
   Enraptured target to mark a Stress as well."): offered only inside the cast, as an add-on, after a success. Should it
   also be usable later, while the target stays Enraptured?
2. **Troublemaker and Hypnotic Shimmer** ("Once per rest on a success, …", CB p.334): the whole card greys out after a
   success, since without the once-per part the roll has no effect. Fine, or should the roll stay usable (with no effect)?
3. **Mass Enrapture's release** (CB p.335: "Mark a Stress to force all Enraptured targets to mark a Stress, ending this
   spell."): it hits every creature tagged Enraptured, which includes one Enraptured by the level 1 Enrapture card. Keep
   one tag, or tag Mass Enrapture's targets separately?
4. **Encore's damage type** (CB p.335: "you deal the same damage to the target that your ally dealt"): dealt as magic.
   Should it take the ally's damage type (physical from a sword), which matters against resistance? Also, "the same
   damage" is read as the ally's damage before the target's resistance halved it.
5. **Thought Delver** (CB p.335: "Spend a Hope to read the vague surface thoughts … Make a Spellcast Roll against the target
   to delve for deeper, more hidden thoughts."): read as two uses; delving needs no Hope. Should delving also cost the Hope
   (that is, only after reading the surface)?
6. **Hypnotic Shimmer's Stunned**: written both as a tag and as an instance effect with `cannotReact` / `cannotAct`, so the
   adversary engine can refuse a Stunned adversary's actions. Keep both, or the tag only?
7. **Grace-Touched's Armor Slot** (CB p.335: "You can mark an Armor Slot instead of marking a Stress."): read as any Stress
   you mark (card costs and Stress an enemy forces on you) while you have a free Armor Slot. Confirm.
8. **Inspirational Words' range** ("When you speak with an ally"): no range (any ally); the target must be another PC,
   not yourself. Confirm.
