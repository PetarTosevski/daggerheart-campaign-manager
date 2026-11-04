# TASK-CONFIG-AF1: Feature switches take effect

Plan `.omc/plans/config.yaml`, tracer AF1 (bead dcm-jh6d.51), Part B. AD9 built the switches (`featureOn`,
`requireFeature`, `features.mine`); AU4 the admin tab. This tracer makes a switch that is off for a user off for them:
on the server where there is server code, and in the client everywhere.

## Client: `useFeature(key)` (`src/lib/use-feature.ts`)

Reads `features.mine` (Convex shares the one subscription between callers). Loading, or anything that is not a flags
object, counts as **on**: a missing switch means Everyone, so nothing flickers off for everyone while it loads.

| Feature | Where | Off for the user |
|---|---|---|
| `dice3d` | `src/components/party/dice/settings.ts` (`useDiceSettings`, `useDice3dAvailable`) | `threeD` is false whatever Preferences say (the saved preference is kept); the dice boxes' 3D toggles are hidden (`parts.tsx`) |
| `phoneLayout` | `src/components/combat-map/hud/phone/media.ts` (`usePhoneHud`) | false at every width: the HUD keeps its tablet layout (player regions, the GM's inline queue) |
| `lorekeeperWeb` | `src/components/lorekeeper/composer/composer.tsx` | the 'If the books don't say' toggle is hidden, as when the campaign keeps the internet off |
| `spriteTokens` | none | tokens draw portraits today (`src/components/combat-map/tokens/tokens-layer.tsx`); animated character sprites on tokens are not built, so there is nothing to switch yet. When they are built, their renderer reads `useFeature("spriteTokens")` |
| `journal`, `shareLinks` | none | inert (N2 a): always on, switching them changes nothing (tested) |

## Server

- `convex/lorekeeperRun.ts` `prepare`: `webSearch` also needs `featureOn(ctx, asker, "lorekeeperWeb")`, so the answer
  run skips the web pass for a user the switch is off for (read at run time, like the campaign's own switch).
- `convex/lorekeeper.ts` `setWebSearch` (edit outside `owns`, one line): the toggle is stored off while the switch is
  off for the caller.
- 3D dice and the phone layout have no server code. The Sprites map style and sprite packs are a different feature
  (the map's drawing style, sprite packs P1-P7) and are not gated by Sprite tokens.

## Tests

- `tests/convex/feature-gating.test.ts`: web pass with no switch, Off (owner included), Only me, Testers;
  `setWebSearch` refused-to-on while off; other switches don't touch it; Journal / Share links off change nothing.
- `tests/unit/use-feature.test.tsx`: loading = on; flags followed; fallback; 3D forced off (loaded and loading),
  toggles hidden; phone vs tablet at phone width; composer toggle hidden; inert keys gate nothing.

## Edits outside `owns`

- `convex/lorekeeper.ts`: `setWebSearch` checks `featureOn` (the orchestrator's brief names it).
- `src/components/party/dice/parts.tsx`: the two 3D toggles render only while `useDice3dAvailable()`; otherwise they
  would be dead checkboxes.
