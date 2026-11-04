# TASK-HUD-H3.2: weapon attacks through the picking panel; riders, forced attack, Lead by Example, Minions

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 4 batch B, tracer H3.2 (boards CmpPicking 'Weapon attack',
CmpPromptsPlayer 'With this attack', 'Forced attack', 'Lead by Example', 'Your hit can defeat 2 more Minions'). Depends
on H3.0 (pick-session API). Parent bead dcm-bxp.99.32; fold-ins dcm-y3e (UI half) and dcm-5dg (both offered by the
server today, both folded in). Mode: add; renders only inside the HUD shell (switch on, Play, players).

## What landed

All in `src/components/combat-map/hud/pick-attack/`:

| File | What |
|---|---|
| `model.ts` | Pure: the session spec (`attackSession`, `attackPatch` for every data change), the primary label ("Attack the Bandit with Shortstaff"; party members without "the"), footer cost line ("With 1 rider · Spends 1 Hope, 1 Stress"), CmpBlocked layer-1 reasons ("Needs 2 Hope · you have 1", an unanswered rider option, no weapon), `combatActions.attack` arguments (reusing the classic `ridersToSend` / `riseToSend` / `riderProblem`), extra targets (`mostTargets`), forced-attack rule + rows, Lead by Example options, Hit / Miss / Defeated report, and the Minion pick session. |
| `use-attack.tsx` | **`useAttackPicker(state)`: the entry point for H3.4** (below). Reads the sheet (`characters.get`), `combatActions.riders` per equipped slot, `combatActions.targets` (benefits), `combatRequests.forcedAttacks`, the classic `mods.ts` (`picksTrait`, `extraTargets`, `offersSpiritWeapon`), and sends `combatActions.attack`. |
| `rows.tsx` | The panel's `extra` rows: weapon tiles (`.wpn`: name, trait · range · damage at Proficiency), trait pick (dcm-5dg), Use as Spirit Weapon, Lead by Example radios ("before you roll"), roll chips (Experiences with a Hope pill, Advantage and Help steppers), "With this attack" riders as HUD `Toggle`s with `CostPill`s and what an on rider asks (numbers, options, situations, more targets). |
| `prompts.tsx` | `HudAttack` (pop region, players): the red 'Forced attack' card ("<feature> · you must attack", lock chip "Target: …", primary "Attack <target>" opens the panel locked), the 'Your hit can defeat N more Minions' card (Pick Minions → the panel with the candidates as rows and rings, "Defeat N"; Skip sends none, optimistic), the last result line ("Bandit: Hit · your damage 9", or "Your roll waits: answer it in Map tools"), and the **interim "Weapon attack" button**. |
| `report.ts` | A tiny external store (`useSyncExternalStore`) for the last report, so the opener (ring) and the line (pop region) share it. H4.1 may read it. |
| `attack.css` | Board values on the `--hud-*` tokens; 44 px chips at ≤ 760 px. |

### Entry point for H3.4 (action ring)

```tsx
import { useAttackPicker } from "../pick-attack";
const attack = useAttackPicker(state);        // inside the HUD shell (needs usePick)
<button disabled={!attack.ready} title={attack.reason ?? undefined} aria-pressed={attack.isOpen} onClick={() => attack.open()}>Attack</button>
attack.open({ slot: "secondary" });           // start on the off-hand weapon
attack.open({ forcedRequestId });             // a forced attack (attack.forced lists them)
```

`ready` is false for the GM, without a token / weapon, or while the reads load (`reason`). `open` must run from a click.
Picks made on the map before (classic `useCombatTargets`) carry over (the latest win).

### Out-of-owns edit

- `src/components/combat-map/hud/shell.tsx`: import + `<PartBoundary label="The attack prompts"><HudAttack state={state} /></PartBoundary>` in the pop region (4 lines). The forced-attack and Minion prompts and the result line need a mount; nothing else in the shell changed.

## Board states matched

- CmpPicking 'Weapon attack': same rings and rows as H3.0; tiles, chips, one primary "Attack the <target> with <weapon>". Matched (in the panel, not a separate bar).
- CmpPromptsPlayer 'With this attack': riders as switches with cost pills inside the same panel; the footer says "With N rider(s) · Spends …" (the board's "Attack with 1 rider" button is the panel's one primary naming the target).
- 'Forced attack': red card, sub "<feature> · you must attack", lock chip, "Attack <target>"; the panel shows the target picked, rows not tappable, rule line "<adversary>’s <feature>: the target is locked".
- 'Lead by Example': radio rows ("Clear a Stress" / "Gain a Hope") in the panel once the marked target is picked; the first is preselected (as the classic bar and the server default).
- 'Your hit can defeat 2 more Minions': card + panel rows (with rings), "Defeat N", Skip; a group token holding several Minions gets a "Minions from <name>" stepper.
- No visual-shot spec this tracer (time); `tests/e2e/hud-attack-pick.spec.ts` covers the states with axe. Follow-up: a `visual/HUD-H3.2.spec.ts` can reuse its setup.

Deviations: Advantage and Help are steppers (the server takes counts; the board's single "Advantage" chip and "Brannoc helps (d6)" chip can't express disadvantage or named helpers, the engine has no helper identity). The forced card's button reads "Attack Jagged Knife Lieutenant" (no "the": the card doesn't know the side); the panel's primary uses "the" for adversaries.

## What moved out of the old column

Nothing removed (mode add). The HUD now covers the classic Attack bar's weapon attack, riders, forced attack, Lead by Example, trait pick, extra targets, Spirit Weapon and the Minion pick. Still in Map tools: the after-roll hold ("Your roll waits") and the Death Strike rider pick (classic `AfterRollPrompt` / `RiderPickPrompt`), the full dice result (H4.1).

## Tests

- `tests/unit/hud/attack-pick.test.tsx` (14): model (labels, cost pills and footer, blocked reasons, attack args incl. disadvantage / trait / riders / benefit, extra targets dcm-y3e, Spirit Weapon, forced rule + rows, reports, Minion picks); HUD (tiles + chips + rider pill + send args + result line; weapon switch; out of range → pending closes; forced card locked + forcedRequestId; Lead by Example radios + benefit; Minion card → rows → Defeat 2, Skip; GM gets nothing).
- `tests/e2e/hud-attack-pick.spec.ts` (2): player attacks a Minion through the panel (tile, chip → "Spends 1 Hope", primary label, axe), Defeated line, Minion offer → panel row → "Defeat 1" → both defeated on the server; forced attack (internal e2e seed) → red card, locked row, no GM line, resolves, request gone, axe.

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean. tracer-guard: OK (plus the `hud/shell.tsx` mount above).
- vitest focused: `tests/unit/hud` 12 files, 155 passed (14 new). Full suite (`--maxWorkers=2 --testTimeout=120000`): 457 files,
  10303 passed + 1 expected fail.
- e2e (ports 3172 / 3456): `hud-attack-pick.spec.ts` 2 / 2; all `tests/e2e/hud-*.spec.ts` 16 / 16. (First run: the forced
  test clicked a locked row, which is `aria-disabled` by design; the spec now asserts that.)

## Beads

- dcm-y3e (UI half) and dcm-5dg: folded in (the server offers both via `extraTargets` / `weaponTrait` mods and "choice" weapons); not closed (orchestrator).
- No new beads.

## Merge-time actions

- Accept the `hud/shell.tsx` mount (4 lines).
- H3.4: call `useAttackPicker(state).open()` from the ring's Attack; then remove this tracer's interim "Weapon attack" button (`prompts.tsx` `.hud-atk-launch` button; keep the result line) and H3.0's interim Attack (dcm-bxp.99.32.18). H3.4 needs `hud/pick-attack/prompts.tsx` in owns for that, or do it at merge.
- No Convex change, no codegen, no schema, no authz entry.

## QUESTIONS (safest reversible defaults taken)

1. **GM "Play for" attacks.** The picker is player-only (as H3.0's), because `combatActions.attack` from the GM for a PC is reached in the classic drawer. Default: GM attacks for a PC stay in Map tools until H3.4/H5.x ask for it.
2. **Footer Hope check includes rider Hope costs** (classic checked Experiences only). The server refuses a short payment anyway; this only greys the primary earlier with "Needs N Hope · you have M".
3. **Advantage / Help as steppers** rather than the board's toggle chips (see Deviations). Confirm, or say how named helpers should work (the engine takes a Help die count only; CB p.95 "Help an Ally" spends the helper's Hope, which the attacker's client doesn't do).
