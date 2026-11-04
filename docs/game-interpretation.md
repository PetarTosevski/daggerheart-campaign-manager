# Game Interpretation

## Status

Status: Active application interpretation

This document explains how confirmed Daggerheart and campaign mechanics map into
application state and workflows. It does not replace the SRD.

## General interpretation rules

- Official mechanics must be traceable through `rules-index.md`.
- House-rule overrides must be explicit and recorded in this document with
  their source. (`campaign-house-rules.md` was retired in the 2026 rebuild; its
  history is at tag `witherwild-final`.)
- Current totals may be cached for fast reads.
- Every important mutation must create auditable history in the same
  transaction.
- The application never applies an unconfirmed narrative consequence
  automatically.
- Corrections preserve the original record.

## Fear

The application stores:

- A cached current Fear value in campaign state
- Append-oriented Fear events
- An event type for each adjustment
- An operation link when the adjustment belongs to a compound action

The cached total is not independently authoritative. It must remain reconcilable
with the Fear-event history.

Rules:

- Fear cannot be negative.
- Fear cannot exceed 12.
- Source of the 0–12 range: a confirmed application range, not a house-rule
  change (former `docs/campaign-house-rules.md`, "Fear", at tag
  `witherwild-final`). Adjustments that would move Fear outside it are rejected.
  It defines no automatic extended-downtime behaviour.
- New campaigns start with Fear 0.
- A Fear change updates the total and inserts one event atomically.
- Corrections use compensating events.
- Retried adjustments use an idempotency key and cannot apply twice.
- Extended-downtime Fear must be previewed and confirmed before the application
  applies it.

## Countdowns

The application stores:

- Countdown configuration
- Cached current value
- Direction and target
- Status
- Optional narrative consequence
- Countdown-event history

Rules:

- Every value or status change creates an event.
- Phase 1 categories are `threat`, `project`, `consequence`, and `other`.
- Every countdown starts at a positive integer and counts down toward `0`.
- Reaching `0` completes the countdown automatically and records completion
  exactly once for that active lifecycle.
- Increasing a completed countdown reopens it, up to its initial value, without
  reversing any narrative consequence.
- Automatic completion effects are disallowed until explicitly configured.
- Paused countdowns cannot change value until resumed.
- Cancelled countdowns are terminal.
- Completed and cancelled countdowns remain available in history.

Countdown terminology must follow the SRD or be marked as a campaign-defined
category.

## Campaign weeks

A campaign week is the application unit aligned with the Witherwild weekly
day/night cycle.

The official Witherwild frame describes week-long day and night periods. The
application must track the cycle only after its starting state and transition
behavior are confirmed.

Week advancement is a compound transaction that may include:

- New current week
- Day/night-cycle transition
- Food consumption
- Food spoilage
- Fear changes
- Selected long-term countdown changes
- Wither-token end-of-session conversion when explicitly invoked
- GM notes

The preview is non-persistent. Confirmation applies all selected changes or
none.

The application must distinguish:

- Advancing a campaign week
- Ending a real-world session
- Applying extended downtime

These are not automatically equivalent.

## Campaign Calendar

The application represents campaign time using three values:

- Campaign Week
- Cycle (`Day` or `Night`)
- Cycle Day (`1–7`)

The named phases are presentation values derived from the current cycle and cycle day.

### Day Cycle

| Cycle Day | Display Phase |
|----------:|---------------|
| 1 | Dawn |
| 2 | Sunrise |
| 3 | Morning |
| 4 | Forenoon |
| 5 | Midday |
| 6 | Afternoon |
| 7 | Civil Twilight |

### Night Cycle

| Cycle Day | Display Phase |
|----------:|-----------------------|
| 1 | Nautical Twilight |
| 2 | Astronomical Twilight |
| 3 | Evening |
| 4 | Night |
| 5 | Midnight |
| 6 | Dead of Night |
| 7 | Pre-Dawn |

The application derives the displayed phase from the stored values rather than storing the phase name itself.

### Manual one-day advancement

Task 007 advances campaign time only after explicit GM confirmation:

- Cycle days `1–6` increment by one without changing week or cycle.
- Cycle day `7` advances to day `1`, increments the campaign week, and
  alternates Day and Night.
- Preview derives the proposed canonical state and phase without writing.
- Commit records one operation and one campaign-time event atomically with the
  cached state update.
- An explicit correction may set any different valid canonical combination and
  appends a compensating event without deleting earlier transitions.

Manual one-day advancement does not consume food, spoil supplies, change Fear,
operate countdowns, infer duration from narrative activities, or apply any
other automatic consequence. Those effects remain outside Task 007.

## Food

Food is modeled separately from general inventory.

Confirmed house rules:

- One ration per participating character per campaign week
- Fresh food spoils after two campaign weeks
- Preserved food does not spoil through normal weekly spoilage

Until the remaining unit and timing questions are resolved:

- Do not assume that `ration`, `portion`, and arbitrary quantity are identical.
- Do not apply automatic spoilage without a preview.
- Permit a GM correction with an audit record.

Implemented behavior (Task 012):

- Food is held canonically in portions; one ration = 7 portions (configurable
  per campaign). Rations and portions are derived for display.
- The default weekly requirement is `active characters × 7 portions`, derived
  from the active roster (never hard-coded names). A GM may override the required
  portions with a mandatory reason.
- Fresh food acquired in week `A` is eligible for spoilage when processing a week
  `W >= A + 2`. Preserved food (the default for rations) does not spoil through
  weekly processing. A GM may skip spoilage for a run with a mandatory reason.
- Weekly processing is previewed (non-persistent) then committed atomically and
  idempotently as a standalone action; it consumes oldest-eligible food first
  (FIFO) and reports any shortage. It is not coupled to Task 007/008 time
  advancement.
- Corrections are compensating audit transactions; history is never rewritten.

## Inventory

Task 013 implements inventory following the task prompt: reusable item
definitions held as stacks in owned or shared, nestable containers, with optional
per-item weight and optional container capacity rather than a fixed slot count.
Weight is optional (unset items contribute nothing to `carried_weight`), so
slot-style play remains possible by leaving weights and capacities blank. This
supersedes the earlier "slots, not weight" sketch and resolves OQ-DATA-004 and
OQ-RULE-010.

The application stores current item quantity or stack state and transaction
history.

Rules:

- Quantity cannot be negative.
- Transfers are one atomic operation.
- A pure transfer preserves total quantity.
- Capacity enforcement is deferred until slot limits and item sizing are
  defined.
- Current quantity may be cached but must remain auditable from transactions.

## Characters

The application may store:

- Identity and gender
- Ancestry and community
- Class, subclass, and level
- Traits
- Evasion
- Hit Points
- Stress
- Hope
- Armor
- Experiences
- Conditions
- Equipment
- Inventory
- Wither tokens
- Scars
- Portrait reference
- Private GM notes

The initial character slice may implement only an approved subset. Do not store
the whole character sheet as an unvalidated JSON object.

## Wither tokens

The official Witherwild frame introduces Wither tokens attached to individual
characters.

Application mapping:

- Wither tokens belong to a character.
- Token changes require history if the feature is implemented.
- The Fear Die check remains a tabletop action; the application may prompt and
  record its result but should not roll automatically unless explicitly
  requested.
- End-of-session token clearing and corresponding Fear gain must be previewed as
  one compound operation.
- Scars are character records and are not deleted when tokens clear.

This feature requires a dedicated task before implementation.

## Combat actions on the Combat Map (player side)

Plan `.omc/plans/combat-actions.yaml`, analysis `.omc/autopilot/combat-actions-analysis.md` (approved 2026-10-21).
Players hold their domain cards on the Combat Map, attack enemy tokens and use cards there; the server rolls, applies
the result to the encounter's adversaries and logs it. Book pages are printed pages: CB = Core Book, HF = Hope & Fear.
The adversary side (adversaries attacking PCs, the reaction window, Fear; Q12-Q19) has its own section below,
"Combat actions on the Combat Map (adversary side)".

### The user's rulings (2026-10-21, binding)

- **U1 Players never see an enemy's HP, Stress or thresholds.** They only learn whether they hit or missed. The book
  leaves this to the table: CB p.157 "You can choose to keep this Difficulty secret or tell the player what they're
  aiming for up front; both playstyles work well in Daggerheart." Nothing requires showing thresholds. The application:
  player-facing results carry the player's own roll and damage total and Hit / Miss / Defeated per target; the GM row
  of the same action carries damage → severity → HP / Stress. Player-facing results are built from player-safe fields,
  never by removing fields from the GM's row. Difficulty is hidden too.
- **U2 Rolls made on the map also appear in the roll feed.** Attacks, card uses and the map's dice box write ordinary
  roll-feed rows.
- **U3 Every domain card that can be used in combat is automated.** 196 of the 210 cards are classified combat or
  passive (`src/lib/srd/card-effects/classification.ts`); each has one entry in its domain's effect table
  (`src/lib/srd/card-effects/<domain>.ts`). A part the effect vocabulary can't express is a `manual` step: the card's
  words plus a Done button, logged to the feed. The other 14 cards are out of combat; using one on the map is refused.
- **U4 Damage applies automatically; the GM can undo it.** There is no approval step. Each action is one log group
  that stores the adversaries' state before it, and the GM's Undo restores it.
- **U5 Mechanics follow the book.** Wherever the book decides, that is the default:
  - Attack roll vs Difficulty, one roll for every target (CB p.96, p.193). A critical counts as a success with Hope
    (CB p.90).
  - Damage is Proficiency × weapon dice + modifier. A card's damage uses the dice it names, "using your Proficiency"
    or "Spellcast trait". A critical deals the maximum of the dice plus a roll. A move's damage is totalled before
    thresholds (CB p.98).
  - Thresholds: Minor 1 HP, Major 2 HP, Severe 3 HP; damage of 0 or less marks none (CB p.91). Adversaries use the same
    rule (CB p.193). The optional Massive threshold (CB p.91) is off for adversaries.
  - "Minion (X)" (CB p.201) and "Horde (X)" (CB p.199) apply as printed. A full Stress track marks 1 HP instead
    (CB p.92).
  - Usage limits (CB p.101), rests (CB p.105) and the Recall Cost (CB p.101, p.26) follow the book.
  - Hope features (CB p.90) and several targets or groups (CB p.104) follow the book.
  - Resistance and immunity (CB p.99), Defined Ranges and line of sight (CB p.103-104) and adversary reaction rolls
    (CB p.161) follow the book.

### Open questions, answered (2026-10-21)

The user answered Q1 and accepted the defaults of Q2-Q11.

- **Q1 Range (user answer).** An attack or card use on a target outside its range waits as a pending request that the
  GM approves or declines; nothing is rolled or paid before approval. Ranges use the grid of CB p.103 ("Melee: 1
  square • Very Close: 3 squares • Close: 6 squares • Far: 12 squares • Very Far: 13+ squares"), counted between the
  tokens' nearest edges, a diagonal step counting 1. The book adds "these ranges aren't intended to be precisely
  measured during play", so the GM decides.
- **Q2 Line of sight.** Line of sight is required for every attack and card, using the map's vision from the
  attacker's token. A target in cover gives the attack disadvantage, shown before the roll. CB p.104: "You usually can't
  be targeted if you're entirely behind a substantial structure like a wall"; cover: "attack rolls against you are made
  with disadvantage."
- **Q3 Once-per limits.** "Once per rest" comes back after a short or a long rest, and "once per long rest" only after a
  long rest. An interrupted long rest counts as a short rest. Finishing a session does not reset card limits. The map
  and the character sheet share one record (`featureUses`, key `card:<cardId>`), so a card used on the map is greyed on
  the sheet too, and the reverse. CB p.101: "If you use that card, you'll need a way to remember that it's temporarily
  unavailable." CB p.105: an interrupted long rest gives the benefits of a short rest.
- **Q4 "Once per rest on a success"** (17 cards, e.g. Earthquake, CB p.329): the card is used up only when the roll
  succeeds; a failed roll leaves it ready.
- **Q5 The player's damage roll.** The player sees their own damage dice and total and Hit / Miss per target, but not
  how many HP that became. CB p.98: "The GM marks Hit Points based on that damage."
- **Q6 Defeats and Minions.** The player sees "Defeated" when an enemy goes down; the token shows as down. For Minion
  (X) the server offers the Minions within range that the roll beat, and the attacking player picks them. CB p.201:
  "Tell the attacking PC which other Minions within range the attack would succeed against and let them choose which
  Minions they defeat."
- **Q7 Enemy reaction rolls from cards** (15 cards). The server rolls the enemy's d20 against the card's Difficulty
  with no bonus. The GM sees the roll and can undo, or spend a Fear to add an Experience and resolve again. CB p.161:
  "roll a d20 … If you meet or exceed the roll's Difficulty, the NPC succeeds … you can spend a Fear to add any of the
  adversary's relevant Experiences".
- **Q8 Resistance and immunity.** A table gives the SRD adversaries' always-on resistances and immunities, applied
  automatically. A conditional one ("while underground") is a GM toggle on the instance. Custom adversaries get a
  resistance picker. Odd texts such as "takes double damage from fire" stay with the GM, unless the adversary effect
  tables automate them. CB p.99: resistant creatures "halve damage of that type before comparing it to their damage
  thresholds"; immune ones take none.
- **Q9 Effects the book leaves open.** Movement ("knocked back to Far range", "pull the target into Melee") is a
  prompt, not an automatic token move. "Temporarily" conditions set the tracker condition, which the GM clears (CB
  p.96: "It might be temporary (in which case the GM can spend Fear to end the spell)"). Lasting spells become sheet
  effects with their end. Choices on the card are asked in a dialog before the roll, or after it when the card says
  so. Anything else is a `manual` step; each domain tracer's task doc lists them for review.
- **Q10 What the GM sees.** Each hit applies at once: the token's HP / Stress pips change, and the GM's feed row reads
  e.g. "Mira → Bandit: 14 phy → Major → 2 HP (3/5)", with Undo. The GM column's Resolutions list shows the latest hits
  with Undo.
- **Q11 Phones (≤ 760 px).** The map stays on top. A bottom sheet with the tabs Hand / Attack / Dice / Feed opens from a
  bar under the map, with 44 px touch targets. A target is picked by tapping an enemy token and confirmed in the sheet.

### Later user answers on the player side (2026-10-22, binding)

- A plain weapon attack takes one target. Cards keep their own number of targets.
- Range for extra creatures depends on how the card is worded: every extra creature is range-checked from the origin
  the card names. That is the caster by default, the previous target for chains such as Chain Lightning, and the
  area's point for areas. Out of range follows Q1.
- The GM can see a PC's cards on the map by selecting the token. The cards are greyed until the GM turns on "Play for
  this character". Then the GM can use and recall them, logged as the GM acting for that character.
- The last attack result is kept when the layout switches across 760 px.
- Card damage to another PC (e.g. a blast that catches an ally) opens the same incoming-hit prompt as an adversary
  attack: armor choice and ally reactions.
- Onslaught's Major floor applies to any hit that deals weapon damage: plain attacks, and cards that attack with the
  weapon's damage.

## Combat actions on the Combat Map (adversary side)

Plan `.omc/plans/combat-actions.yaml`, Part B (tracers AA0-AA6 and AE-*), analysis
`.omc/autopilot/combat-actions-analysis.md` Part B (approved 2026-10-21). The GM attacks PCs and uses adversary
features from the Encounter tab or the Combat Map; the server rolls, opens a reaction window per hit PC and logs one
undoable action. Book pages are printed pages: CB = Core Book, HF = Hope & Fear. The player side, U1-U5 and Q1-Q11,
is the section above.

### The book's rules for adversary actions (AR1-AR11)

- **AR1 Attack roll** (CB p.160): "You make your attack roll with a d20. If the adversary has advantage or
  disadvantage on the attack, add an extra d20 to that roll." The stat block's Attack Modifier is added, and "You can
  also spend a Fear to add an adversary's Experience to the roll's result." The total is compared with the PC's
  Evasion: "If the attack meets or beats that value, it is successful". The book's "Share your roll total with the
  player who was attacked" is overridden by Q14: players don't see the roll.
- **AR2 Critical** (CB p.148): "Whenever you roll a 20 on the d20, your roll automatically succeeds. If you critically
  succeed on an attack roll, you also deal extra damage. Start with the highest possible value the damage dice can
  roll, and then make a damage roll as usual, adding it to that value."
- **AR3 Damage to PCs** (CB p.91): Severe 3 HP, Major 2 HP, Minor 1 HP; damage reduced to 0 or less marks none; "When
  you mark your last Hit Point, you must make a death move."
- **AR4 Armor Slots** (CB p.114): "you can negate some (or all) of it by marking an available Armor Slot …, then
  reducing the severity of the damage by one threshold … Each time your character takes damage, you can only mark 1
  Armor Slot." Direct damage (CB p.99) can't be reduced by Armor Slots.
- **AR5 Stress** (CB p.92): "If you're ever forced to mark 1 or more Stress but your slots are already full, you must
  instead mark 1 Hit Point." An adversary's "mark a Stress" costs are marked on its own track (CB p.194).
- **AR6 Fear and the spotlight** (CB p.153-154, p.194-195): Fear interrupts, makes an additional GM move (shifting the
  spotlight to another adversary), pays Fear Features and adds an Experience; at most 12 Fear. "you must spend Fear as
  described, even if you already spent a Fear to spotlight the adversary." "For an adversary to use an action, they
  must have the spotlight. Passives and reactions typically don't require the spotlight."
- **AR7 Several targets** (CB p.161): "When an adversary's action lets you make an attack against multiple targets,
  you make one attack roll and ask if it hits any of the targets." Example (CB p.196, Explosion): "Make an attack
  against all targets within Close range."
- **AR8 Reactions** (CB p.195): "When it triggers, you can choose to immediately use the reaction, and you don't have
  to spend Fear to interrupt the PCs with this reaction (unless otherwise specified)." Momentum: "When this adversary
  makes a successful attack against a PC, you gain a Fear."
- **AR9 Minions** (CB p.201): "Group Attack - Action: Spend a Fear to choose a target and spotlight all adversaries
  with this name within a certain range of them. Those Minions move into Melee range of the target and make one shared
  attack roll. On a success, they deal X damage each. Combine this damage."
- **AR10 Hordes** (CB p.199): "When the Horde has marked half or more of their HP, their standard attack deals X damage
  instead."
- **AR11 PC reaction rolls** (CB p.99): an adversary effect asks for e.g. "an Agility Reaction Roll (14)"; the player
  rolls it. Reaction rolls "don't generate Hope, Fear, or additional GM moves".

### The user's answers (2026-10-21, binding)

- **Q12 Adversary actions are in scope.** "GM can use the encounter tab to use abilities, they will show up on combat,
  he can also use combat map if he wants". The Encounter tab's action panel and the Combat Map's adversary panel are
  the same component over the same server calls (`adversaryActions.attack` / `useFeature`), so an action from either
  page shows on both.
- **Q13 Armor and the reaction window.** The hit PC's player chooses whether to mark an Armor Slot, and the damage
  waits for that choice. Allies may answer with their abilities first, e.g. I Am Your Shield (CB p.341: "When an ally
  within Very Close range would take damage, you can mark a Stress to stand in the way and make yourself the target of
  the attack instead. When you take damage from this attack, you can mark any number of Armor Slots."). Each adversary
  hit opens a reaction window in which the target and eligible allies answer before the damage resolves; card effects
  come from the closed card vocabulary.
- **Q14 What players see.** Players see that they were hit, not the attack roll. The hit PC's player sees the damage
  amount and its severity against their own thresholds ("14 damage: Major (2 HP). Mark an Armor Slot to make it
  Minor?"), because they need it to choose armor and the numbers are their own character's. Other players see only
  "Bandit hit Mira" and, once resolved, Mira's HP as the party view shows it. No player receives the roll, the
  adversary's Attack Modifier, its stat block or the GM's before-state (checked over the network in
  `tests/e2e/adversary-actions-flow.spec.ts`).
- **Q15 Every adversary feature is automated.** All 267 SRD adversaries and their 928 features have one effect entry
  each, in eight tier / source tables (`src/lib/srd/adversary-effects/<tier>-<source>.ts`); custom adversaries are
  automated where their features are structured, else their feature is a GM prompt with its Fear paid. What the
  vocabulary can't express is a `manual` step (the feature's words and a Done button for the GM).
  `tests/unit/adversary-effects/coverage.test.ts` checks the entries and runs every use through the runner; it prints
  the manual steps per table (258 on 2026-10-30: t1-core 29, t1-hf 33, t2-core 18, t2-hf 32, t3-core 26, t3-hf 48,
  t4-core 21, t4-hf 51) for later lanes to reduce.
- **Q16 Where the GM acts.** Fear and adversary control live on the Encounter tab with the tracker's existing logic:
  the GM moves tokens (in its live-map pane), attacks, uses features and spends Fear there, and the visuals (hit
  flashes, token pips) show on the Combat Map. The map accepts the same GM actions when the GM selects an adversary
  token.
- **Q17 (a) When the reaction window closes.** It resolves as soon as the target has chosen armor (or has no slot and
  no eligible card) and every ally with an eligible reaction has answered Use or Pass. The GM can press "Resolve now"
  at any time. There is no timer. CB p.114: armor is the player's choice ("you can … mark an available Armor Slot").
- **Q18 (a) Targets without a live map.** With no live map (or with the adversary not on it) the GM picks targets from
  the party list, with no range or line-of-sight check. CB p.103: "If the table decides not to implement a map, you
  still use range, but in a more abstract way. … it's up to the GM to decide roughly how far away everything is." With
  the adversary on the live map, its PC targets are the tokens in its line of sight (Q2), with their range bands shown;
  adversary attacks are not refused for range, because the GM sanctions their own actions.
- **Q19 (a) Fear prompts.** Fear is spent only on the GM's tap. A Fear-cost feature, an Experience and a second
  spotlight in the same GM turn ask "Spend N Fear?" first, and nothing is rolled or paid before the tap. Optional Fear
  steps (Heavy Hitter, a feature's "you can spend a Fear to …") are a one-tap prompt that defaults to No.
  Momentum-style Fear gains happen automatically, with no prompt (CB p.154, p.194, p.195).

### Later user answers on the adversary side (2026-10-22, binding)

- A hit that takes a PC to their last HP prompts that player's death move at once (CB p.91).
- I Am Your Shield moves the attack's riders (conditions, forced marks) to the ally along with the damage.
- Riders land whenever the attack hit, even if its damage was negated by armor; only a miss or full avoidance stops
  them.
- "Once per session" adversary features last the whole session and reset at its end. Undo gives an adversary's limited
  use back.
- Damage reflected at a PC attacker opens the normal incoming-hit prompt.
- A feature whose use needs choices (options, picks, splits, situations, cost choices) asks them in a dialog before it
  runs.
- A PC the GM owns gets the same incoming-hit prompt in the GM column on the Combat Map.
- The Encounter tab has one way to attack: the targeted Attack (the old untargeted "Roll attack" / "Roll damage" are
  gone).

## Corrections and undo

A correction adds a compensating event to repair incorrect state.

Undo reverses an eligible operation by creating a new linked operation and new
compensating records.

Neither correction nor undo deletes the original historical record.
