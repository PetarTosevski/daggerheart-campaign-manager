# TASK I5: Combat Map small items - GM "Forget explored", players read PC tokens in one query

Plan `.omc/plans/followups-8.yaml`, tracer I5 (wave 1, no dependencies). Beads `dcm-bxp.52`, `dcm-bxp.53`. Status:
Review.

## What changed

| File | What |
|------|------|
| `convex/combatVision.ts` | New `forgetExplored` (gmMutation, args `mapId`, optional `characterId`; returns `{ deleted, more }`): deletes the map's `combatExplored` rows, every character's or one character's, through `by_map_character` with `.take(FORGET_EXPLORED_BATCH)` (100). `more` is true on a full batch; the caller calls again. Unknown map answers `COMBAT_MAP_NOT_FOUND`, a character outside the campaign `NOT_FOUND`. (dcm-bxp.52) |
| `src/components/combat-map/vision/use-vision.ts` | `useVisionActions().forgetExplored(mapId)` loops the mutation until `more` is false; its optimistic update empties the cached `combatVision.explored` rows of that map at once. |
| `src/components/combat-map/vision/panels.tsx` | GM Vision & fog card: "Forget explored" button with a two-click confirm ("Click again to forget", reset on blur), next to "Clear marks"; help line names it. |
| `src/components/combat-map/tokens/use-tokens.ts` | `useTokens` for a player reads `combatVision.playerView.pcs` (the same subscription the vision layer holds) and subscribes to `combatTokens.party` only while that view has no PC tokens for this map (`noCharacter`, other map). `patchTokens` (exported) also rewrites `pcs` in cached `playerView` / `previewAs` results, so optimistic token writes show in the player's one source. `combatTokens.party` stays (fallback). (dcm-bxp.53) |

No new index, validator change, error code or migration. `convex/_generated` untouched (no new module).

## Tests

- `tests/convex/combat-vision.test.ts`: `forgetExplored` joins the GM-only access sweep (outsider, player denied);
  new "lets the GM forget a map's explored areas..." covers one character, all characters, another map's row kept,
  re-exploring afterwards, batching (`more` on a full batch), and not-found map / character / foreign character.
- `tests/convex/authz/combat.entries.ts`: matrix entry `{ fn: api.combatVision.forgetExplored, access: "gm" }`.
- `tests/unit/combat-vision-tokens.test.ts` (new, 4): player gets `playerView.pcs` with one subscription; loading
  and the `party` fallback; GM reads only `combatTokens.list`; `patchTokens` rewrites the lists and `playerView.pcs`.
- `tests/e2e/combat-vision.spec.ts`: Ash turns west then east, the GM clicks "Forget explored" twice, and the stored
  explored samples drop below the both-sides count but stay above zero (the client stores what Ash sees now).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 287 files, 7724 passed, 1 expected fail.
- `pnpm tracer:guard .omc/plans/followups-8.yaml I5`: OK.
- `tests/e2e/combat-vision.spec.ts`: 1 passed (3.8 min).
