# Rule switches: briefs (2026-11-05)

Plan: `.omc/plans/rule-switches.yaml` (7 waves, 24 tracers; `node scripts/plan-check.mjs` OK). Epic dcm-jh6d, absorbs
dcm-bxp.134, folds in dcm-bxp.99.32.4 (S1) and dcm-bxp.99.32.5 (S2). Source list: `.omc/plans/rule-registry-list.md`.

## What the GM and players get

Campaign settings > House rules lists every rule the app applies by itself, grouped by area, each with its book page:

- **27 switchable rules**: a picker Book / variant / Manual. Variants not printed in a book carry "not in the books".
- **10 optional rules** (Massive Damage, Spotlight Tracker, Falling & collision, Underwater, Gold coins, Fate rolls,
  Conflict between PCs, Horizon encounter bonuses, Shared domain cards, Defined Ranges): an on/off switch. All start off
  except Defined Ranges.
- **34 Book-only rules**: read-only rows ("Book · p.90"), so the GM sees what the app does.
- Today's campaign options (Hope & Fear content, frame rules) stay as they are, below. The four frame rules (Less Lethal,
  Transformations, Endurance Countdowns, Remnant Corruption) start off in new campaigns.
- **Manual** = the app stops applying the rule and posts a GM-only note in the feed ("Mira rolled with Fear: gain
  1 Fear?"), tagged Manual. There is no blocking prompt. Undoing the action undoes its notes.
- GM and co-GM edit; players open the same list read-only. While a session is live every switch is disabled, and the
  server refuses a change with `RULES_LOCKED`.

## User decisions (binding)

- 2026-10-30: optional rules as listed above, off by default except Defined Ranges; the four frame switches turn off by
  default (overrides `docs/decisions-d3-d11.md`).
- 2026-11-05: build all 27; Manual = feed note to the GM, no prompt; non-book variants allowed where they fit, labelled;
  Book-only rules as read-only rows with their page; GM and co-GM edit, players read; locked while a session is live.

## Data

- `campaigns.ruleModes?`: a **typed** `v.object` of optional fields: each switch rule is a union of its mode literals,
  each optional rule a boolean, plus `spotlightTrackerTokens`. Rule 7 is satisfied without `schemaVersion` because it
  is a typed validator, not a blob. A new rule or variant only adds an optional field or literal (widen).
- One registry, `src/lib/rules/registry.ts`, holds id, list code (R3, F2 …), area, title, pages and modes. Server
  (`ruleModesOf`, the setter's validation) and UI read it. A drift test ties it to the validator.
- Manual notes are `actionLog` rows: kind `rule` (new literal), visibility `gm`, plus `ruleId`.
- Four frame switches (Q1): RD1 pins today's value on existing campaigns (a batched `@convex-dev/migrations`
  migration). The orchestrator runs it on dev, and RD2 then flips the defaults. This is widen → migrate → narrow:
  no field changes shape, only the default changes, and that waits until the pin has run.

## Waves

| Wave | Tracers (parallel) | Why this split |
|---|---|---|
| 0 | RS0 foundation, RD1 migration | Everything reads the registry and the stored modes |
| 1 | RA roll aftermath (S1, R3), RDM damage + tracker (D2 D4 D5 D8 F3, Massive), RR rests (F2 T2 T4), RF frame rest hooks (W2 W4–W7), RW Wither (W1), RK countdowns (K1), RX death (X1 X2), RU House rules UI, OH Horizon bonuses | No shared files. RA takes every PC roll path once |
| 2 | RC1 PC attacks (C1 M1 D6 + damage wiring), RC2 adversary attacks (A1 C1 + damage wiring), RM movement/light (C2 M2 M3), RT Spotlight Tracker, OSC Gold coins + Shared domain cards, OFT Fate rolls, RD2 frame defaults | The attack paths need RA's and RDM's files |
| 3 | RS2 players wait (S2), ODR Defined Ranges, OFA Falling & collision | S2 needs RC1's combat files; ODR needs every range path |
| 4 | OE dim-light variant + Underwater | `convex/lib/combatActions.ts` again |
| 5 | OP Conflict between PCs | `convex/lib/combatActions.ts` again |
| 6 | RZ close: e2e, a11y, docs | — |

`convex/lib/combatActions.ts` (2,900 lines) is the bottleneck. It is owned by RA → RC1 → ODR → OE → OP, one per wave.
That is why the optional combat rules come late.

## Rule → tracer

| Rule | Modes | Tracer |
|---|---|---|
| R3 Hope/Fear from rolls | Book · Manual | RA (Q2) |
| F2 Fear from rests | Book · Extended downtime (CB p.181) · Manual | RR (Q7) |
| F3 Extra adversary spotlight costs Fear | Book · Manual | RDM |
| D2 Resistance / immunity | Book · Manual | RDM (+ RC1/RC2 wiring) |
| D4 Stress overflow | Book · Manual | RDM (+ RC1/RC2) |
| D5 Full Stress = Vulnerable | Book · Manual | RDM |
| D6 Minions | Book · GM picks extra Minions (*not in the books*) · Manual | RC1 (Q5) |
| D8 Adversary defeated at last HP | Book · Manual | RDM (+ RC1) |
| A1 Armor Slot prompt | Book · Manual | RC2 |
| C1 Conditions change the dice | Book · Manual | RC1 (PC side), RC2 (adversary side) |
| C2 Hidden / Cloaked end on the map | Book · Manual | RM |
| T2 Short-rest limit | Book · Manual | RR |
| T4 Interrupted rest | Book · Manual | RR |
| X1 Death move prompt | Book · Manual | RX (Q8) |
| X2 Death moves resolve themselves | Book · Manual | RX (Q8) |
| S1 Spotlight to the GM on failure / Fear | Book · Manual | RA (+ RDM, RC2 for adversary spotlights) |
| S2 Players wait while the GM has it | Book · Manual | RS2 (Q4) |
| M1 Line of sight and cover | Book · Manual | RC1 |
| M2 Walls and doors stop tokens | App rule (*not in the books*) · Manual | RM |
| M3 Darkness | Book (badge) · variant(s) (Q6) · Manual | RM (Book/Manual), OE (variant) |
| K1 Countdowns tick on action rolls | Book · Manual | RK (Q3) |
| W1 Wither tokens | Book · Manual | RW |
| W2 Horizon long rest only in a sanctuary | Book · Manual | RF |
| W4 Beast Feast | Book · Manual | RF |
| W5 Colossus Siphoning | Book · Manual | RF |
| W6 Age of Umbra Lurking Darkness | Book · Manual | RF |
| W7 Andaluria Lycanthropy | Book · Manual | RF |
| Massive Damage | on/off | RDM (pure + tracker), RC1, RC2 |
| Spotlight Tracker | on/off + tokens 1–6 | RT (Q9) |
| Falling & collision | on/off | OFA (Q10) |
| Underwater | on/off | OE (Q11) |
| Gold coins | on/off | OSC (Q12) |
| Fate rolls | on/off | OFT (Q13) |
| Conflict between PCs | on/off | OP (Q14) |
| Horizon encounter bonuses | on/off | OH (Q15) |
| Shared domain cards | on/off | OSC (Q16) |
| Defined Ranges | on (default)/off | ODR |
| Book-only (34 rules) | read-only row | RS0 (registry), RU (rows) |

No other non-book variants are proposed. The user may name more; each is a new literal (widen) and a small tracer.

## Common rules (every tracer)

- Worktree first step: `git switch -C <branch> rebuild`. Change only `owns`; check with
  `pnpm tracer:guard rule-switches <id>`. Commit once on the branch and never push.
- **Host load: run vitest with `--maxWorkers=2` on the tracer's own test files and the existing tests of the files it
  touched, never the whole suite in a worktree.** Run e2e only in RZ. The orchestrator runs the full suite after each
  merge.
- Read modes only through `ruleModesOf(campaign)`. Write Manual notes only through `postRuleNote` and pass the action's
  `groupId`, so undo takes the note back too. Pure functions take the mode as a parameter whose default is Book, so an
  unwired caller keeps today's behaviour.
- Book mode must not change behaviour: every existing test of a touched file passes unchanged.
- New public functions: wrappers from `convex/lib/functions.ts`, args and returns validators, their own
  `tests/convex/authz/rules-<area>.entries.ts`. Tests assert `ConvexError.data.code`. A disabled optional rule refuses
  with `MECHANIC_DISABLED`.
- UI: glass buttons, error boundaries, and optimistic updates on `ruleSettings.get`.
- Each tracer writes `docs/tasks/TASK-RULES-<id>.md`. It records the book passage for each mode and the interpretation;
  RZ moves those into `docs/game-interpretation.md` and `docs/rules-index.md`. The orchestrator updates
  `docs/data-model.md` for tracers after RS0.

## Blocked tracers

| Tracer | Waits for |
|---|---|
| RD1, RD2 | Q1 (RD2 also needs RD1's migration run on dev) |
| RA | Q2 |
| RK | Q3 |
| RS2 | Q4 |
| RC1 | Q5 |
| OE | Q6, Q11 |
| RR | Q7 |
| RX | Q8 |
| RT | Q9 |
| OFA | Q10 |
| OSC | Q12, Q16 |
| OFT | Q13 |
| OP | Q14 |
| OH | Q15 |
| RU | Q18 |
| RS0 | none. It encodes the recommended answers to Q5–Q8 and Q17 in the registry and the lock. If the user picks otherwise before RS0 starts, the orchestrator edits its acceptance; after it lands, the change is a widen |

No question of their own: RS0, RDM, RF, RW, RC2, RM, ODR and RZ. RS0, RDM, RF and RW can start now. RC2 waits for RX
(Q8), and ODR waits for RC1 (Q5) through its dependencies.

## Risks

- **Note noise.** High-frequency Manual rules (R3, K1, C1, D4) can post a note on almost every roll. The notes are
  GM-only, tagged and grouped with their action. If the GM finds them noisy, a "collapse Manual notes" filter in the
  feed is a follow-up, not this plan.
- **A1 Manual: the player decides armor, but the note is GM-only.** The public hit row still shows the severity, and
  the player fixes HP and armor on the sheet.
- **Hot files.** RA, RC1, ODR, OE and OP each own `convex/lib/combatActions.ts` in turn. A late merge conflict means
  rebasing onto `rebuild` before the squash.
- **Lock bypass.** The lock covers `ruleSettings.set` and, if Q17 is (a), `campaigns.setOption`. Engine reads are never
  locked: a mode changed between sessions applies at once.
- **Frame defaults.** If RD2 merged before the RD1 migration ran, running campaigns would silently lose Less Lethal,
  Transformations, Endurance Countdowns or Remnant Corruption. RD2 is marked `needs: migration run`.
- **Out of scope:** homebrew content copies (part B), the Lorekeeper suggesting a switch from a typed house rule
  (part C), and spotlight undo (bead dcm-bxp.99.32.10).

## Open questions

The recommended option is in bold. Tracers are built on it unless the user answers otherwise.

**Q1. Existing campaigns when the four frame rules turn off by default** (Less Lethal HF p.127, Transformations HF p.34,
Endurance Countdowns HF p.176: "You can heighten the tension of traveling through the wilderness with this optional
rule"; Remnant Corruption CB p.295: "OPTIONAL RULE: CORRUPTION TRACK"). → RD1, RD2
- (a) **Running campaigns keep what they have today (on, unless the GM turned it off); only new campaigns start off.**
- (b) Every campaign turns them off, including running ones.
- (c) Running campaigns keep them, and the GM sees a one-time "These frame rules are now optional" notice.

**Q2. R3 Manual: what stops?** CB p.154: "Whenever a PC rolls with Fear, you gain a Fear." CB p.90: on a roll with Hope
the player gains a Hope. → RA
- (a) **Only the GM's Fear stops rising by itself. The player's Hope on a roll with Hope stays automatic. The GM gets
  "Mira rolled with Fear: gain 1 Fear?".**
- (b) Both stop. The GM gets a note for each, and the player adds their own Hope on the sheet.
- (c) Both stop, and only the GM gets notes; the GM adds the Hope too.

**Q3. K1 Manual: countdowns.** CB p.162: "ticks down every time a player makes an action roll, regardless of the
result". The list said "new countdowns start unarmed". → RK
- (a) **Armed countdowns stop ticking by themselves. After each PC action roll the GM gets one note naming the armed
  countdowns ("Action roll: tick Ambush (3), Collapse (5)?"). No note when none is armed.**
- (b) As the list said: new countdowns start unarmed, and already armed ones keep ticking. No notes.
- (c) Like (a), but without notes: the GM ticks by hand.

**Q4. S2 Manual: players act while the GM has the spotlight.** CB p.100: "When play passes to the GM, the GM can make a
move to spotlight an adversary … Once the GM has finished, play passes back to the PCs." → RS2
- (a) **The action goes through. The player sees "The GM has the spotlight" as a warning (not a refusal), and the GM
  gets "Mira acted while you held the spotlight".**
- (b) A warning only, no note.
- (c) A note only, no warning.

**Q5. D6 variant "GM picks the extra Minions" (not in the books).** CB p.201: "For every X damage a PC deals to this
adversary, defeat an additional Minion within range the attack would succeed against" (the book doesn't say who
picks). → RC1
- (a) **The Minion picker opens on the GM's screen instead of the attacker's. The attack waits until the GM picks,
  like an out-of-range request.**
- (b) The app picks the nearest Minions by itself.
- (c) Drop the variant (Book and Manual only).

**Q6. M3 variant: darkness.** CB p.104: "Darkness can also make certain actions more challenging. The GM should
reflect this by raising the Difficulty of action rolls or imposing disadvantage on rolls made by the PCs." The book
gives no number. → OE (and RS0's literals)
- (a) **Two variants: "Dim light: disadvantage" (PC ranged attacks in dim light get the disadvantage die by
  themselves; the badge already says this) and "Dim light: +2 Difficulty" (not in the books: the number is ours).**
- (b) Only "Dim light: disadvantage".
- (c) Only "+N Difficulty", with N set by the GM in the row (1–4, default 2).

**Q7. F2 variant "Extended downtime".** CB p.181: "If you're fast-forwarding the story across multiple days (or
longer) … You gain 1d6 Fear per PC". This is a choice for one rest, not a campaign rule. → RR
- (a) **The mode adds an "Extended downtime (several days)" choice to the GM's long rest. A rest taken that way gains
  1d6 Fear per PC; other rests follow the book.**
- (b) While the mode is on, every long rest gains 1d6 per PC.
- (c) Drop the variant; always offer the extended choice in Book mode.

**Q8. X1 and X2: one row or two?** CB p.106: "when you mark your last Hit Point, you must make a death move" / "roll
your Hope Die. If its value is equal to or under your character's level, they gain a scar". → RX, RS0
- (a) **Two rows. X2 is read-only ("Needs the death move prompt") while X1 is Manual.**
- (b) One row, "Death moves: Book / Manual", covering both.

**Q9. Spotlight Tracker (optional).** CB p.89: "We recommend that you start with three … each time they make an action
roll or perform a significant action while in the spotlight, they remove 1 token … Once every player has used all
their available tokens, players refill." → RT
- (a) **The GM sets N (1–6, default 3) in the row. Each PC action roll removes a token by itself. At 0 the player is
  warned, not refused. When every PC on the live map is at 0, all refill. The GM can refill by hand.**
- (b) Same, but a PC at 0 is refused until the refill.
- (c) Tokens are a counter the players click themselves; the app never removes them.

**Q10. Falling and collision (optional).** CB p.168: "A fall from Very Close range deals 1d10+3 … Close range deals
1d20+5 … Far or Very Far range deals 1d100+15 physical damage, or death at the GM's discretion … collides … they take
1d20+5 direct physical damage." → OFA
- (a) **A GM button in the token menu: pick the height or Collision. The app rolls and hits the PC through the normal
  hit path (Armor Slot prompt, except collision, which is direct). Far falls note "or death at the GM's discretion".**
- (b) The button only rolls and posts the number; the GM applies it.
- (c) (a), but the GM can change the dice before rolling ("increase or decrease the damage dice to fit the story").

**Q11. Underwater (optional).** CB p.168: "Attack rolls underwater have disadvantage unless it makes sense for a
character to easily fight underwater … Set the countdown die's starting value to 3 or higher … Tick down once whenever
any PC takes an action underwater … Once the countdown ends, a PC underwater must mark a Stress whenever they take an
action." → OE
- (a) **The GM marks a Combat Map scene Underwater. Attack rolls in it get disadvantage, except creatures the GM marks
  "fights underwater". A breath countdown (start 3, the GM may change it) ticks once per PC action roll. On a failure
  or a roll with Fear the GM gets "Tick breath once more?". At 0, every PC action roll marks 1 Stress.**
- (b) Same, but the extra tick on a failure or Fear happens by itself (twice if both).
- (c) Only the disadvantage; the GM runs the breath countdown as a normal countdown.

**Q12. Gold coins (optional).** CB p.104: "you can add coins as your lowest denomination. Following the established
pattern, 10 coins equal 1 handful." → OSC
- (a) **A Coins row (0–9) on the sheet's gold, shown only when on. 10 coins roll into 1 handful, like handfuls into
  bags.**
- (b) Coins are a free number with no roll-over.

**Q13. Fate rolls (optional).** CB p.168: "asking a player to roll only their Hope or Fear Die to decide the result …
nor does the roll result grant Hope or Fear." → OFT
- (a) **A "Fate roll" in the GM's roll panel: pick a PC and the Hope or Fear Die, plus an optional note ("On a 4 or
  lower, the fire spreads"). The app rolls that die and posts it publicly. No Hope or Fear.**
- (b) The GM sends a request, and the player rolls it in their dice box.
- (c) A "Fate roll" button in every player's dice box, with no GM step.

**Q14. Conflict between PCs (optional).** CB p.168: "On an attack roll against a PC, the attacker rolls against the
defender's Evasion, just like an adversary. On any other kind of action roll, the instigator makes an action roll and
the target makes a reaction roll." → OP
- (a) Attacks on PCs as in (b), and a GM "Contest" request: the instigator makes an action roll and the target a
  reaction roll, and the instigator must beat the reaction total.
- (b) **Only attacks: a PC can target another PC's token. The roll is against the defender's Evasion, and the damage
  goes through the normal hit and Armor Slot path. Other conflicts stay at the table.**
- (c) A reminder only; no engine change.

**Q15. Horizon encounter bonuses (optional).** HF p.171, Encounter table: "4 … temporary setback … Optional: The GM
gains a Fear for each PC." / "12 … a bit of good fortune … Optional: Each PC gains a Hope." The app rolls whether an
encounter happens but not which entry. → OH
- (a) The app also rolls the d14 Encounter table. On 4 or 12 with the switch on, the bonus applies by itself.
- (b) **Two GM buttons in the crawl panel, shown only when on: "Setback: +1 Fear per PC" and "Good fortune: each PC
  +1 Hope".**
- (c) Reminder text in the panel only.

**Q16. Shared domain cards (optional, off by default).** CB p.21: "If a fellow player's class has the same domain as
yours, we encourage you to coordinate with them and choose different cards … However, if the GM and players agree,
feel free to make an exception." → OSC
- (a) Off: a card another PC already holds can't be taken (refused). On: no check.
- (b) **Off: the pickers show "Mira already has this card" but still allow it (the book only encourages). On: no
  warning.**
- (c) Off = today (no check); On = nothing changes either. Drop the switch.

**Q17. Does the live-session lock cover today's campaign options too** (Hope & Fear content, frame rules, Wither stays
across sessions, also in the dashboard's Campaign Rules panel)? → RS0, RU
- (a) **Yes: every switch in House rules and the Campaign Rules panel is locked while a session is live.**
- (b) Only the new rule switches.

**Q18. Where players read the list.** Players have no settings gear today. → RU
- (a) **A "House rules" item in the Preferences popover (avatar) opens the same list read-only.**
- (b) The dashboard's Campaign Rules panel lists the modes for players.
- (c) Players don't see it in the app; the Lorekeeper answers questions about it.
