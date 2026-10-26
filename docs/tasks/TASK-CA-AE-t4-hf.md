# TASK AE-t4-hf: Adversary feature effects, tier 4 Hope & Fear

Plan `.omc/plans/combat-actions.yaml`, tracer AE-t4-hf (depends on AA1). Analysis:
`.omc/autopilot/combat-actions-analysis.md` Part B (git-ignored). Book pages are printed pages; CB = Core Book, HF = Hope
& Fear.

User answers this tracer implements (binding):
- **Q15** "Automate EVERY adversary feature … split by tier and source into parallel tracers": 29 adversaries, 135
  features, one entry each (`src/lib/srd/adversary-effects/t4-hf.ts`), Forlorne Lykona (Reign of the Weredragon) included.
- **Q13** the hit PC chooses Armor and allies react in a window: damage to PCs comes back from the runner as `incoming`
  hits; nothing marks HP before the window.
- **Q17 (a)** the window has no timer (nothing here depends on one).
- **Q18 (a)** no map: no range or line-of-sight checks. Areas are the creatures the GM picks; `allyWithin` holds.
- **Q19 (a)** Fear only on the GM's tap: Fear costs refuse with `confirmFear` until confirmed; reactions are one-tap
  prompts (default No); Fear gains are `auto`.

## What landed

| File | What |
|------|------|
| `src/lib/srd/adversary-effects/t4-hf.ts` | `T4_HF_EFFECTS`: 135 entries, each quoting its feature text; shared builders for Minion, Group Attack, Relentless, Relentless (X), Horde, Terrifying, the Harbingers' Mount, Forlorne's Transform and Feed on Fear, countdown uses, and a d-N branch chain (`dieBranches`). |
| `tests/unit/adversary-effects/t4-hf.test.ts` | 149 tests: the table matches the SRD exactly (29 / 135), spotlight needs, Fear costs against the printed `fearCost`, a sweep that runs every use of every entry through `run()`, and one or more runs per feature with fixed dice (costs, spotlight, trigger, targets, outcomes). |

The vocabulary types are unchanged. No Convex code.

## Rules used (quoted briefly)

- CB p.194: "For an adversary to use an action, they must have the spotlight. Passives and reactions typically don't
  require the spotlight."
- CB p.193: a feature that "doesn't specify a Difficulty" uses the adversary's Difficulty (`actorDifficulty`).
- CB p.161 (AR7) one attack roll for every target; CB p.201 (AR9) Group Attack, "Combine this damage"; CB p.199 (AR10)
  Horde (X); CB p.99 direct damage; CB p.91 Minor damage marks 1 HP.
- HF p.61, Evolution: "An adversary's evolution can't be triggered more than once in a scene." So "It's Here…" and Alpha
  to Omega carry a once-per-scene limit.
- CB p.104: "a group" is the creatures within Very Close of a point (Ground-Breaking, Grasping Vines).

## Conventions

The same as the tier 1 and tier 2 core tables, plus:
- Actions: `needsSpotlight: true`; passives, reactions and autos: `false` (a test checks it).
- Fear gains with no choice are `auto` (Q19): Horrifying, both Fearsome features, Fear the Reaper's adversary use,
  Terrifying. Other printed reactions are `reaction` prompts, also without "you can".
- A follow-up attack (Lightning Strike's bounce, Lightning Bolt) is not the use's roll, so it carries the printed ATK.
- "Mark/spend any number of …": `either` costs read back as `spent` (Wake the Fallen, Regeneration), or a `choose`
  with a `pay` per amount where a summon count needs it (Unleash the Menagerie, Plague Bringer).
- "Each PC carrying X" (Comatize's latch, Constrict's squeeze) is a use whose targets are every PC (`ANY_PC`) with a
  `targetHas` gate: per-target gates filter the use's targets, not `picked` creatures.
- A countdown read by another rule keeps its value as stat-block tokens: Diamond Hide (Difficulty + tokens). Pool-like
  token bonuses: Supercharged (Difficulty, attack, +Nd12 standard damage), Celestial Coda (+N standard damage).
- A choice in a PC save's failure branch (Breath Weapon, Stone-Cold Gaze, Gigaton Stomp, Power Slide) is that PC's own
  choice: the branch runs per PC once they rolled.
- Doubled or extra damage taken by the adversary (Necroplasmic, Nebulous Transformation, Segmented) is a `modifyDamage`
  fold on an `onDamaged` `would` trigger, like the tier 2 Heavily Armored's `reduceDamage`.

## Every feature and its reading

Legend: A action, R reaction, Au auto, P passive; S = needs the spotlight; costs in brackets. "save" = a PC reaction roll
prompt per PC (Difficulty = the adversary's unless printed).

| Adversary (HF p.) | Feature | Reading |
|---|---|---|
| Cephilith Abomination (90) | Toxic Skin | R on the situation "contact": d6 ≤ 3 → choose Armor Slot or 2 HP (the PC). |
| | Bear Hug | A S [Stress]: attack, standard damage + Grappled (tag implying Vulnerable, Restrained) until a Strength Roll. |
| | Crunch! | A S [Fear]: 4d12 direct physical, gated on the target being Grappled. |
| | Tongue Attack | A S [Fear]: pull to Melee, spotlight itself again. |
| | Burrowing Leechpoles | R on Major+ damage: PCs in Close save Agility; fail → Leechpoles tag + manual 2d4 / +1 damage each. |
| Cephilith Hatchling (90) | Minion (12) | P `minion 12`. |
| | Comatize | A S [Fear]: Stress + Comatized tag; Au on any failure with Fear: every Comatized PC marks a Stress; R "the PC dies" [Fear]: summon a Cephilith Novitiate. Death move on the last Stress manual. |
| | Group Attack | A S [Fear]: shared roll, 9 physical each. |
| Cephilith Novitiate (90) | Minion (12) | P `minion 12`. |
| | Group Attack | A S [Fear]: 12 physical each. |
| | Sacrifice Self | A S [Fear]: move to target, 12 direct magic, defeat itself. |
| Cephilith Priest (90) | Psychic Blast | A S [Fear]: up to 3 PCs save Knowledge: fail 4d10+10 direct magic + Vulnerable until spotlighted; success 2d10+5 direct magic. |
| | Cerebral Incursion | A S [Fear]: save Strength only if the target is Vulnerable; fail → 1d6 Stress, the Priest clears the roll. |
| | Telekinetic Grasp | R on a standard-attack hit [Stress]: Restrained until they spend a Hope. |
| Cephilith Titan (91) | Relentless (X) | P with a manual note (X = number of PCs). |
| | Terrifying | Au on a hit: PCs in Close lose a Hope, GM +1 Fear. |
| | Merely a Projection | P: immune physical, resistant magic. |
| | Psychic Scream | A S [Fear]: PCs in Far save Instinct (22): fail 4d12 direct magic; success a Stress. |
| | Summon Worshippers | A S [Fear]: summon 1d4 Outer Realms Abominations (Far), spotlight one. |
| | “It’s Here…” | Au on crossing half HP, once per scene: clear all HP; drop Merely a Projection (manual). Au "full form" on a standard-attack HP mark: +1 HP. |
| Cipactli (91) | Relentless (3) | P. |
| | Many Mouths | A S [Stress]: attack all in Very Close, standard damage + a Stress on hit. |
| | Frenzied Feeding | A S [Fear]: PCs in Close save Instinct or 4d6 direct physical; HP per Severe manual. |
| | Quaking Footfalls | A S [Stress]: PCs in Far save Agility: fail 2 Stress + Vulnerable until damaged; success a Stress. |
| | Lifeblooded | R on Severe damage: every creature in Close temporarily Restrained. |
| | Verdant Explosion | R on its last HP: manual (scene change). |
| Cloud Titan (91) | Lightning Strike | A S [Stress]: attack Far, 4d10+14 magic; d6 ≥ 4 → follow-up attack (ATK +3) in Very Close for 4d10+14 − 1d10; later bounces manual. |
| | Mist Weaver | A S [Fear]: Hidden until it marks HP; advantage in the fog manual. |
| | Nebulous Transformation | A S [Stress]: effect "physical immunity" until it drops out or takes Severe; Au "double magic" while in form. |
| | Unleash the Menagerie | A S, once per scene: choose 1–5 Stress, summon as many Griffins (Close). |
| | Wind Worker | A S [Fear]: 4d6+8 physical (no roll), pushed to Far. |
| | Double or Nothing | R on a PC's attack roll with Fear against it: d6 odd → GM −1 Fear, even → +1. |
| Demon Lord Berzug (92) | Relentless (3) | P. |
| | Chaos Lash | A S [Stress]: up to 3 PCs save Agility: 4d20 physical, half on success. |
| | Gaze into the Abyss | A S [Fear]: save Presence; fail → d6: 1–2 Mesmerized (move to Melee; tag implying Vulnerable, Restrained), 3–4 Confused (tag + manual), 5–6 Enthralled (tag + manual). |
| | Crushing Strike | R on a standard-attack HP mark [Stress]: Stress equal to the HP marked; GM +1 Fear. |
| | Horrifying | Au on a failed attack against it: GM +1 Fear. |
| Dragon Mother Mitera (92) | Relentless (3) | P. |
| | Diamond Hide | Au on appearing: countdown 7 + 7 tokens; P Difficulty + tokens; R on trigger: Vulnerable + effect +2 attack. |
| | Elemental Breath | A S [Stress]: choose a head (1 Fire 4d12 to 1d4+1 targets + manual Armor/2 HP; 2 Lightning 4d12 to 1d6; 3 Acid save: 2 Armor + 2 HP / 1 + 1; 4 Poison Sickened + manual; 5 Ice 4d8+8 + Restrained + manual area; 6 Darkness Vulnerable + manual; 7 Light 28 direct magic in a line). |
| | Tail Swipe | A S [Fear]: attack all in Close: 2d20+10 + knock back; misses mark a Stress; Vulnerable after HP manual. |
| | Fearsome | Au on a hit; Au on a PC failing any roll in Far: GM +1 Fear each. |
| | Seven-Headed | R on damage: d8 = 8 → tick Diamond Hide (−1 token); else choose remove the head (manual) or "already removed" → tick. |
| Fire Titan Warlord (93) | Relentless (2) | P. |
| | Colossus Crafter | Au on appearing: countdown 6; Au tick on its spotlight; R on trigger: summon the Gargantuan War Machine, spotlight it. |
| | Release the Hounds | A S [Fear]: summon 2 Demonic Hound Packs (Close), spotlight them. |
| | Spinning Strike | A S [Stress]: attack all in Very Close, standard damage; GM +1 Fear. |
| | Ground-Breaking | A S [Fear]: attack a group in Close, 4d10+10 direct physical; rough terrain manual. |
| Forlorne Lykona, Dragon Form (143) | Relentless (4) | P. |
| | Transform | A S [Stress]: manual stat-block swap. |
| | Feed on Fear | R on a PC failing with Fear in Close: choose clear a HP or a Stress. |
| | Flying | P while flying: +3 Difficulty, `flying`. |
| | Terrifying | Au on a hit: PCs in Far lose a Hope, GM +1 Fear. |
| | Breath Weapon | A S [2 Fear]: PCs in Close save Presence; fail → choose 3 Stress or Weredrake Curse (tag + manual). |
| | Tail Swipe | R on marking 1+ HP from an attack in Very Close [Stress]: 2d10+10 physical to every creature in Very Close. |
| Forlorne Lykona, Faun Form (142) | Relentless (4), Transform, Feed on Fear | As the Dragon Form. |
| | Battle Teleport | R before / R after its standard attack [Stress]: teleport within Far. |
| | Grasping Vines | A S [Fear]: a group in Far saves Agility; fail 2d8+7 magic + Restrained. |
| | Stone-Cold Gaze | R on damage from an attack in Close [2 Fear]: the attacker saves Instinct; fail → choose 3 Hope or Petrified Curse (tag implying Restrained, Vulnerable + effect cannotAct, +10 thresholds). |
| Gargantuan War Machine (93) | Relentless (3) | P. |
| | Awesome Size | Au on appearing: manual per-PC choice (Hope or 1d4 Stress). |
| | Rocket Punch | A S [Stress]: attack Close, 4d12+10 direct physical + 2 forced Armor Slots. |
| | Ground-Breaking Stomp | A S [Fear]: attack all within Close of a point: 4d12 direct physical + Vulnerable until spotlighted; rubble manual. |
| | Supercharged | R on its first spotlight (scene): countdown Loop 2d6; Au tick on spotlight; R trigger: +1 token; P per token +1 Difficulty, +1 attack, +1d12 standard damage; Au on Severe damage: −1 token. |
| Ghastly Legion (93) | Horde (2d6+5) | P. |
| | Necroplasmic | P immune physical; Au on would-take magic damage: ×2 fold. |
| | Final Act | R when defeated: attack all in Close, standard damage. |
| Griffin (93) | Treasure Hoarder | Au on a hit: manual (gold instead of HP). |
| | Swooping Slash | A S: move to Far, standard attack. |
| Hallowed Choir (93) | Horde (2d10) | P. |
| | Celestial Coda | Au on appearing: countdown Loop 3; Au tick on a PC gaining Hope; R trigger: +1 token; P +tokens standard damage. |
| | Aural Assault | A S: (tokens)d12 direct magic to every enemy in Close, then clear the tokens. |
| Harbinger of Death (94) | Relentless (3) | P. |
| | Mount | P +2 Difficulty while mounted; Au on Severe damage while mounted: manual fall; A S [Stress]: the mount returns (manual). |
| | Fear the Reaper | Au on an adversary defeated in Far; R "a PC is defeated in Far": GM +1 Fear. |
| | Decapitate | A S [2 Fear]: attack Melee; on a hit d6 = 6 → manual all HP + death move. |
| | Wake the Fallen | A S [Fear + 1–6 Stress]: the ally rises (manual), clears HP = Stress, spotlight it. |
| | Ashes to Ashes, Dust to Dust | R when it would mark HP [Stress]: redirect to a picked ally in Far. |
| Harbinger of Famine (94) | Relentless (2), Mount | As above. |
| | Hunger Pangs | Au on appearing: countdown 6 (loop); Au tick on spotlight; R trigger: PCs in Far mark a Stress + Ravenous tag + manual; decreasing restart manual. |
| | Drain Essence | A S [Fear]: up to 3 PCs (any range) take 4d6 magic. |
| | Too Many Mouths | A S [Stress]: attack Melee, 4d6 physical + Restrained. |
| | Withering Touch | A S [Fear]: gated on Restrained: 2 Stress + choose lose a Hope or 1d4 HP (the PC). |
| Harbinger of Pestilence (94) | Halo of Contagion | Au on a PC's action roll in Very Close: d6 = 1 → Contagious tag + manual. |
| | Mount | As above. |
| | Locust Swarm | A S [2 Fear]: manual per-PC choice (Armor Slot or 4d10 direct + d6). |
| | Frog Spawn | A S [Fear]: up to 3 PCs save Presence; fail 4d12 magic + d6 ≤ 3 Contagious. |
| | Plague Bringer | A S: choose 1–8 Stress, summon N×1d4 Zombie Legions (Far), spotlight one. |
| Harbinger of War (95) | Relentless (2), Mount | As above. |
| | Iron Dice | A S [Stress]: standard attack with advantage; hit +1 HP; failure → itself Vulnerable until it takes or deals damage. |
| | Supreme Commander | A S, once per scene [Fear]: summon 1d6 Hallowed Soldiers, spotlight one. |
| | Battering Ram | R on a PC's failed action roll in Close [Fear]: move to Melee, standard attack with advantage, Vulnerable until spotlighted. |
| Owl Witch (95) | Ill Omen | Au on a PC's action roll in Close: manual (Fear Die + GM Fear). |
| | Witch Barrier | P resistant magic. |
| | Voice Mimicry | A S [Fear]: any creature saves Instinct or moves up to Far toward it. |
| | Nightmare Stare | A S [Fear]: save Knowledge; fail → Afflicted tag + manual. |
| | Visions of a Violent End | R when targeted [Fear]: the attacker saves Presence or marks 1d4 Stress. |
| Ruby Dragon (95) | Relentless (3) | P. |
| | Fearsome | Au on a hit; Au on a PC failing an action roll in Far: GM +1 Fear. |
| | Melting Breath | A S [Stress]: PCs in front in Close save Agility; fail 4d12+10 magic + forced Armor Slot. |
| | Volcanic Fissure | A S [Fear]: save Agility: fail 4d8+5 magic, success move out; lasting lava manual. |
| | Hot-Blooded | R on a successful attack from Very Close: the attacker marks an Armor Slot; 1d4 HP fallback manual. |
| Severed Shadow (95) | Minion (12) | P. |
| | Shadow Grapple | A S [Stress]: attack Close; hit → Vulnerable + tag until it's defeated; Stress per action manual. |
| | Group Attack | A S [Fear]: 10 magic each. |
| Supreme Demiurge Adonix (96) | Relentless (4) | P. |
| | Elemental Archon | A S [Stress]: d4 branches: 1 Fire Beam save (Severe / Minor manual); 2 Thunderclap every creature in Far: Stress + Vulnerable; 3 Lightning Bolt attack (ATK +8) 4d8 magic, even chain manual; 4 Ice Storm save Strength: 1d4 Stress + Restrained until a Hope. |
| | Alpha to Omega | Au when defeated, once per scene: manual rise; clear all HP and Stress; PCs in Very Far save Presence: fail lose a Hope, GM +1 Fear. |
| | Forsaken | A S [Fear], Omega only: countdown 1d8 on a PC + Forsaken tag; Au tick on spotlight; Au end on Severe damage. |
| | Armageddon | R when defeated, Omega only: d6 ≥ 5 → manual death moves for every PC. |
| Temporal Enforcer (96) | Relentless (2) | P. |
| | Time Looper | Au on appearing: countdown Loop 2d6; Au tick on spotlight; R trigger: clear all HP, Stress and the standard conditions (tags manual); Au on Severe damage: restart with a new 2d6. |
| | Move Between Moments | A S [Stress]: teleport within Very Far, spotlight again. |
| | Instant Rewind | R on a miss [Fear]: reroll fold. |
| | Invert Polarity | R on the situation "any die rolled (not a critical success)", 3 per scene [Fear]: `setResult` fold to the obverse face. |
| Water Mother (96) | Segmented | R on would-take damage from an attack, the GM confirms the Head was in range: +1d10 fold. |
| | Eat the World | A S [Fear]: PCs in Close save Strength: Stress + pull; second use "attack" (A S, no cost): standard attack on all in Melee. |
| | Constrict | A S [Stress]: attack all in Melee, 4d8+8 physical + temporarily Restrained; R at the GM turn's start [Stress]: every Restrained target marks a HP. |
| | Venom Surge | R on a standard-attack hit [Fear]: Vulnerable for the scene. |
| Wyrmfiend (97) | Minion (13) | P. |
| | Venomous Bite | A S [Fear]: attack Melee, 4d4+4 physical + Poisoned tag; the d6 rider manual. |
| | Group Attack | A S [Fear]: 11 physical each. |
| Wyrmlings (97) | Horde (2d6+5) | P. |
| | Ravenous | R on a PC marking HP from its attack [Fear]: spotlight itself; once per GM turn manual. |
| | Overwhelm | R on marking at most 1 HP from an attack in Melee [Stress]: standard attack with advantage on the attacker. |
| Xero the Castle Killer (97) | Relentless (X) | P with a manual note. |
| | Collateral Damage | P `cannotBeRestrained`. |
| | Gigaton Stomp | A S [Fear]: PCs in Melee 4d12 physical + Restrained; follow-up: every creature within Close saves Instinct; fail → knock back + choose Armor Slot or 4d12 (the target). |
| | Power Slide | A S [Stress]: move to Close; PCs on the path save Strength; fail → choose 2 Armor Slots or Severe damage (manual). |
| | Radioactive Breath | A S [Fear] "charge", once until refreshed: +1 token; A S "beam" (needs a token): spend it, PCs in a line save Agility: 4d12+12 direct magic / half; Au on Severe damage: refresh the charge. |
| | Regeneration | A S, 3 per scene [1–12 Fear]: clear that many HP. |

## Manual steps

Narrative (no rule to automate, no bead): Verdant Explosion (p.91); Collateral Damage's destroyed terrain (p.97);
Segmented's segment positions (no map, Q18); Mount's fall and return as a GM-confirmed state (p.94).

Vocabulary gaps (one bead each; reused where another tracer filed the same gap):

| Feature (HF p.) | Manual step | Reason | Bead |
|---|---|---|---|
| Relentless (X) ×2 (91, 97) | X = number of PCs | `relentless` takes a fixed number | dcm-gx1 (reused) |
| Burrowing Leechpoles (90) | 2d4 leechpoles, +1 damage each | No tokens on a PC | dcm-xp0 (reused) |
| Comatize (90) | Death move on the last Stress | No forced death move | dcm-702 (reused) |
| Decapitate (94), Forsaken (96), Armageddon (96) | Mark all HP, death moves | Same | dcm-702 (reused) |
| “It’s Here…” (91), Transform ×2 (142, 143), Seven-Headed / Elemental Breath (92) | Drop a feature, swap the stat block, remove a breath option | No evolution step | dcm-gx3 (reused) |
| Frenzied Feeding (91), Tail Swipe (Mitera, 92) | HP per Severe damage; Vulnerable after marking HP | Severity and HP are known after the window | dcm-sos (reused) |
| Lightning Strike (91), Lightning Bolt (96) | Further bounces / the even-dice chain | No repeating attack chain | dcm-7az (reused) |
| Mist Weaver (91) | Advantage against creatures in the fog | No attack modifier keyed to the target | dcm-xyw (reused) |
| Gaze into the Abyss (92) Confused; Elemental Breath Poison (92); Hunger Pangs' Ravenous (94); Halo of Contagion (94); Nightmare Stare (95); Shadow Grapple (95); Venomous Bite (97) | The rider on the bearer's own rolls or actions | No lasting condition with a rider on the bearer | dcm-kti (reused) |
| Gaze into the Abyss (92) Enthralled; Breath Weapon (143) Weredrake Curse | The PC under the GM's control | No such step | dcm-idz (new) |
| Elemental Breath Fire (92), Awesome Size (93), Locust Swarm (94) | Each PC's own choice outside a save | No per-recipient choice | dcm-bz8 (reused, card-effect bead) |
| Elemental Breath Ice / Darkness (92), Ground-Breaking (93), Ground-Breaking Stomp (93), Volcanic Fissure (95) | The lasting area | No lasting area hazard | dcm-wuu (reused) |
| Hunger Pangs (94) | Restart one lower | No decreasing countdown | dcm-m5s (reused) |
| Halo of Contagion (94) | The Harbinger is itself Contagious | A passive can't put a condition on itself | dcm-cdz (reused) |
| Plague Bringer (94) | At most as many Stress as PCs | No source counting creatures | dcm-ttz (reused) |
| Wake the Fallen (94), Alpha to Omega (96) | A defeated adversary rises | No step restoring a defeated adversary | dcm-145 (reused) |
| Treasure Hoarder (93) | Gold instead of HP | No option an adversary feature offers the PC | dcm-6ju (reused) |
| Hot-Blooded (95) | 1d4 HP without a free Armor Slot | No fallback for a full Armor track | dcm-18i (reused) |
| Ill Omen (95) | Fear Die + the GM's Fear | No modifier on one duality die | dcm-3ou (new) |
| Elemental Archon Fire Beam (96), Power Slide (97) | "take Severe / Minor damage" | No number source for a target's threshold | dcm-a7o (reused) |
| Ravenous (97) | Once per GM turn | No GM-turn limit | dcm-c5h (new) |
| Forsaken (96) | Only one Forsaken Countdown at a time | No "one target at a time" | dcm-vkp (reused) |

## Notes for AA2 / AA6 (runner and server behaviour found while testing)

1. **Prompt numbers can't read `spent`.** `adversaryNumberEnv` has no `spent`, so a summon count "equal to the Stress
   marked" would resolve to 0. Unleash the Menagerie and Plague Bringer use a `choose` with a `pay` per amount instead.
2. **Per-target gates filter the use's targets, not `picked`.** A step `to: "picked"` with `when: targetHas` is skipped
   when the use has no targets. "Every PC carrying X" uses `targets: ANY_PC`; the server passes the party.
3. **A follow-up's count isn't rolled.** Elemental Breath's "1d4+1 targets" / "1d6 targets" are a follow-up `upTo` with
   dice; the runner takes `followUp` creatures as given. The server should roll the count and ask for that many.
4. **`modifyDamage` folds on the adversary's incoming damage** (Necroplasmic ×2, Nebulous Transformation ×2, Segmented
   +1d10) come back as folds; the server applies them before marking, like Heavily Armored's `reduceDamage`.
5. **Supercharged's +Nd12** is an `attackDamage` add with dice: `passiveSummary` rolls it with the RNG it gets (default
   1s). AA2 should summarize with the attack's RNG (one roll per attack).
6. **Eat the World** has two uses: the inhale (PC saves) and the attack once the saves resolved, in the same spotlight.
7. **Radioactive Breath's recharge** is a `refreshFeature`; it should drop `adversaryFeatureUseKey("xero-the-castle-killer",
   "Radioactive Breath", "charge")`.
8. Adonix's Omega form, the Titan's full form, Cloud Titan's misty form, Harbingers' mounts and Forlorne's flying are
   `situation` requirements the GM confirms; AA2 needs a way to keep them on the instance (or ask).

## QUESTIONS (rule readings for the user)

1. **Fear gains printed as reactions** (Horrifying, HF p.92: "When a PC fails an attack against Berzug, you gain a
   Fear."; Fearsome, HF p.92) are automatic (Q19: Fear gains automatic). OK, or one-tap prompts like other reactions?
2. **Mandatory printed reactions** without "you can" (Lifeblooded p.91, Burrowing Leechpoles p.90, Seven-Headed p.92,
   Final Act p.93, Hot-Blooded p.95, Armageddon p.96, Supercharged's activation p.93) are one-tap prompts like the tier 2
   table's. Or automatic?
3. **Mount** (HF p.94): "their mount disappears until you mark a Stress to summon it again." Read as an action on the
   Harbinger's spotlight. Or at any time?
4. **Double or Nothing** (HF p.91): "On an odd result, you don't gain the Fear. On an even result, you gain 2 Fear instead
   of 1." Read as the roll's Fear gained first, then −1 (odd) or +1 (even). Confirm.
5. **Lightning Strike** (HF p.91): "Each time the lightning bounces, decrease the damage it deals by 1d10." Read as
   4d10+14 minus a rolled 1d10 (then minus another 1d10 per later bounce), not 3d10+14. Confirm.
6. **Iron Dice** (HF p.95): "On a success, the target marks an additional HP." Marked directly on a hit, even when armor
   brings the damage to 0 HP? Or only if they marked HP from the attack?
7. **Collateral Damage** (HF p.97): "movement can't be hindered, impeded, or affected by anything other than natural
   terrain" read as "can't be Restrained" (plus the fiction). OK? Should forced movement (knock back, pull) also fail?
8. **Overwhelm** (HF p.97): "take Minor damage" read as marking exactly 1 HP (CB p.91). OK?
9. **Plague Bringer** (HF p.94): "For each Stress you mark, the Harbinger summons 1d4 … and immediately spotlights one of
   them." Read as one Legion spotlighted in all (not one per Stress). Confirm.
10. **Supercharged** (HF p.93): "When the Machine is spotlighted for the first time" read per scene (as the tier 1 Head
    Guard). OK?
11. **Halo of Contagion** (HF p.94): "When a PC … takes an action" read as making an action roll. OK?
12. **Diamond Hide** (HF p.92): when it triggers, Mitera "becomes Vulnerable and gains a +2 bonus to attack rolls": stored
    as permanent for the encounter. OK?
13. **Gigaton Stomp** (HF p.97): "Each creature beyond Melee range but within Close range" includes Xero's allies (any
    creature). OK?
14. **Alpha to Omega** (HF p.96): a PC with no Hope who fails loses nothing, so the GM gains no Fear for them (the gate on
    a PC's Hope is dcm-5xi; the engine just gains a Fear per failure). Should a failure with 0 Hope still give a Fear?
15. **Unleash the Menagerie / Plague Bringer**: "any number of Stress" is capped by the Stress track (5 / 8 options);
    Plague Bringer's "up to the number of PCs" is left to the GM. OK?
