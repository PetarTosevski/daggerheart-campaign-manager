# TASK-JOURNAL-JP2: Plan view: a Combat scene's encounter card and the Battle Points panel

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JP2 (wave 3, batch A, depends on J1 and JD4). Bead:
`dcm-z9rz.14`. Briefs and user answers: `.omc/plans/journal-briefs.md`. Design:
`reference/designs/journal/journal_views.jpg` (panel 1, Plan: scene 3's encounter box and the right column).

## Goal
A Combat scene shows its encounter, or lets the GM create or link one. The right column shows that encounter's Battle
Points. Both reuse the Adversaries builder's own pieces and functions.

## What landed
- **`src/components/adversaries/builder/budget-panel.tsx`**: `BudgetPanel` gains optional `variant?: "builder" |
  "journal"` (default `builder`) and `title?: string`.
  - The hooks, the `encounters.setBudget` intent, the optimistic update, `aria-busy` while saving and the error line
    are shared by both variants.
  - The builder rendering is unchanged.
  - `journal` renders the board's card in Tailwind classes on J1's `--jr-*` tokens, plus the `jr-card` / `jr-lbl`
    classes. It shows:
    - the title, e.g. 'Battle points · Scene 3';
    - the big serif spent number with 'of Y spent';
    - 'Z left', 'On budget' or 'Z over' (the new `leftLabel`);
    - the bar (`role="meter"`);
    - the party formula 'Party of 4: 3 × 4 + 2' with the starting budget;
    - the Minion line when there are Minions;
    - the six adjustments as `aria-pressed` toggles, with a checkbox square, the label, the coloured delta and the
      'Suggested' hint;
    - 'Costs' chips from the new `BP_COST_ROWS`, whose numbers come from `BP_COSTS`.
  - The journal variant has no party stepper. See the questions below.
- **`src/components/journal/plan/battle-points.tsx`** `BattlePointsPanel` (J1's props):
  - Reads `sessionPrep.get` to find the scene's encounter, then `encounters.get` and `campaigns.get` for the tier.
  - Renders `BudgetPanel variant="journal"` titled 'Battle points · Scene N'.
  - A Combat scene without an encounter shows a card with a hint. A deleted encounter says so.
  - Players render nothing and send no query (`"skip"`).
- **`src/components/journal/plan/encounter.tsx`** `SceneEncounter` (J1's props):
  - **Linked**:
    - 'Encounter · <name>'.
    - One chip per stat block from the `encounters.get` instances (exported `encounterChips`): the name, '×N' (a
      Minion group counts its size), then 'type · BP'. BP is the type's cost per instance; Minions are costed per
      party-sized group; summoned or unknown adversaries cost 0.
    - '✓ On the Combat Map' when JD4's `onMap` is set.
    - 'Open map' → `/campaigns/<id>/combat-map`.
    - 'Edit in Adversaries' → `encounterTrackerHref`, which opens the builder and the tracker on that encounter.
    - 'Unlink' (`unlinkSceneEncounter`, optimistic).
  - **None linked**:
    - 'Create encounter' (`createSceneEncounter` through `useIntent`, so it is keyed).
    - A 'Link an encounter' select over `encounters.list` (active, then ended) with a 'Link' button
      (`linkSceneEncounter`).
  - There is no add-adversary dialog (Q6, reuse): adversaries are added in the Adversaries tab.
  - It renders nothing for players or a non-Combat scene.
  - Buttons are the brand ones: `brandButton` `pill` for the links, `solid` for Create, `outline` for Link; Unlink
    uses `jr-ghost`. Every target is at least 44 px.

## Tests
- `tests/unit/budget-panel.test.tsx` covers both variants:
  - the builder's heading, stepper, text and pcs intent;
  - the journal's title, spent / left, meter, formula, costs, no stepper, the adjustment intent, the same optimistic
    update, the pressed state, over budget and `leftLabel`.
- `tests/unit/journal/plan-encounter.test.tsx` covers:
  - `encounterChips` (grouping, Minions, summoned and unknown);
  - the linked card (chips, on-map, links, Unlink, empty, loading, player, non-Combat scene);
  - none linked (Create is keyed, Link with the chosen encounter);
  - `BattlePointsPanel` (journal variant and title, hint, player, loading, gone).
- `tests/e2e/journal-encounter.spec.ts` (the session encounter is placed on a live map in `beforeAll`):
  - the card and the panel as in the design (10 of 14 spent, 4 left), with axe and no sideways scroll at 1440x900
    and 390x844;
  - unlink → Create encounter → 'Harder or longer fight' (0 of 16) → 'Edit in Adversaries' shows the same encounter
    selected, with 'Spent 0 of 16' and the adjustment pressed;
  - linking the old encounter back.
- `tests/e2e/visual/JOURNAL-JP2.spec.ts` (`E2E_VISUAL=1`) writes the shots.

## Mounting (JP1)
JP1 owns `plan/index.tsx` and mounts both components:
- `SceneEncounter` inside each Combat scene card;
- `BattlePointsPanel` in `PlanAside`, for the playing Combat scene, else the first one.

The e2e specs find them by `data-testid` (`scene-encounter`, `bp-panel`), so they do not depend on JP1's markup. They
pass only once JP1 is merged. To check them before that, I ran them against a temporary local `plan/index.tsx` that
mounts the two components, and did not commit it.

## Design states matched (shots)
The shots are in `test-results/visual/JOURNAL-JP2/`, as
`{encounter-card,battle-points,encounter-none}-{1440,390}.png`. They are copied to
`C:\Users\Petar\Downloads\dcm-screens\journal-jp2\`. They were taken with the temporary mounting, so the column widths
are approximate.

Compare them with the design, panel 1 (Plan):
- **Encounter card** (scene 3's red box):
  - 'Encounter · Jagged Knife ambush' in the Combat red.
  - Red chips with 'type · BP': Leader · 3, ×2 Standard · 4, Ranged · 2, ×4 Minion · 1.
  - '✓ On the Combat Map' in green, then the 'Open map' and 'Edit in Adversaries' pills.
  - Differences: chip names are full, and Unlink is extra (questions 2 and 4).
- **Battle points · Scene 3** (right column):
  - Small caps title, a big gold '10' with 'of 14 spent', a green '4 left' and a gold bar.
  - 'Party of 4: 3 × 4 + 2' with 14 on the right.
  - Adjustments with white boxes and red / green deltas, then the 'Costs' chips, in the design's order and numbers.
  - Differences: an extra Minion line, the builder's adjustment labels and their order (question 3), and taller
    44 px rows.
- **No encounter** (not on the board): Create encounter (gold), the link select, Link.

## Questions (default taken)
1. The journal card has no party-size stepper, because the design shows none. The party size is changed in the
   Adversaries builder. Alternative: a small stepper on the 'Party of 4' line.
2. Chips show the full stat block name ('Jagged Knife Bandit ×2'). The design shortens it ('Bandit ×2'). Alternative:
   drop a name prefix that every chip shares.
3. The adjustment labels and order are the builder's (`BP_ADJUSTMENTS`), so both panels match. The design words some
   of them differently.
4. 'Unlink' was added to the encounter card although the design shows none. Without it the GM could not change a
   scene's encounter from the Journal.
5. 'On the Combat Map' shows only when the encounter is on the map. Otherwise that spot is empty.

## Checks
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `vitest run --maxWorkers=1 --testTimeout=120000`: 510 files, 10905 passed, 1 expected fail.
- `E2E_VISUAL=1 E2E_PORT=3793 E2E_CONVEX_PORT=3893 E2E_REUSE_SERVERS=1 playwright test
  tests/e2e/journal-encounter.spec.ts tests/e2e/visual/JOURNAL-JP2.spec.ts --workers=1`: 4 passed. This run used the
  temporary `plan/index.tsx` mounting, on servers I started myself, because the managed build timed out under load.
- The Adversaries e2e specs were not rerun. The builder's JSX is unchanged, and `tests/unit/budget-panel.test.tsx`
  covers its rendering.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml JP2`: OK.

## Merge-time actions
None: no Convex file changed. Merge after JP1, or JP1's mounting must land with it, for the e2e specs to pass.
