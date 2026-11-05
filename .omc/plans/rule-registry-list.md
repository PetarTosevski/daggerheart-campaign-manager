# Rule registry: every rule the app applies by itself (for the user to check)

Bead: dcm-jh6d, part A ("homebrew vs automation"). Nothing here is built yet. This is the list to approve first.

**What the registry is.** Campaign settings > House rules gets one row per rule below. The GM picks a mode per campaign:

- **Book**: the app does what the book says (today's behaviour).
- **Variant**: a named alternative the app also knows how to do (printed in a book unless marked *not in the books*).
- **Manual**: the app stops doing it. Where it used to act, it shows the GM a reminder or a question instead
  ("Gain 1d4 Fear for the short rest?").

**"Book only (recommended)"** means a Manual mode would break the app or make no sense (for example: who won the
dice roll). Those rows are listed so you know the app does them, but they would show no switch.

**Page numbers** are the printed page numbers, checked in the book text. CB = Core Book, HF = Hope & Fear (Expansion).

**Not in this list.** The hundreds of card, class feature, ancestry and adversary texts the app runs ("Spend 3 Hope to
halve physical damage", "the Ogre's attacks deal direct damage"). Those are content, not rules: changing them is
part B (copy a card or adversary into the campaign and edit its numbers). Only the general rules are here.

---

## Already decided (not re-proposed here)

You confirmed these on 2026-10-30 (bead dcm-bxp.134). Each becomes its own on/off switch, off by default except
Defined Ranges:

| Optional rule | Book |
|---|---|
| Massive Damage (damage of double the Severe threshold marks 4 HP; PCs and adversaries) | CB p.91 |
| Spotlight Tracker (3 action tokens per PC) | CB p.89 |
| Falling and collision damage (GM quick button) | CB p.168 |
| Underwater combat (disadvantage, breath countdown, Stress per action) | CB p.168 |
| Gold coins (10 coins = 1 handful) | CB p.104 |
| Fate rolls | CB p.168 |
| Conflict between PCs | CB p.168 |
| Horizon encounter Hope / Fear bonuses | HF p.171 |
| Shared domain cards | CB p.21 |
| Defined Ranges (square counting, range hints and checks), **default ON** | CB p.103 |
| Already built, turning to off by default: Remnant Corruption (CB p.295), Endurance Countdowns (HF p.176), Less Lethal (HF p.127), Transformations (HF p.34) | |

**Already a campaign setting today** (Campaign settings > At the table / Sessions; no new switch needed):
Fear at session start: carry over (book, CB p.154) or one per PC · Out-of-range attack: ask the GM or refuse ·
Players see the Fear pool · Witherwild: Wither tokens stay across sessions (house rule against CB p.261) ·
each long-term countdown: tick automatically on a long rest or only remind (CB p.164).

---

## How to read the tables

★ = recommended for the first batch. "Code" is where the rule lives today.

## 1. Rolls & dice (11 rules)

| # | Rule | What you see at the table today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| R1 | Who won the roll | Two d12s roll (Hope and Fear). The higher one decides "with Hope" or "with Fear"; total against the Difficulty decides success. | CB p.90 | `src/lib/domain/duality.ts` | Book only (recommended): every other rule reads this. |
| R2 | Matching dice = critical | Doubles always succeed; the player also gains 1 Hope and clears 1 Stress. | CB p.90: "both dice roll the same number, that is a critical success … you also clear a Stress" | `src/lib/domain/dice/index.ts` (`dualityEffects`) | Book only (recommended) |
| R3 | Hope and Fear from rolls | Roll with Hope: the player's Hope goes up by 1 by itself. Roll with Fear: the GM's Fear goes up by 1 by itself. | CB p.154: "Whenever a PC rolls with Fear, you gain a Fear." | `src/lib/domain/dice/index.ts`, `convex/rolls.ts` | Book · Manual (the GM sees "+1 Fear?" and confirms) |
| R4 | Reaction rolls give nothing | A reaction roll (dodge the trap) gives no Hope or Fear and nobody can help. | CB p.99: "they don't generate Hope, Fear, or additional GM moves" | `src/lib/domain/dice/index.ts` | Book only (recommended) |
| R5 | Advantage and disadvantage | Advantage adds a d6, disadvantage takes one away; one cancels one; helpers' dice: only the highest counts. | CB p.100: "Advantage and disadvantage always cancel each other out" | `src/lib/domain/dice/index.ts` (`advantagePlan`) | Book only (recommended) |
| R6 | Experiences cost Hope | Adding an Experience (+2) to a roll takes 1 Hope per Experience. | CB p.90: "You can spend a Hope to use one of your relevant Experiences" | `src/lib/domain/dice/index.ts` (`experienceBonus`) | Book only (recommended) |
| R7 | Help an Ally | A helper pays 1 Hope and adds a d6 to a friend's roll. | CB p.90: "Any number of PCs can Help an Ally as long as they spend a Hope" | `convex/lib/rolls.ts` | Book only (recommended) |
| R8 | Tag Team roll | 3 Hope, once per session per player; both roll, the starter picks which roll counts for both. | CB p.90: "spend three Hope to initiate a Tag Team Roll"; CB p.97 | `convex/rolls.ts` (`tagTeam`) | Book only (recommended) |
| R9 | Hope cap | A character holds at most 6 Hope (minus one per scar). Extra Hope is lost. | CB p.90: "you can only hold a maximum of 6 Hope at a time" | `src/lib/domain/characters/index.ts` (`hopeMax`) | Book only (recommended) |
| R10 | Critical damage | A critical attack starts from the dice's maximum, then rolls the dice again on top (PCs and adversaries). | CB p.98: "Start with the highest possible value the damage dice can roll, and then make a damage roll as usual"; CB p.148 for the GM | `src/lib/domain/dice/index.ts` (`rollDamage`), `src/lib/domain/adversary-actions/attack.ts` | Book only (recommended) |
| R11 | Adversary attack roll | The GM's attack is one d20 + the attack bonus against the PC's Evasion; a natural 20 always hits and crits; advantage = an extra d20, keep the best. | CB p.160: "You make your attack roll with a d20"; CB p.148: "Whenever you roll a 20 on the d20, your roll automatically succeeds" | `src/lib/domain/adversary-actions/attack.ts`, `convex/adversaryActions.ts` | Book only (recommended) |

## 2. Hope & Fear (5 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| F1 | Fear cap | The GM's Fear pool stops at 12. | CB p.154: "You can hold up to a maximum of 12 Fear." | `src/lib/domain/fear/index.ts` | Book only (recommended) |
| F2 ★ | Fear from rests | When the GM finishes a rest, the app rolls and adds Fear: short rest 1d4, long rest 1d4 + number of PCs present. | CB p.105: "On a short rest, they gain 1d4 Fear. On a long rest … 1d4 + the number of PCs" | `src/lib/domain/rest/index.ts` (`restFear`), `convex/rests.ts` | Book · **Variant "Extended downtime"** (several days pass: 1d6 Fear per PC, CB p.181: "You gain 1d6 Fear per PC") · Manual (the rest summary tells the GM "Gain 1d4 Fear"; the GM adds it) |
| F3 ★ | Extra adversary spotlight costs Fear | In the encounter tracker, the first adversary the GM spotlights in a GM turn is free; each further one takes 1 Fear by itself (refused with 0 Fear). | CB p.153: "You can spend a Fear to make an additional GM move, shifting the spotlight to another adversary" | `src/lib/domain/encounters/spotlight.ts`, `convex/encounterTracking.ts` | Book · Manual (the tracker counts and warns, the GM spends Fear by hand) |
| F4 | Adversary Experience costs Fear | Adding an adversary's Experience to its roll takes 1 Fear. | CB p.154: "you can spend a Fear and add the Experience's modifier to the roll" | `convex/adversaryActions.ts` | Book only (recommended) |
| F5 | Fear features cost Fear | Using an adversary's or environment's "Spend a Fear to …" feature takes the Fear from the pool. | CB p.154: "Use an adversary's Fear Feature. → Use an environment's Fear Feature." | `convex/environmentActions.ts`, `convex/lib/fear.ts` | Book only (recommended) |

## 3. Damage & thresholds (8 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| D1 | Damage to Hit Points | Damage is compared with the target's two thresholds: below Major marks 1 HP, Major 2, Severe 3 (PCs and adversaries). | CB p.91: "Severe damage is equal to or above your Severe threshold; you mark 3 HP" | `src/lib/domain/combat-actions/damage.ts`, `src/lib/domain/encounters/damage.ts` | Book only (recommended). Massive Damage is the decided switch. |
| D2 | Resistance and immunity | A resistant target takes half (rounded up) before the thresholds; an immune one takes nothing. | CB p.99: "they halve damage of that type before comparing it to their damage thresholds"; CB p.107: "round up unless otherwise specified" | `src/lib/domain/encounters/damage.ts` (`damageTaken`) | Book · Manual (full damage applied; the GM is told "Target resists: halve?") |
| D3 | Direct damage | Damage marked "direct" can't be reduced with armor; the armor prompt doesn't appear. | CB p.99: "Direct damage is physical or magic damage that Armor Slots can't be used to reduce." | `src/lib/domain/adversary-actions/severity.ts` | Book only (recommended) |
| D4 | Stress overflow | If a creature must mark Stress with a full Stress track, it marks 1 Hit Point instead. | CB p.92: "your slots are already full, you must instead mark 1 Hit Point" | `src/lib/domain/combat-actions/damage.ts`, `convex/encounterTracking.ts` | Book · Manual (the extra Stress is dropped; the GM is told "Stress full: mark 1 HP?") |
| D5 ★ | Full Stress = Vulnerable | When every Stress box is marked, the character or adversary shows Vulnerable, and attacks against it get advantage by themselves. | CB p.92: "When you mark your last Stress, you become Vulnerable … until you clear at least 1 Stress"; CB p.178 for adversaries | `src/lib/domain/characters/index.ts`, `src/lib/domain/encounters/damage.ts` (`vulnerableFromStress`) | Book · Manual (a "Stress full" badge only; the GM adds Vulnerable by hand) |
| D6 ★ | Minions | Any damage defeats a Minion; every X damage defeats one more Minion, and the **attacker** picks which. | CB p.201: "defeated when they take any damage. For every X damage a PC deals to this adversary, defeat an additional Minion" | `src/lib/domain/combat-actions/damage.ts`, `convex/combatActions.ts` (`pickMinions`) | Book · **Variant "GM picks the extra Minions"** (*not in the books*: the book doesn't say who picks) · Manual (only the hit Minion falls; the GM removes others) |
| D7 | Hordes | A Horde with half or more of its HP marked deals its lower Horde damage. | CB p.199: "When the Horde has marked half or more of their HP, their standard attack deals X damage instead." | `src/lib/domain/adversaries/index.ts`, `src/lib/domain/encounters/damage.ts` | Book only (recommended) |
| D8 | Adversary defeated at last HP | An adversary whose last HP is marked is shown defeated and loses its turn in the tracker. | CB p.208: "When an adversary marks their last Hit Point, they are defeated" | `src/lib/domain/encounters/damage.ts` | Book · Manual (stays up until the GM marks it defeated) |

## 4. Armor (3 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| A1 ★ | Armor Slots soften a hit | When a PC is hit, they get a prompt: mark one Armor Slot to drop the damage one step (Severe → Major → Minor → none). At most one slot per attack. | CB p.114: "negate some (or all) of it by marking an available Armor Slot"; CB p.19: "You can only mark one Armor Slot per attack" | `src/lib/domain/adversary-actions/severity.ts`, `convex/lib/incomingHits.ts` | Book · Manual (no prompt; damage lands in full and the player marks armor and fixes HP on the sheet) |
| A2 | Thresholds from armor + level | Each PC's thresholds are the armor's numbers plus their level. | CB p.111: "you always add their current level to their damage thresholds" | `src/lib/domain/characters/index.ts` (`damageThresholds`) | Book only (recommended) |
| A3 | Unarmored | With no armor: Armor Score 0, Major = level, Severe = twice the level. | CB p.114: "their Major threshold is equal to their level, and their Severe threshold is equal to twice their level" | `src/lib/domain/characters/index.ts` | Book only (recommended) |

## 5. Conditions (4 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| C1 ★ | Conditions change the dice | Attacking a Vulnerable target gets advantage by itself; attacking a Hidden (or Cloaked) target gets disadvantage by itself. | CB p.102: "While Hidden, any rolls against you have disadvantage" / "While you are Vulnerable, all rolls targeting you have advantage." | `convex/lib/combatActions.ts` (`conditionEdge`), `convex/lib/adversaryActions.ts` | Book · Manual (badges only; the roller adds the d6 by hand) |
| C2 ★ | Hidden / Cloaked end on the map | A Hidden or Cloaked PC who attacks, or ends a move where an enemy can see them, loses it (in dim light the rogue rolls to keep Cloaked). | CB p.102: "After an adversary moves to where they would see you, you move into their line of sight, or you make an attack, you are no longer Hidden." | `convex/lib/combatMovement.ts`, `convex/combatTokens.ts`, `convex/cloakPrompts.ts` | Book · Manual (the GM gets "Does Mira lose Hidden?" instead) |
| C3 | Conditions don't stack | Turning a condition on twice does nothing. | CB p.102: "the same condition can't be stacked" | `convex/characters.ts`, `convex/encounterTracking.ts` | Book only (recommended) |
| C4 | Unconscious | An unconscious PC can't act or be attacked; they wake when an ally clears their HP or on a long rest. | CB p.106: "they return to consciousness when an ally clears 1 or more of their marked Hit Points or when the party finishes a long rest" | `src/lib/domain/rest/index.ts`, `src/lib/domain/death/index.ts` | Book only (recommended) |

Note: Restrained is shown as a badge only; the map does not stop the token. Nothing to switch.

## 6. Rests & downtime (5 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| T1 | Two moves per rest | Each PC picks exactly two downtime moves (the same one twice is fine). | CB p.105: "choose two of the following moves (or choose the same move twice)" | `src/lib/domain/rest/moves.ts`, `src/lib/domain/rest/index.ts` | Book only (recommended) |
| T2 ★ | Short-rest limit | A fourth short rest in a row is refused; the party must take a long rest. | CB p.105: "A party can take up to three short rests before their next rest must be a long rest." | `src/lib/domain/rest/moves.ts` (`MAX_SHORT_RESTS`), `convex/rests.ts` | Book · Manual (warn, but allow the short rest) |
| T3 | What each move does | Tend to Wounds / Clear Stress / Repair Armor roll 1d4 + tier; Prepare gives 1 Hope (2 each together); long-rest moves clear everything. The app rolls and applies. | CB p.105: "clear a number of Hit Points equal to 1d4 + your tier" / "If you choose to Prepare with one or more members of your party, you each gain 2 Hope." | `src/lib/domain/rest/index.ts` (`applyMoves`) | Book only (recommended) |
| T4 ★ | Interrupted rest | Interrupting a short rest gives nothing; an interrupted long rest gives short-rest moves instead. | CB p.105: "If a short rest is interrupted … characters don't gain its benefits. If a long rest is interrupted, the characters instead gain the benefits of a short rest" | `src/lib/domain/rest/index.ts` (`interruptedMoves`), `convex/rests.ts` | Book · Manual (Interrupt just closes the rest; the GM decides what anyone keeps) |
| T5 | Rest refreshes features | Finishing a rest ends "until your next rest" effects and resets "once per rest" uses (long-rest ones only on a long rest). | CB p.105: "Any effects that last until your next rest end when your character finishes either a long or a short rest." | `src/lib/domain/characters/expiry.ts`, `convex/rests.ts` | Book only (recommended) |

(Fear from rests is F2; long-term countdowns on a long rest are already a per-countdown choice.)

## 7. Death & revival (3 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| X1 ★ | Death move prompt | When a PC's last Hit Point is marked, their player is asked to choose Blaze of Glory, Avoid Death or Risk It All. | CB p.106: "when you mark your last Hit Point, you must make a death move" | `src/lib/domain/death/index.ts`, `convex/deathMoves.ts` | Book · Manual (no prompt; the GM is told "Kael marked their last HP" and handles it at the table) |
| X2 ★ | Death moves resolve themselves | Avoid Death: the app rolls the Hope Die and adds a scar on a roll at or under the level. Risk It All: the app rolls, then the player splits the healing (Hope higher), or the PC dies (Fear higher), or everything clears (doubles). | CB p.106: "roll your Hope Die. If its value is equal to or under your character's level, they gain a scar" / "Risk It All: Roll your Duality Dice. If the Hope Die is higher …" | `src/lib/domain/death/index.ts`, `convex/deathMoves.ts` | Book · Manual (the player rolls in the dice box; the GM sets scar / death / healing on the sheet) |
| X3 | Scars | A scar crosses out a Hope slot; a PC with no Hope slots left is listed at session end for the GM to end their journey. | CB p.106: "If you do, cross out one of your Hope slots"; CB p.182: "the player must retire the character" | `src/lib/domain/characters/index.ts`, `convex/sessions.ts` | Book only (recommended) |

## 8. Spotlight & turns (3 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| S1 ★ | Spotlight goes to the GM on a failure or Fear | **Planned, not wired yet** (bead dcm-bxp.99.32.4): a PC's failed roll or roll with Fear will hand the spotlight to the GM by itself. Today only the GM moves it. | CB p.100: "making moves until someone fails a roll or rolls with Fear, or until the GM spends a Fear to interrupt" | `convex/lib/spotlight.ts` (`moveToGm`) | Book · Manual (the GM gets "Rolled with Fear: take the spotlight?") |
| S2 ★ | Players wait while the GM has it | **Planned, not wired yet** (bead dcm-bxp.99.32.5): while the GM holds the spotlight, a player's action or token move is refused; reaction rolls still work. | CB p.100: "When play passes to the GM, the GM can make a move to spotlight an adversary … Once the GM has finished, play passes back to the PCs." | `convex/lib/spotlight.ts` (`assertMayAct`) | Book · Manual (the player sees a warning but can still act) |
| S3 | One spotlight per adversary per GM turn | The tracker counts each adversary's spotlights and warns past one (more with Relentless). It never blocks. | CB p.153: "you can't typically spotlight the same adversary more than once during your turn"; CB p.195: "Relentless (X) … spotlighted up to X times per GM turn" | `src/lib/domain/encounters/spotlight.ts` | Book only (it already only warns) |

## 9. Range, sight & movement on the map (4 rules)

Defined Ranges itself is decided (switch, default on). These are the map rules that sit on top of it.

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| M1 ★ | Line of sight and cover | An attack or spell on a target nobody can see is refused; a target behind cover (crates, low walls) is attacked with disadvantage by itself. | CB p.104: "attack rolls against you are made with disadvantage … You have line of sight if you can see the target" | `src/lib/domain/combat-actions/sight.ts`, `convex/lib/combatActions.ts` | Book · Manual (the map shows sight and cover; nothing is refused or added; the GM rules) |
| M2 | Walls and doors stop tokens | A player can't drag their token through a wall or closed door; the GM can (with a warning). Difficult terrain is flagged "a movement roll is needed". | *Not in the books* (app's own map rule). The book only says you can move "within Close range as part of that action" (CB p.104). | `src/lib/domain/combat-map/movement.ts`, `convex/combatTokens.ts` | App rule · Manual (anything goes; the GM corrects) |
| M3 | Darkness | In dim light the map shows "Dim light: ranged attacks at disadvantage" as a badge; nothing is added to the roll. | CB p.104: "The GM should reflect this by raising the Difficulty of action rolls or imposing disadvantage" | `src/lib/domain/combat-map/light.ts` | Book (badge, today) · **Variant "Darkness raises the Difficulty"** (same passage) · Manual (no badge) |
| M4 | Out-of-range targets | Already a table setting (ask the GM / refuse). | CB p.103: "Anything beyond a character's Very Far range is Out of Range and usually can't be targeted." | `convex/combatActions.ts` | (already built) |

## 10. Level-up & advancement (3 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| L1 | Achievements at levels 2, 5, 8 | The level-up steps add a new +2 Experience and +1 Proficiency; at 5 and 8 trait marks clear. | CB p.109: "At level 2, you gain an additional Experience and add it to your character sheet with a modifier of +2." | `src/lib/domain/level-up/index.ts` | Book only (recommended; the GM can already edit a sheet by hand) |
| L2 | Two picks per level from the tier list | Each level offers two picks, with per-tier slot limits; Proficiency and Multiclass use both picks and cross out other options. | CB p.110: "Choose two options from the list below or any from the previous tier and mark them." | `src/lib/domain/level-up/index.ts` (`OPTION_RULES`) | Book only (recommended) |
| L3 | Domain card levels | New domain cards are limited to the character's level (multiclass domain: half the level). | CB p.111: "take a new domain deck card at your level or lower"; multiclass domain "at half your current level (rounded up)" | `src/lib/domain/level-up/index.ts` | Book only (recommended) |

## 11. Countdowns (3 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| K1 ★ | Countdowns tick on action rolls | An "armed" countdown ticks down by itself after every PC action roll (a Tag Team counts once; reaction rolls never) and fires at 0. | CB p.162: "ticks down every time a player makes an action roll, regardless of the result"; CB p.97: "A Tag Team Roll counts as a single action roll" | `convex/countdownRolls.ts`, `src/lib/domain/countdowns/advanced.ts` | Book · Manual (campaign default: new countdowns start unarmed, the GM ticks them) |
| K2 | Dynamic countdowns | A dynamic countdown ticks by the roll's result (e.g. success with Hope ticks more). | CB p.163: "Dynamic Countdown Advancement" table | `src/lib/domain/countdowns/advanced.ts` | Book only (it's a choice per countdown already) |
| K3 | Chases | Two linked countdowns; when both reach 0 on one roll, the GM decides. | CB p.163: "When the chase begins, set two countdowns" | `convex/countdowns.ts` | Book only (recommended) |

## 12. Adversaries & environments (1 rule)

Most adversary rules are already above (R10, R11, F3–F5, D6–D8, S3).

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| E1 | Battle Points budget | The encounter builder shows a budget ((3 × PCs) + 2, with the book's adjustments) and points spent. It never blocks. | CB p.197: "( 3 × the number of PCs in combat ) + 2" | `src/lib/domain/encounters/budget.ts` | Book only (it's a calculator) |

## 13. Frame-specific (8 rules)

| # | Rule | What you see today | Book, short quote | Code | Modes |
|---|---|---|---|---|---|
| W1 | Witherwild: Wither tokens | A PC who takes Severe damage from a Withered enemy gains a Wither token; the app rolls their Fear Die and adds a scar at or under the token count. | CB p.261: "Any time a PC takes Severe damage from a Withered adversary or environment, gain a Wither token" | `src/lib/domain/wither/index.ts`, `convex/characters.ts` | Book · Manual (the GM adds tokens and asks for the roll) |
| W2 ★ | Horizon: long rest only in a sanctuary | A long rest outside a sanctuary is refused. | HF p.176: "The PCs can gain the benefits of a long rest only in a sanctuary" | `convex/lib/restHooks.ts`, `convex/trackers/` | Book · Manual (warn, but allow) |
| W3 | Horizon: Doom Track | At session end the GM is reminded to mark a Doom Track box. | HF p.177: "At the end of each session, mark a box" | `convex/sessions.ts`, `src/lib/frames/doom-track.ts` | Book only (already a reminder) |
| W4 | Beast Feast: Make a Feast | Clear Stress, Tend to Wounds and Prepare are not offered; Make a Feast is. | CB p.278: "players can't choose downtime moves to clear Stress, clear Hit Points, or gain Hope. Instead, they have a new downtime move: Make a Feast." | `convex/lib/restHooks.ts`, `src/lib/domain/frames/beast-feast.ts` | Book · Manual (every core move allowed too) |
| W5 | Colossus: Siphoning on rests | A short rest in the hunt phase marks the Siphoning Track once, a long rest twice. | CB p.327: "When the PCs take a long rest during the hunt phase, mark the Siphoning Track twice." | `src/lib/frames/trackers/colossus.ts`, `convex/lib/restHooks.ts` | Book · Manual (the GM marks it) |
| W6 | Age of Umbra: Lurking Darkness | Finishing a rest away from a Sacred Pyre rolls a d12 on the Lurking Darkness list for the GM. | CB p.289: "When the party finishes a short or long rest while not in the vicinity of a Sacred Pyre, roll a d12" | `src/lib/frames/trackers/age-of-umbra.ts`, `convex/lib/restHooks.ts` | Book · Manual (reminder only) |
| W7 | Andaluria: Lycanthropy countdown | The countdown ticks on each rest unless the PC takes the "halt lycanthropy" move. | HF p.153: "It ticks down each time the PC takes a rest without using a downtime move to halt their lycanthropy's progression." | `convex/lib/restHooks.ts`, `src/lib/frames/trackers/andaluria.ts` | Book · Manual (the GM ticks it) |
| W8 | Motherboard: Ikonis and quantum | No normal weapons (the Ikonis instead); no gold (scrap and quantum instead). | CB p.301: "Characters don't have access to Daggerheart's normal selection of primary …"; CB p.302: "gold is not used as a currency" | `src/lib/equipment-rules.ts`, `src/lib/domain/motherboard/index.ts` | Book only (recommended: the frame is built on it) |

---

## Count per area

| Area | Rules | With a real switch (not "Book only") |
|---|---|---|
| Rolls & dice | 11 | 1 (R3) |
| Hope & Fear | 5 | 2 (F2, F3) |
| Damage & thresholds | 8 | 5 (D2, D4, D5, D6, D8) |
| Armor | 3 | 1 (A1) |
| Conditions | 4 | 2 (C1, C2) |
| Rests & downtime | 5 | 2 (T2, T4) |
| Death & revival | 3 | 2 (X1, X2) |
| Spotlight & turns | 3 | 2 (S1, S2) |
| Range, sight & movement | 4 | 3 (M1, M2, M3) |
| Level-up & advancement | 3 | 0 |
| Countdowns | 3 | 1 (K1) |
| Adversaries & environments | 1 | 0 |
| Frame-specific | 8 | 6 (W1, W2, W4, W5, W6, W7) |
| **Total** | **61** | **27** |

## Recommended first batch (15)

These are the rules a table is most likely to want to handle differently, and the ones where the app acts on its own in
a way players notice:

1. F2 Fear from rests (Book / Extended downtime / Manual)
2. F3 Extra adversary spotlight costs Fear
3. S1 Spotlight goes to the GM on failure or Fear (decide before it is wired)
4. S2 Players wait while the GM has the spotlight (decide before it is wired)
5. C1 Conditions change the dice (Vulnerable / Hidden)
6. C2 Hidden / Cloaked end on the map
7. D5 Full Stress = Vulnerable
8. D6 Minions (Book / GM picks / Manual)
9. A1 Armor Slot prompt
10. M1 Line of sight and cover
11. T2 Short-rest limit
12. T4 Interrupted rest
13. X1 + X2 Death move prompt and auto-resolve (one row or two)
14. K1 Countdowns tick on action rolls
15. W2 Horizon: long rest only in a sanctuary

## Findings while checking

- Resistance rounding: the code rounds half damage **up** (`Math.ceil` in `src/lib/domain/encounters/damage.ts`, matching
  CB p.107 "round up"), but two comments say "rounds down" (`src/lib/domain/combat-actions/damage.ts` line 9,
  `src/lib/domain/adversary-actions/severity.ts` line 19). The comments are stale; behaviour follows the book.
- S1 and S2 are designed but not wired (beads dcm-bxp.99.32.4, .5). Choosing their modes now saves a rework.
- Printed variants are rare: the only book alternatives found for automated rules are Extended downtime (CB p.181) and
  darkness raising the Difficulty (CB p.104). Every "Optional rule" box in both books is already in the decided list.

---

## Questions for the user

1. **First batch scope.**
   a. **The 15 rules marked ★ above** (recommended)
   b. Only the 5 the players feel most (F2, S1, C1, A1, X1/X2)
   c. Every switchable rule (27) at once

2. **How Manual reminds the GM.**
   a. A short note in the GM's feed ("Rolled with Fear: gain 1 Fear?") that disappears
   b. **A GM prompt with buttons (Apply / Skip) that waits until answered, like today's "Does X lose Cloaked?"** (recommended)
   c. Nothing: Manual means the app is silent and the GM tracks it

3. **Variants not printed in the books (e.g. "GM picks the extra Minions").**
   a. **Allowed, but few, and labelled "not in the books" in Settings** (recommended)
   b. Not allowed: only Book, printed variants and Manual
   c. Allowed freely; the user names more

4. **Rules marked "Book only (recommended)".**
   a. **Listed in House rules as read-only rows with their page, so the GM sees what the app does** (recommended)
   b. Left out of Settings entirely
   c. Given a Manual mode anyway

5. **Who sees the registry.**
   a. GM only
   b. **GM edits; players can read the rule list and each rule's mode** (recommended)
   c. GM and co-GM edit; players don't see it

6. **Changing a mode mid-session.**
   a. **Allowed any time; the change is logged in the session log** (recommended)
   b. Only between sessions
   c. Allowed any time, not logged
