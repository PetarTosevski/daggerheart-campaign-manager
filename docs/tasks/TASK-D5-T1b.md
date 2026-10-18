# TASK-D5-T1b: Lazy 3D dice

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T1b (polish, after T1).

With the per-device 3D toggle on and no reduced-motion request, a roll from the dice box is animated as 3D dice that land on the values the server returned. three and cannon-es are downloaded only when the first 3D roll is made.

## What landed

| Piece | Where |
|---|---|
| `play3d(container, { dice, sound }) → Promise<boolean>` (T1's seam, signature unchanged): checks reduced motion again, probes for WebGL (and releases the probe context), then `import("./scene")`. Any failure resolves `false`, so the caller shows 2D; it never throws. | `src/components/party/dice/dice3d/index.ts` |
| The scene: d4, d6, d8, d10 (pentagonal trapezohedron with planar kites), d12 and d20 meshes and cannon-es convex hulls, a walled tray, playback, disposal | `src/components/party/dice/dice3d/scene.ts` |
| e2e: reduced motion, 3D on, WebGL missing | `tests/e2e/dice-3d.spec.ts` |

### How the dice land on the server's values

The animation never decides anything: it starts only after the server has answered. cannon-es throws the dice once, synchronously and off screen (at most 150 steps of 1/60 s, so no more than 2.5 s of animation), and records every step. The face that ends up on top in the last recorded step is then labelled with the server's value (for a d4, which rests on a face, the three faces that point up carry it). The other faces get the other numbers. The recorded throw is played back with `requestAnimationFrame`, timed by the clock, and the top number is turned to read upright on screen. A timer finishes the playback if animation frames stop (background tab), so the result always shows. Dropped dice (advantage or disadvantage dice that don't count) are drawn translucent. Die colours follow the 2D faces (Hope gold, Fear violet, advantage and help green, disadvantage red, damage ivory).

The canvas stays on the sheet showing the settled dice until the next roll; it has `role="img"` and an `aria-label` listing every die and value, and `data-values` with the values in server order (the e2e test compares them with the 2D result and the feed). A new roll disposes the previous renderer, geometries and materials and forces the WebGL context loss, so at most one context is held.

### Settings (decision 3, CL14)

- Reduced motion: `settings.ts` already defaults the toggle to off and `canAnimate3d` skips `play3d`; `play3d` checks `prefers-reduced-motion` again, so no caller can animate against it.
- Sound: `playRollSound()` plays at the throw only when the per-device sound setting is on. When 3D is not shown, the caller plays the 2D sound (T1).
- WebGL missing or failing (probe, renderer creation, a render error mid-playback, a chunk load failure): `play3d` resolves `false`, any half-built canvas is removed, and the 2D result shows with no error.

## Bundle check (CL8)

`next analyze -o` (Next 16.4.1 Turbopack; `next experimental-analyze` is the same command), snapshots `before` (T1 tip, `6fc2c68`) and `after` (this branch), read with `next analyze export`. "Initial" counts the route's bootstrap and render-dependent client chunks; async groups are excluded.

| Route | Initial client JS before | after | three / cannon-es bytes in initial chunks |
|---|---|---|---|
| `/campaigns/[campaignId]` (dashboard) | 19 chunks, 1322.4 KiB raw, 451.1 KiB compressed | 19 chunks, 1322.9 KiB, 451.5 KiB | 0 |
| `/campaigns/[campaignId]/party/[characterId]` (sheet) | 19 chunks, 1295.8 KiB, 439.7 KiB | 19 chunks, 1296.3 KiB, 440.1 KiB | 0 |

The only initial-chunk growth is `dice3d/index.ts` (430 bytes raw). three (470.7 KB), cannon-es (81.2 KB) and `scene.ts` (6.4 KB) sit in one async chunk, triggered by `dice3d/scene.ts`: 545.2 KiB raw, 138.5 KiB compressed, fetched on the first 3D roll only.

## Tests

- `tests/e2e/dice-3d.spec.ts` (3):
  1. With `reducedMotion: "reduce"` emulated, the 3D toggle is off by default; even when switched on, a roll shows the 2D result and no canvas.
  2. Without reduced motion, the toggle is on by default; a roll with one advantage die shows the canvas, its `data-values` equal the 2D result's dice, and the dashboard feed row shows the same values.
  3. With WebGL removed (`getContext("webgl*")` returns `null`), the roll shows 2D, no canvas, no page error.
  The spec launches Chromium with `--enable-unsafe-swiftshader`, because headless Chromium offers software WebGL only behind that switch.
- `tests/e2e/dice.spec.ts` (T1's, 3) still passes with 3D on by default.

## Open questions

1. The settled dice stay visible above the 2D result until the next roll. Should they fade out after a while instead? The current behaviour is easy to change in `scene.ts`.
2. The sound is T1's single 2D rattle, played when the dice are thrown. Collision-timed clicks would need a sound per contact and were left out.
