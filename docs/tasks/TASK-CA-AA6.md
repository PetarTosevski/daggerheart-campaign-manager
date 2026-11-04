# TASK AA6: Adversary actions end to end, feature coverage, accessibility and recorded rulings

Plan `.omc/plans/combat-actions.yaml`, tracer AA6 (bead dcm-bxp.99.9), run as lane D1 of `.omc/plans/lanes.yaml`
(depends on AA3, AA4, AA5, CA8 and the eight AE-* tracers, all merged). Analysis: `.omc/autopilot/combat-actions-analysis.md`
Part B (git-ignored). Book pages are printed pages; CB = Core Book.

## What landed

| File | What |
|------|------|
| `tests/unit/adversary-effects/coverage.test.ts` | Across the eight tier / source tables: all 267 SRD adversaries and their 928 printed features have exactly one entry each, in their own group's table; every entry names a real adversary and one of its features. Every use of every entry (1137 uses) runs through `run()` without throwing in one generic context (spotlit, Fear confirmed, a PC target, an ally, a trigger, every situation confirmed); a refusal must be a structured reason. PRINTS the `manual` steps per group; the counts are not asserted (later lanes reduce them). |
| `tests/e2e/adversary-actions-flow.spec.ts` | Three browsers: the GM and two players (`e2e-player`: Mira, a Bard; `e2e-player2`: Tabby, a Guardian with I Am Your Shield). See "The flow". |
| `tests/e2e/adversary-actions-a11y.spec.ts` | Axe (no serious or critical violation) at 1440 and 390 px on the Encounter tab's action panel (idle; with a result and an open reaction window), the Combat Map's adversary panel (the hint; the Bandit selected; the "Spend 1 Fear?" question; a result) and the player's incoming-hit prompt on the Combat Map. No sideways scroll for either role. |
| `docs/game-interpretation.md` | New section "Combat actions on the Combat Map (adversary side)": AR1-AR11 with book quotes, Q12-Q19 as answered on 2026-10-21, and the 2026-10-22 answers on the adversary side. |

No product file changed.

## The flow (adversary-actions-flow.spec.ts)

1. **Encounter tab (Q12, Q16), I Am Your Shield (Q13, CB p.341).** The GM selects the Bandit (a custom block that
   always hits) and attacks Mira. The result shows the roll; the reaction window waits for Mira's armor choice. Tabby's
   player sees "Bandit hit Mira" with no damage number, uses I Am Your Shield, becomes the target, marks one Armor
   Slot; the hit resolves on Tabby (1 Armor, 1 Stress, HP marked), Mira is untouched, the window closes, Mira's mini
   feed shows "Bandit hit Mira".
2. **Combat Map (Q12 "he can also use combat map"), armor (CB p.114), undo (U4).** The GM selects the Bandit's token
   and attacks Mira from the map panel. Mira's player sees "N damage: Severity (H HP)." and no roll / Evasion / ATK
   words, and presses Mark; Tabby's player passes (Q17). Mira's sheet shows the Armor Slot and the HP. The GM's
   "Adversary resolutions" Undo restores both.
3. **A multi-target Fear feature (AR7, Q19).** The Minor Fire Elemental's Explosion (CB p.214: "Spend a Fear … Make an
   attack against all targets within Close range") asks for its Fear first (`confirmFear`, feature 1 + the second
   spotlight; Fear unchanged until the tap), then makes one d20 roll against Mira and Tabby. Its Momentum adds 1 Fear
   when either is hit, with no prompt. Undo restores the Fear and calls off the open hits.
4. **Momentum (AR8, CB p.195).** The Elemental's standard attack with advantage until it hits: the GM's Fear goes up by
   1 at once; undo takes it back.
5. **Minion Group Attack (AR9, CB p.201).** Three Sellswords (Minion (4), "3 physical damage each", CB p.217): one
   shared d20; on a hit Mira's pending hit carries the combined 9 damage, and her player's prompt reads "9 damage: …".
6. **Q14 / U1 over the network.** From joining, each player's browser keeps every websocket message and JSON
   response. Every object about an adversary (one of its values is an encounter instance or adversary token id, a feed
   row of kind `adversary`, or an incoming hit with `attackerLabel`) must not carry `roll`, `dice`, `total`,
   `modifier`, `attackTotal`, `evasion`, `difficulty`, `hp`, `hpMax`, `stress`, `stressMax`, `major`, `severe`,
   `thresholds`, `stats` or `adversaryBefore` at any depth (the hit PC's own `armorPreview` is skipped: Q14 lets them
   see their own severity). The check also asserts such objects were seen.

SRD dice are random, so steps 3-5 call the server API (the same `adversaryActions` mutations both panels send) and
retry until the case they check comes up (at most 8 tries, each undone). Steps 1-2 use the UI with a block that always
hits.

## Rulings checked (printed pages)

Full list with quotes in `docs/game-interpretation.md`.

- **Q12 / Q16**: an attack from each page; the window opened from either shows on the other (steps 1, 2).
- **Q13 / Q17**: armor choice and I Am Your Shield; the window closes when the target chose and allies answered.
- **Q14 / U1**: prompt text checks and the network scan.
- **Q15**: `coverage.test.ts`.
- **Q18**: the Elemental and the Sellswords are not on the map; they target from the party list.
- **Q19**: Explosion asks "Spend N Fear?" first; Momentum's gain is automatic.
- **AR7 / AR9**: one roll for several targets; combined Minion damage.
- **U4**: undo from Resolutions (UI) and `actionLog.undo` (API).

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `pnpm test` (`--maxWorkers=4`): 361 files, 8899 passed, 1 expected fail.
- `coverage.test.ts` prints `267 adversaries, 928 features, 928 entries` and `1137 uses run; 65 refused by the generic
  context` (all `requirement`: uses gated on a condition, tokens or a state the generic context doesn't have, e.g. Slow's
  token, Hidden, Orbiting Aegis's wards; the AE-* tests run them with the right inputs). Manual steps per group:
  t1-core 29, t1-hf 33, t2-core 18, t2-hf 32, t3-core 26, t3-hf 48, t4-core 21, t4-hf 51; total 258.
- e2e (ports 3125 / 3362): `adversary-actions-flow.spec.ts` 1 passed (3.0 min); `adversary-actions-a11y.spec.ts`
  2 passed (1440 and 390). No axe violations were found, so no product fix beads were filed.
- The full e2e suite was not run here (other lanes share the machine); the orchestrator runs it after merging.
