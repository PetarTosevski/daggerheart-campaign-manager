# TASK-CONFIG-U6c: Hide cards from the account

Plan `.omc/plans/config.yaml`, tracer U6c (bead dcm-jh6d.22). Q15 b: a player's "Hide cards" choice is stored on their
account per campaign and character, so it follows them to every device. The HUD's layout and look are unchanged; only
the place the fold is stored moved.

## What changed

- `src/components/combat-map/hud/hand/use-fold.ts` (new): `useHandFold(campaignId, characterId)` returns
  `[folded, setFolded]`.
  - It reads `preferences.folds` and is unfolded while that list loads.
  - It writes `preferences.setFold({ campaignId, characterId, folded })`, an intent (rule 12), with the optimistic
    update `foldLocally`. That update adds or removes the character in the cached `preferences.folds` list, so the
    fan folds on the click. It does nothing while the list hasn't loaded.
  - If the write is refused, Convex rolls the optimistic fold back and the HUD toast shows the refusal
    (`hudToasts.refusal(refusalFor(error))`).
- `src/components/combat-map/hud/hand/body.tsx`: `useHandFold` replaces the local `useFolded`, which was
  `useViewerFlag(handHiddenKey(...))` plus a per-visit state. The import of `handHiddenKey` is gone, and no
  localStorage read or write for the fold remains. The header comment now says where the fold is stored.
- `tests/unit/hand-fold.test.tsx` (new): `foldLocally` (fold adds once, unfold removes, nothing while loading);
  the hook (reads the folds, writes the intent with `foldLocally`, never touches localStorage, a refusal becomes a
  toast).

## handHiddenKey

`handHiddenKey` stays exported from `src/components/combat-map/actions/hand/index.tsx` (outside owns). Nothing imports
it now. The legacy import (IMP) uses `LEGACY_KEYS.handHiddenPrefix` in `src/lib/config/legacy-prefs.ts`, so the
export can go when IMP lands, or in any later tracer that owns `actions/hand/index.tsx`. Its doc comment ("in this
browser only") is out of date until then. Until IMP lands, an old browser fold stays in localStorage untouched, and
the account shows unfolded (the default for the 2026-11-05 questions).

## Classic actions/hand

The classic hand UI is gone since HUD wave 9 (H8.1). `actions/hand/index.tsx` now holds only the key and shared
helpers (face, model, use-card, result, dock, dialog, sharing). No classic fold UI remains, so no follow-up bead is
needed.

## Out of owns (orchestrator OK'd)

- `tests/unit/hud/hand-states.test.tsx`: the "Hide cards" test asserted no server call. It now expects
  `preferences:setFold` with `folded: true`, and then `false` once the mocked `preferences.folds` list says folded.
  The header line changed to match.

## Notes

- The e2e comments in `tests/e2e/hud-hand.spec.ts` and `tests/e2e/combat-cards.spec.ts` still say "on this screen
  only" / "local only" (HUD answer 16a). They are outside owns; the specs' assertions still hold.
- Unchanged: `combatCards.setHandHidden` (the GM hiding a hand from others) is a separate server field, not this fold.

## Checks

- `pnpm lint` and `pnpm typecheck` pass.
- Focused vitest passes: `hand-fold.test.tsx` and `hud/hand-states.test.tsx`, 25 tests.
- The full vitest suite (`--maxWorkers=1 --testTimeout=120000`) passes: 545 files, 11828 tests, plus 1 expected
  fail and 1 todo.
- e2e on ports 3969 / 4069, `--workers=1`: `hud-hand.spec.ts` and `a11y-combat-hand.spec.ts` give 2 passed and
  1 skipped (the existing `test.fixme`).
