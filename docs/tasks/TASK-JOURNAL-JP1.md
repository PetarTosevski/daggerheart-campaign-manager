# TASK-JOURNAL-JP1: Plan view, planned scenes and the GM prep note

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JP1 (wave 3, batch A; depends on J1 and JD4). Bead:
`dcm-z9rz.13`. Briefs and user answers: `.omc/plans/journal-briefs.md`. Design: `reference/designs/journal/journal_views.jpg`,
panel 1 (Sessions / Plan).

## Goal
The GM's Plan view lists the planned scenes: number, type chip, title, text and Done / Playing now / Next. It has
'+ Add scene' and the 'GM prep' parchment. The right column frames the Battle Points panel of the playing Combat scene,
else of the first Combat scene.

## What landed
- **`src/components/journal/plan/index.tsx`**
  - `PlanView` renders the 'Planned scenes' card (`Card` from `../ui`) with '+ Add scene' in its heading. The scene
    rows follow, then the GM prep parchment at the foot of the card, as in the design. While `sessionPrep.get` loads,
    a `role="status"` line shows.
  - `PlanAside` mounts JP2's `BattlePointsPanel` with `sceneId` and `sceneNumber` for `asideScene(scenes)`: the
    playing Combat scene, else the first Combat scene. It renders nothing without a Combat scene.
  - JP2's journal variant of BudgetPanel draws its own card and the title 'Battle points · Scene N', so PlanAside adds
    no second frame.
  - Both read the same `sessionPrep.get` subscription (one cache entry).
- **`src/components/journal/plan/scenes.tsx`**: the scene rows. Each row (`<li aria-label="Scene N">`) shows:
  - the number badge and `TypeChip` (icon and colour from J1);
  - the **title** and the serif **text**, edited in place. Each field keeps a draft only while focused, so it follows
    the server while unfocused (CL7, no effect, no content key). It saves on blur when changed, and Enter blurs.
    `setScene` sends one field per call and is optimistic.
  - the state on the right: '✓ Done', '● Playing now' (green) or 'Next'. 'Next' comes from `nextSceneId`
    (`src/lib/domain/journal/scenes.ts`). The playing scene sits in a gold-ringed panel.
  - the GM's '⋯' scene menu (a disclosure; Escape or a click outside closes it, and focus returns to its button):
    - 'Play this scene' appears for non-combat scenes only (Q7), and never on a played session (the server refuses).
    - 'Mark done' and 'Back to planned'.
    - the four types as pressed buttons.
    - 'Remove scene'.
    - A planned Combat scene shows 'Plays when its encounter goes on the Combat Map.' instead of 'Play this scene'.
  - `setSceneState` is optimistic with `applySceneState`, which mirrors the server's `playScene`: the scene that was
    playing becomes Done.
  - A Combat scene mounts JP2's `SceneEncounter` (`sceneId`, `sceneNumber`) under its text.
  - '+ Add scene' is a brand `pill` button and is optimistic: a `pending:` row stays disabled until the server's id
    arrives. It is disabled at `MAX_SCENES`.
  - An empty plan shows the old Prep hint.
  - Each row has its own error alert.
- **`src/components/journal/plan/gm-prep.tsx`**: `GmPrep`, the session's hooks text on a `Parchment` labelled
  'GM prep'.
  - `prepBlocks` turns consecutive '- ' lines into one bullet list. Other lines become paragraphs and blank lines are
    dropped.
  - 'Edit' opens a textarea with focus inside. Leaving the field saves through `sessionPrep.setHooks` (optimistic,
    only when changed) and shows the paper again.
  - An empty note shows a hint.
- **`src/components/journal/plan/plan.css`** (`jp-*`) holds the row layout, the in-place fields (borderless until
  hover or focus), the state colours, the playing ring, the menu, the parchment edit button and textarea, 44 px targets
  on tablets and coarse pointers, and the phone layout (the title wraps under the chip and state).
- **Tests**
  - `tests/unit/journal/plan-scenes.test.tsx` covers:
    - the pure helpers (`applySceneState` including a double click, `sceneBadge`, `asideScene`, `prepBlocks`);
    - rendering and loading;
    - `SceneEncounter` in Combat scenes only;
    - blur-save of the title and text;
    - every menu action;
    - the Combat and played-session rules;
    - Escape and focus;
    - add, MAX_SCENES and the empty state;
    - pending rows;
    - GM prep view and edit;
    - PlanAside's pick and loading.
  - `tests/e2e/journal-plan.spec.ts` sets the design's titles and states, then checks:
    - the scenes, states and GM prep bullets, with axe and no sideways scroll at 1440x900 and 390x844 (plus axe with a
      menu open);
    - add → type → title / text → play (the Combat scene becomes Done) → reload → mark done (Next moves) → remove;
    - the Combat scene's menu;
    - GM prep edit and reload.
  - `tests/e2e/visual/JOURNAL-JP1.spec.ts` (`E2E_VISUAL=1`) takes the shots listed below.

## Buttons
'+ Add scene' uses `brandButton({ variant: "pill", size: "sm" })`, the design's rounded outline. The scene menu
trigger, its items and the parchment 'Edit' are small text buttons in `plan.css`. They are menu rows and a control on
paper, not brand buttons.

## Design states matched (shots)
Shots: `test-results/visual/JOURNAL-JP1/` (`gm-plan-page-{1440,390}`, `gm-plan-{1440,390}`, `scene-menu-1440`,
`gm-prep-edit-1440`), copied to `C:\Users\Petar\Downloads\dcm-screens\journal-jp1\`. Compare them with the design's
panel 1, centre and right columns. The following match:
- the card with the gold serif 'Planned scenes' and '+ Add scene' on the right;
- the rows split by rules, each with the number badge, the coloured type chip and icon, the bold title, the serif text
  and the state on the right (✓ Done muted, ● Playing now green, Next muted);
- the playing Combat scene in a gold-ringed panel with its encounter card (JP2) inside;
- the cream 'GM PREP' parchment with serif bullets at the foot of the card.

The Battle Points column and the encounter card are JP2's: in this branch they are still J1's stubs, so the right
column is empty until JP2 merges. Beyond the design, the GM gets the '⋯' scene menu, because the design draws no
controls and the state, type and remove actions need a home.

## Data gaps
None for JP1. The e2e seed (`tests/e2e/journal/helpers.ts`, not in owns) sets no titles or states, so both specs set
the design's titles and states through `setScene` / `setSceneState` after `seedJournal`. A later tracer that owns the
helper could move that into the seed.

## Questions (default taken, not blocking)
1. **Combat scenes and 'Play this scene'.** Q7 makes Combat scenes play from the Combat Map, so their menu has no
   'Play this scene', only a hint. 'Mark done' and 'Back to planned' stay, so the GM can close or reset a fight by hand.
   The alternative is to also let the GM play a Combat scene from the plan.
2. **The ring.** The brief rings 'the playing Combat scene'. JP1 rings whichever scene is playing, Combat or not, so
   the current scene always stands out. The alternative is to ring Combat scenes only.
3. **A new scene's type.** '+ Add scene' keeps the server's default type (Combat, unchanged from the old Prep). The
   GM changes it in the menu. The alternative is a type picker on add, or Exploration as the default.
4. **Remove without confirmation**, as in the old Prep (a scene holds a title and a short text). The alternative is a
   confirm dialog when the scene has an encounter.
5. **GM prep edit mode.** The note shows as paper with bullets, and 'Edit' opens the plain text (the bullets need the
   rendered view). The alternative is an always-editable textarea without rendered bullets.

## Out-of-owns edits
None.

## Merge-time actions
- No Convex file changed, so no codegen is needed.
- After JP2 merges, rerun `E2E_VISUAL=1 … tests/e2e/visual/JOURNAL-JP1.spec.ts`: the shots then include the encounter
  card and the Battle Points column.
- JX2 deletes `src/components/sessions/prep/scenes.tsx` ('Scenes', 'Hooks'), which this view replaces.

## Notes for J1 / JR
- J1's `.jr-parchment-lbl` (`--jr-paper-muted` #8a6d3b on the paper) fails axe colour contrast. `plan.css` darkens it
  to #6b5328 inside `.jp-prep` only. JR's recap parchment hits the same problem, so the shared token should change in
  `journal.css`, which J1 owns.
- The scene title is a one-row `<textarea>` (`field-sizing: content`, Enter blurs), so a long title wraps instead of
  being cut, as in the design's 'Jagged Knife ambush at the camp' at 390 px.

## Checks
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `vitest run --maxWorkers=1 --testTimeout=120000`: 509 files, 10903 passed, 1 expected fail.
  `tests/unit/journal/plan-scenes.test.tsx`: 16 passed.
- `E2E_PORT=3789 E2E_CONVEX_PORT=3889 E2E_REUSE_SERVERS=1` (hand-started servers, `--workers=1`):
  - `tests/e2e/journal-plan.spec.ts`: 3 passed.
  - `tests/e2e/visual/JOURNAL-JP1.spec.ts` (`E2E_VISUAL=1`): passed.
  - `tests/e2e/journal-shell.spec.ts`: 2 passed. One earlier run failed on a sign-in / 1 s function timeout at load
    average 18, then passed when rerun.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml JP1`: OK.
