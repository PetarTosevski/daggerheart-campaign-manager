# TASK-PH-C6: combat map GM edit

Tracer C6-combat-edit. Branch `phone/C6-combat-edit` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c6-combat-edit`,
branched from `phone/A1-on-master`. Not committed.

## What changed

GM combat map editing lives in `apps/mobile/src/features/combat-map/edit/`.
The slot stays collapsed until the GM opens it, so the C4 combat view test
still subscribes only to `combatMaps:live` and `combatVision:playerView` on
the default screen.

Inside the tools panel the GM can:

- paint terrain and sight blockers (`combatMapEdit.paintCells`, `clearPaint`);
- place and edit objects (`addObject`, `moveObject`, `removeObject`,
  `setObjectSight`, `updateObject`);
- switch Classic / Sprites and pick a setting (`combatMapStyle.setStyle`,
  `setSetting`; reads `combatMapStyle.settings` and `spriteSources` when open);
- generate or regenerate layouts (`combatMapGenerate.generate`, `stop`).

Players never mount `CombatEditSlot` (`isGm` is false); edit controls are
not visible until the GM expands the editor.

## Tests

- `apps/mobile/test/features/combat-edit/roles.test.tsx` — palette hidden for
  players and for a collapsed GM slot; visible after opening editor and
  choosing Objects; style settings subscribe only when open.
- `apps/mobile/test/features/combat-edit/mutations.test.tsx` —
  `combatMapEdit:clearPaint`, `combatMapStyle:setStyle`, `setSetting`.

## Commands

Node 24, from the worktree root. Set `EXPO_PUBLIC_CONVEX_URL` for mobile checks.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` (Node v24.22.2, `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`) | ESLint (warnings only, pre-existing in `combat-view/view.roles.test.tsx`) and `tsc --noEmit` pass. Jest parallel run: 265 passed; `test/features/world/view.roles.test.tsx` fails to load (RNGH + reanimated mock — pre-existing); one dashboard timeout under load. Jest `--runInBand`: 269 passed, same world suite load failure (1 failed suite, 0 failed tests). `test/features/combat-edit/*` (9) and `test/features/combat-view/view.roles.test.tsx` (3) pass. |
| `pnpm test tests/convex/codex.test.ts` | 22 passed, 2 failed (`map pins…`, `images: players…`); file not edited. |

## Not done

Primary combat viewport gestures are unchanged. GM paint and placement use the edit map in the tools panel.
