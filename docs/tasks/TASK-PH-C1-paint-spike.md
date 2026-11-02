# TASK-PH-C1: paint one sprite map frame

Tracer C1-paint. Branch `phone/C1-paint` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c1-paint`,
branched from `phone/A1-on-master` at `9b522dc`. Not committed.

## What changed

The phone app can paint one Sprites-style combat frame through Skia. The
website painters in `src/lib/combat-map` are unchanged. They draw into a
canvas 2D adapter (`SkiaCanvasContext`) that records onto a Skia surface.

On device, `loadSkia` uses `globalThis.SkiaApi` when
`@shopify/react-native-skia` has installed it. Node tests load the same
factory from that package's CanvasKit build: `canvaskit-wasm/bin/full/canvaskit`
resolved from the Skia `package.json`, then
`lib/commonjs/skia/web/JsiSkia.js`. `canvaskit-wasm` stays a transitive
dependency. No package or lockfile change.

The adapter covers the canvas methods and fields those painters call,
including paths, arcs, ellipses, round rects, dashes, radial gradients,
clips, transforms, `getImageData` / `putImageData`, and `drawImage`.
`putImageData` draws in device pixels with `BlendMode.Src` and nearest
filtering, and the current clip still applies. Canvas shadows are device
space: the draw is recorded with the current transform baked in, blurred
with `ImageFilter.MakeDropShadowOnly`, then the shape is drawn. `drawImage`
throws when its source is not a `SkiaMapCanvas`, so a sprite is not
silently skipped.

`paintFixtureFrame` paints one 4×4 forest map (seed 7, grass base, 16 px
cells) through `paintMap`. Terrain is the classic underlay plus a solid
green texture tile (`rgb(30, 140, 50)`). One crate stands at `(2, 2)` with
rotation `1.5`. Its image and shadow source are an opaque magenta surface
(`rgb(255, 0, 255)`), and the shadow goes through the website
`renderShadow`. The function throws if the painter never asks for that
sprite.

The combat screen is still `NotBuiltYet`. Nothing under `apps/mobile/app`
imports the canvas module, so the export bundle does not include it.

## Tests

`apps/mobile/test/features/combat-spike/adapter-coverage.test.ts` reads
every `src/lib/combat-map/**/*.ts` file and collects `ctx.` / `classicCtx.`
calls and assignments, plus any `.getContext(` and `.addColorStop(`. It
fails unless each call is a method on `SkiaCanvasContext`, `SkiaMapCanvas`,
or `SkiaGradient`, and each assignment is a field declared on
`SkiaCanvasContext`. It also fails when it finds 10 or fewer calls, so an
empty scan cannot pass.

`apps/mobile/test/features/combat-spike/paint-frame.test.ts` calls
`paintFixtureFrame` and requires a non-empty pixel buffer, at least one
opaque non-magenta terrain pixel, at least one opaque magenta sprite pixel,
and `spriteRequests > 0`.

## Commands

Node v24.22.1, from the worktree root.
`EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud` was set for both
phone commands.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | First run: ESLint and `tsc --noEmit` passed, then Jest failed. `test/ui/sheet.test.tsx` ("the sheet closes from the backdrop, the close control, and Android back") exceeded 5000 ms. That file is outside this tracer. Immediate rerun: ESLint, `tsc --noEmit`, and Jest passed. 30 suites, 80 tests. Exit 0. |
| `pnpm --filter @dualityheart/mobile run export:check` | Android bundle 1738 modules, iOS bundle 1736 modules. `check-bundle`: 2 source maps, 3364 sources, at most one `convex` and one `react`, no `src/lib/srd/index`. Exit 0. |

## Not done

No combat screen. No commit, no push, no merge into `master`. The branch
is left uncommitted.
