# TASK-PH-C5: combat map GM tools

Tracer C5-combat-gm. Branch `phone/C5-combat-gm` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c5-combat-gm`,
branched from `phone/A1-on-master`. Not committed.

## What changed

The phone combat map GM slot replaces the stub with panels that call the same
Convex queries and mutations as the website GM column: campaign Fear, map list
and make-live, combatants (party, queue, custom, clear), hand sharing, vision
(preview-as, fog stroke, doors, reveal-to), adversary attack intents, and
out-of-range sanctions. `CombatGmSlot` returns null when `isGm` is false so
players never mount GM subscriptions.

## Queries (GM slot only)

| Area | Subscribes |
| --- | --- |
| Fear | `campaigns:fear` |
| Maps | `combatMaps:list` |
| Combatants | `combatTokens:combatants`, `combatTokens:list` |
| Hands | `combatCards:handSharing` |
| Vision | `combatTokens:list`, `combatVision:doors`, `combatVision:previewAs` (when previewing) |
| Adversary | `combatTokens:list`, `encounters:list` |
| Sanctions | `combatRequests:mine` |

The combat screen shell (C4) still loads `combatMaps:live` and
`combatVision:playerView` for both roles. Players must not mount
`combat-gm-slot` or subscribe to GM combat reads (harness + role tests).

## Validation

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` (Node v24.22.2, `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`) | ESLint and `tsc --noEmit` pass. Jest: 242 tests pass; `test/features/world/view.roles.test.tsx` fails to load (RNGH + reanimated mock — pre-existing, same as C4). `test/features/combat-gm/*` and `test/features/combat-view/view.roles.test.tsx` pass (9 tests). Full suite with `jest --runInBand` ~11s. |
| `pnpm test tests/convex/codex.test.ts` | 24 tests passed. File not edited. |

## Not done

Map edit mode (C6) and token pick on the canvas. The battle-map hint no longer says GM tools arrive later.
