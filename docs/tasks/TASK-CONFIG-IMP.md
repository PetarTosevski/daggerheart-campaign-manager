# TASK-CONFIG-IMP: One-time import of browser values into the account

Plan `.omc/plans/config.yaml`, tracer IMP (bead dcm-jh6d.31). N3 (a), user 2026-11-04: the import runs on its own,
once, on the first signed-in load. Nothing to click.

## What changed

- `src/components/config/legacy-import.tsx` (new):
  - `runLegacyImport(storage, alreadyImported, calls)` reads `readLegacyPrefs(localStorage)`
    (src/lib/config/legacy-prefs.ts, from S0). Unless the account already imported, it sends `uiState.importLegacy`
    and `drafts.importLegacy` in parallel, skipping either one when it has nothing to send. Then it sends
    `preferences.importLegacy` with 3D dice, dice sound and up to 50 hand folds (the server's `LEGACY_FOLDS_MAX`).
    That call sets `legacyImportedAt`.
  - Preferences go last on purpose. If UI state or drafts fail, the account stays unmarked and the next load tries
    again. The two other mutations write only unset values, so a repeat run is harmless.
  - The old keys, plus the dead `dcm:combat-hud`, are removed only after every call succeeds. A failure leaves them
    all for the next load. A blocked `removeItem` is ignored.
  - `<LegacyImport />` reads `preferences.get` while signed in. Once `legacyImported` is known, it mounts a child that
    runs the import once from an effect, behind a `useRef` guard. Signed out or still loading, it mounts no mutation.
- `src/app/(gm)/layout.tsx`: renders `<LegacyImport />` next to `AccentSync` and `PrefsSync`, so every signed-in
  app page runs it. The sign-in page is outside this layout.

## Rule 13 / CL6 exception

`LegacyImport` fires mutations from an effect. Rule 13 forbids that, so it is recorded here as an exception, on the
same terms as the campaign shell's `markOpened` (briefs, Risks: "the one-shot import (IMP) is the only remaining
effect-started mutation"):

- A ref guard stops StrictMode's double effect and re-renders from sending the import twice.
- The server is idempotent. `preferences.importLegacy` does nothing once `legacyImportedAt` is set, and the uiState
  and drafts imports insert only rows that don't exist yet. A race between tabs or devices cannot double-write.
- N3 (a) asked for no button, so there is no event handler to put it in.

## First device wins

The first browser to import marks the account. A later browser of the same account then sends nothing and just
removes its old keys, so its values are dropped. This is accepted (briefs, Risks: "Migrating local prefs"). If two
browsers import at the same moment, both may write, but each mutation keeps whichever value was saved first.

## Not touched

- The level-up draft in sessionStorage (`dcm:level-up-draft:*`). The parser never lists it (N4 is being handled by
  another agent).
- Convex Auth's `__convexAuth*` keys, the display cache `dcm:display-prefs`, and any key the app never wrote.
- `handHiddenKey` in `src/components/combat-map/actions/hand/index.tsx` is still exported and unused (see
  TASK-CONFIG-U6c). It is outside IMP's owns. Any tracer that owns that file can delete it.

## Server side

Nothing new. `preferences.importLegacy` (U6a/P1), `uiState.importLegacy` (P2/U6e), `drafts.importLegacy` (P2/U6f)
and `readLegacyPrefs` (S0) were already merged, along with their authz entries.

## Tests

- `tests/unit/config/legacy-import.test.tsx`:
  - The calls carry the right arguments, and preferences goes last.
  - A failure in any of the three calls leaves every key in place.
  - A failed uiState or drafts call never marks the account.
  - First device wins: the keys are dropped and nothing is sent.
  - A browser with only the dead key: the key is removed and nothing is sent.
  - The fold cap holds, and empty calls are skipped.
  - Blocked removal does not throw.
  - The component imports once under StrictMode, waits while signed out or loading, and only drops keys on an
    account that already imported.
- `tests/e2e/config-legacy-import.spec.ts`:
  - Signs in a fresh account with the test form, without `signInAsTestGm`, whose reset to defaults would set the
    values the import fills.
  - Seeds every key, reloads, and finds the keys gone. The account then has the dice settings, all seven UI-state
    values, the fold and both drafts.
  - A second browser on the same account seeds other values and reloads. Its keys go too, and the account keeps the
    first browser's values.
