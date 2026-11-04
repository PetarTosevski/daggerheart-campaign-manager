# TASK CA8: Combat actions end to end, accessibility and the recorded rulings

Plan `.omc/plans/combat-actions.yaml`, tracer CA8 (bead dcm-bxp.99.4; depends on CA6, CA7 and the ten CE-* tracers).
Analysis: `.omc/autopilot/combat-actions-analysis.md` (git-ignored). Book pages are printed pages; CB = Core Book.

## What landed

| File | What |
|------|------|
| `tests/unit/card-effects/coverage.test.ts` | Across all ten domain tables: every card classified combat or passive (196 of 210) has exactly one entry in its own domain's table; no out-of-combat card has one; every entry is a real card. Every use of every entry (310 uses) runs through `run()` without throwing in one generic context. A refusal must be a structured `RunRefusal`; 5 uses are refused because the generic context lacks an input they need, and the per-domain tests run those with the right inputs. Prints the `manual` steps per domain (U3, Q9). |
| `tests/e2e/combat-actions-flow.spec.ts` | Three browsers: the GM and two players (`e2e-player`, `e2e-player2`). See "The flow" below. |
| `tests/e2e/combat-actions-a11y.spec.ts` | Axe (no serious or critical violation) on the player's Hand, the Attack bar (idle, with a target picked, with a result), the dice box (after a roll; the WebGL canvas is excluded with a reason) and the GM's Resolutions (with a hit and Undo), at 1440 and 390 px. At 390 the player's parts are the bottom sheet's tabs (Q11); no sideways scroll for either role. |
| `docs/game-interpretation.md` | New section "Combat actions on the Combat Map (player side)": U1-U5, Q1-Q11 as answered on 2026-10-21, and the user's 2026-10-22 answers on the player side, with book pages. Q12-Q19, the adversary side, are left to AA6, which owns a section in the same file. |

No product file changed.

## The flow (combat-actions-flow.spec.ts)

Every locator is a role or a label, except the result test ids that CA5 and CA6 already use. That way the sheet-drawer
wave (SD2/SD4/SD5/SD6/SD8), which will move the Attack bar and the reaction window, should not break the spec.

1. **Seed.** Ash is a Wizard owned by player A. The GM raises Ash to level 3 (`levelUp.correctLevel`). Ash takes Book
   of Korvax from the Domain Deck (`characters.takeCard`), and Book of Illiat goes to the vault. Bryn is a Warrior owned
   by player B. The enemies are custom blocks that any roll hits (Difficulty 1) and that take Major from any damage
   (thresholds 1/100): Bandit, Raider and two "Minion (1)" Rats.
2. **Attack (R1, R3, U1).** Ash taps the Bandit and attacks with the Rapier. Ash's player sees Hit and no enemy words.
   The GM's Resolutions row reads "Major → 2 HP (2/5)".
3. **Multi-target card and Stress card.** Ash casts Wild Flame (Book of Tyfar, CB p.332) on the Bandit and the
   Raider: "Make a Spellcast Roll against up to three adversaries within Melee range. Targets you succeed against take
   2d6 magic damage and must mark a Stress". One roll gives two Hit verdicts. Each enemy marks 2 HP and 1 Stress
   (R5, R9). This one card covers both the "multi-target card" and the "Stress card" items of the acceptance.
4. **GM undo (U4, Q10).** The GM undoes Wild Flame from Resolutions. Both enemies go back to their state before it
   (the Bandit at 2 HP, 0 Stress; the Raider at 0, 0). The players' mini feed shows "(undone)".
5. **Reaction-roll card (Q7).** Ash casts Recant (Book of Korvax, CB p.332): "Spend a Hope to force a target within
   Melee range to make a Reaction Roll (15)". A Hope is spent. The GM's row reads "Raider: reaction N vs 15 →
   succeeds|fails". The player's result has no enemy numbers.
6. **Recall (R7, CB p.101).** Ash recalls Book of Illiat from the vault for "Recall: 2 Stress". Ash's Stress goes up
   by 2.
7. **Minion pick (Q6, CB p.201).** Bryn attacks a Rat, which is Defeated. Bryn opens "Pick Minions", adds the
   second Rat and presses "Defeat 1". Both Rats are defeated.
8. **A rest brings back a card (Q3, CB p.101, p.105).** Bryn uses Deft Maneuvers (once per rest). It greys to
   "Deft Maneuvers, used: Back after a rest". The GM runs a short rest (`rests.start` / `rests.finish` through the
   API), and Deft Maneuvers is ready again.
9. **U1 over the network.** From the start, each player's browser keeps every websocket message and every JSON
   response it receives. The spec parses them. In every object that names an enemy (one of its own values is an
   encounter instance id or an enemy token id), no field named `hp`, `hpMax`, `stress`, `stressMax`, `major`, `severe`,
   `difficulty`, `thresholds`, `stats` or `adversaryBefore` may appear at any depth. The spec also checks that such
   objects were received at all, so the check is not vacuous.

## Rulings quoted (printed pages)

The full list, with book quotes, is in `docs/game-interpretation.md`. The rulings that this tracer's specs check:

- **U1** (CB p.157: "You can choose to keep this Difficulty secret or tell the player what they're aiming for up
  front"). Checked by the network scan and by the result text checks.
- **U4.** Checked by the GM's Undo of Wild Flame.
- **Q3.** Checked by Deft Maneuvers greying out and coming back after a short rest.
- **Q6** (CB p.201: "Tell the attacking PC which other Minions within range the attack would succeed against and let
  them choose which Minions they defeat"). Checked by the Minion pick.
- **Q7** (CB p.161). Checked by Recant's server-rolled reaction.
- **R7** (CB p.101: "To immediately switch a card from your vault to your loadout, mark a number of Stress equal to
  the vaulted card's Recall Cost"). Checked by the recall.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `pnpm test` (vitest, `--maxWorkers=3`): 321 of 323 files passed under a load average near 30. The two failures were
  `tests/convex/auth-signup.test.ts` (a time-based rate-limit count: 64 vs at most 63) and
  `tests/convex/schema-guard.test.ts` (a 15 s timeout). Neither file is touched here, and both pass when run alone
  (49 tests).
- `coverage.test.ts` prints `196 cards, 310 uses run; 5 refused by the generic context` (on-the-brink, midnight-touched
  /hope, corrosive-projectile, voice-of-reason, bare-bones). It also prints the manual steps: arcana 13, blade 2, bone 2,
  codex 27, grace 9, midnight 13, sage 19, splendor 11, valor 4, dread 3; total 103.
- e2e, on hand-started servers (`E2E_REUSE_SERVERS=1`, ports 3183 / 3478): `combat-actions-flow.spec.ts` 1 passed and
  `combat-actions-a11y.spec.ts` 2 passed, also together in one run.
- The U1 scan was checked against a known leak: run on the GM's page, it found 32 enemy objects with secret fields
  (the tokens' `stats`). On the two players' pages it found none.
- **The full e2e suite was not run.** About eight agents share this machine, so the orchestrator runs it after merging.

## FOLLOW-UPS

1. **Test sign-in flakes in the browser.** Several runs on this machine stopped at a sign-in, and the GM's sign-in in
   `openCombatMap` (the shared fixture) was hit too. The page stayed on `/signin` with "Test sign-in failed." The same
   e2e provider called directly (`auth:signIn` through `ConvexHttpClient`) succeeded 12 times out of 12, so the
   backend accepts the credentials. The failure seems to be on the browser side of the form's `signIn("e2e", …)`. It
   showed up mostly while the load average was above 20. To reproduce: run any spec that signs in several accounts
   while the machine is busy. `joinAs` in the flow spec presses "Test sign-in" again (up to 3 more times) when the
   form shows its alert. The fixture's own retry is outside this tracer's `owns`.
2. **The card dialog lists creatures out of range.** The Recant dialog (Melee) lists Bryn and both Rats, which are 7-8
   squares away. CA6 lists every creature on the card's side, and an out-of-range pick then waits for the GM's
   sanction (Q1), so this may be by design. Worth confirming with the user: should the dialog grey or sort creatures
   by range band, as the Attack bar's target list does?
3. **Dialog picks carry over.** Wild Flame's picks (Bandit and Raider) were still selected when the next card dialog
   (Recant) opened, because picks made in a dialog ring the tokens on the map (F7-H4). A single-target spell then
   toggles off a creature the player taps if it was already picked. The spec sets the picks explicitly.
4. **The Minion offer opens its dialog by itself** after the attack, and the "Pick Minions" button under Attack
   reopens it. This is a note for spec writers, not a bug: the button sits behind the open dialog.
