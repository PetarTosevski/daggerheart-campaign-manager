# TASK DA16: the GM can move Purposeful Design's +1

Plan `.omc/plans/drawer-answers.yaml`, tracer DA16 (bead dcm-bxp.99.19.54). Follows DA11 (`docs/tasks/TASK-DA-DA11.md`),
which answered its three questions here. Book pages are printed pages (CB = Core Book).

CB p.53, Clank, Purposeful Design: "At character creation, choose one of your Experiences that best aligns with this
purpose and gain a permanent +1 bonus to it."

User answer 2026-10-30: the player picks once; the GM can move the +1 to another Experience later as a correction.
Removing that Experience drops the +1 and offers the pick again. The shown value may reach +11.

## What was built

| Piece | Where | What |
|---|---|---|
| Move | `characters.choosePurposefulDesign` (`convex/characters.ts`) | Loads the character with `need: "edit"`, exact up to `owner` (`loadCharacter`, which decides through `permissionFor`). The owner (`edit`) picks once; a second pick is `INVALID`. The GM (`owner`) may pick or move: the flag leaves the old Experience and goes on the new one. Moving it onto the Experience that already holds it is a no-op with no row. Refusals unchanged: `FEATURE_NOT_OWNED` (no Purposeful Design on the sheet), `NOT_FOUND` (no such Experience). |
| Feed row | same | Every pick or move writes one public, undoable `feature` row with the sheet before it (`logAction`); `actionLog.undo` puts the flag back. |
| Removal | `removeExperience`, `updateSheet` (unchanged) | The flag lives on the Experience, so removing it removes the +1; the sheet then has no choice and offers the pick again. Pinned by tests. |
| +11 | level-up cap (`MAX.experience` in `src/lib/domain/level-up`, unchanged) | Counts the stored value, so a stored +10 shows +11. Pinned by tests. |
| Sheet | `sections/identity.tsx` | `PurposefulDesignPick`: the owner sees it while no Experience is chosen (also after the chosen one is removed); the GM also sees it after, as "Correction: move Purposeful Design's +1 from X to" with a "Move" button listing the other Experiences. The modifier field takes up to `+10 + bonus`, so typing +11 on the chosen Experience saves a stored +10 (before, it clamped to +10 and saved +9). |

## Tests

- `tests/convex/purposeful-design.test.ts`: the owner's second pick is `INVALID`; the GM moves it (one undoable row, a
  no-op move writes none, undo moves it back, rolls follow it); the owner's first pick writes one undoable row; removing
  the chosen Experience lets the owner pick again; a non-holder is refused for the GM.
- `tests/unit/purposeful-design.test.ts`: the level-up cap counts the stored value (+9 → +10 stored, +11 shown; +10 is
  capped); the sheet hides the owner's pick once chosen, offers it again after removal, shows the GM's Move, and a
  typed +11 saves +10.
- `tests/convex/authz/characters.entries.ts`: the `choosePurposefulDesign` row's note (access unchanged: `own`).

## Notes

- The acceptance line says "INVALID on a non-holder"; the mutation keeps DA11's `FEATURE_NOT_OWNED` for a sheet without
  the feature (tested in DA11 and here, and in the authz `okCodes`).
