# TASK-CONFIG-P1: Preferences server

Plan `.omc/plans/config.yaml`, tracer P1 (bead dcm-jh6d.7). Server only: the account's preferences, a single-field
setter, the one-time legacy import and hand folds. No UI changes.

## API (`convex/preferences.ts`)

| Function | Wrapper | Args | Returns |
|---|---|---|---|
| `preferences.get` | `userQuery` | `{}` | resolved `Preferences` (defaults when no row) + `legacyImported: boolean` |
| `preferences.set` | `userMutation` | `{ change: { key, value } }`, one of `dice3d`, `diceSound`, `diceVolume` (integer 0-100), `reduceMotion`, `textSize`, `spotlightPing` | `null` |
| `preferences.importLegacy` | `userMutation` | `{ dice3d?, diceSound?, folds: { campaignId: string, characterId: string }[] }` (at most 50) | `{ imported, folds }` |
| `preferences.folds` | `campaignQuery` `need: "view"` | `{ campaignId }` | the caller's folded `Id<"characters">[]` in that campaign |
| `preferences.setFold` | `campaignMutation` `need: "view"` | `{ campaignId, characterId, folded }` | `null` |

- `set` creates the row on first write and patches only the changed field. A volume that isn't an integer in 0-100
  throws `SETTING_INVALID`.
- `importLegacy` runs once per account. The first call stamps `legacyImportedAt`; later calls return
  `{ imported: false, folds: 0 }` and change nothing. It sets `dice3d` / `diceSound` only where the row has no value.
  A fold is skipped, never an error, when: its ids are malformed (strings, `normalizeId`), its character is missing,
  the character belongs to another campaign, the caller can't view that campaign (`campaignAccess` "view", cached per
  campaign), or it is a duplicate or already folded. More than 50 folds throws `INVALID`, before anything is written.
- `folds` reads the caller's rows through `by_user_character` (prefix `userId`, `take(500)`) and keeps this campaign's.
  It never reads another user's rows.
- `setFold` throws `NOT_FOUND` for a character outside the campaign. Folding is idempotent: fold inserts a row only if
  none exists, unfold deletes the row if there is one.

## Authz

`tests/convex/authz/config-prefs.entries.ts`: `get`, `set` and `importLegacy` are class `user`; `folds` and `setFold`
are class `view`.

## Out of owns

- `tests/convex/unauthenticated-sweep.test.ts`: `preferences:get` and `preferences:importLegacy` are added to
  `STRANGER_OWN`. They act on the caller's own row, so a signed-in stranger gets a value, not "nothing", and the sweep
  fails for any such function that isn't listed there. Two lines, like `settings:get`.

## Not done / for the orchestrator

- **`archived: "allow"` on `setFold`:** the acceptance asks for it, but the option comes from G1, which runs in
  parallel, and `campaignMutation` doesn't have it on `rebuild` yet. After G1 merges, add `archived: "allow"` to
  `setFold`; it is one line.
- **Fold rows of a deleted character** stay until their campaign is purged. `folds` may return the id of a character
  that no longer exists, and the client ignores it. Character deletion is outside P1's owns.

## Questions used

Q12 a, Q13 a, Q14 a and Q15 b, through S0's defaults. The N1-N11 questions don't block P1; N3 a (automatic import) is
the client's job (IMP).

## Checks

`pnpm lint` and `pnpm typecheck` pass. Focused vitest passes (`preferences.test.ts`, `authz/config-prefs.test.ts`,
`authz-matrix.test.ts`, `unauthenticated-sweep.test.ts`). On the full suite (`--maxWorkers=1 --testTimeout=120000`),
only the sweep's two stranger rows failed, and the `STRANGER_OWN` lines above fix them; those files were rerun and
pass. `npx convex codegen` was
run locally; `_generated` is not committed.
