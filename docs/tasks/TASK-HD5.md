# TASK-HD5: the Classic full repaint runs in a Web Worker

Status: Review. Plan: `.omc/plans/sharp-4k.yaml`, tracer HD5 (bead dcm-ggk3.5). User 2026-11-13: "draw in the
background". Since HD1 a Classic full repaint at render scale k = 2 blocked the page for about 1 s on a 30 x 20 map
and longer on big maps (the terrain is painted pixel by pixel in JS).

## What works

- **Worker** (`src/lib/combat-map/paint-worker.ts`): a module worker that takes a `PaintRequest` (`id`, `spec`,
  `paint`, `cell`), paints it with `painter.ts` `paintMap` into an `OffscreenCanvas` of `mapPixelSize(spec, cell)` and
  posts back the transferred `ImageBitmap` (or `{ id, error }`). The handler is exported (`handleRequest`,
  `paintBitmap`) and only registers `onmessage` inside a `WorkerGlobalScope`, so the module can be imported in tests.
- **Client** (`src/lib/combat-map/paint-worker-client.ts`): `PaintWorkerClient` starts the worker lazily with the
  Next.js pattern `new Worker(new URL("./paint-worker.ts", import.meta.url), { type: "module" })` (named
  `combat-map-paint`). The newest request wins: one request at a time in the worker, a newer one waits in a single
  slot (replacing an older waiting one, which is never sent), and a picture for any request that is no longer the
  newest is closed, never handed out. `cancel()` drops every request; `dispose()` terminates the worker. A worker that
  fails to load (`onerror`), cannot be started, or answers with an error fails the newest request back to the caller,
  and after a load failure every later request too. `canPaintOffThread()` checks Worker, OffscreenCanvas with a 2D
  context and ImageBitmap.
- **Map canvas** (`map-canvas.tsx`): a Classic full repaint (first paint, structure change, render-scale change, as in
  HD1) is sent to the worker; the canvas keeps its old backing store, CSS-stretched, until the picture arrives. Then
  the canvas takes the bitmap's size and draws it 1:1 (`drawImage(bitmap, 0, 0)` with an identity transform), closes
  it and prepares the terrain rasters on the main thread (`prepareMap`, about 20 ms for 64 x 64) for later dirty-rect
  repaints. While a picture is on its way the state is `classic-pending`; any change in that time asks for a new full
  picture (the canvas does not show the state a dirty rectangle would start from), unless the inputs are the same as
  the pending request's. Dirty-rect repaints (an object moved, squares painted) stay on the main thread. Switching to
  Sprites or an image cancels a pending picture; the style fade-in plays when the picture arrives. Without Worker /
  OffscreenCanvas, or when the worker fails, the main thread paints exactly as before.
- **Painter** (`painter.ts`): takes a `PaintContext` (`CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D`)
  instead of the page-only type; it used no DOM-only API, so nothing else changed. `raster.ts` is untouched (already
  pure).

## Measurements

`tests/e2e/combat-map-hidpi.spec.ts`, "zooming a Large Classic map ...": a Large map (40 x 27) with water, stone and
wall squares on a 2x screen, zoomed in until k steps 2 -> 2.5, then Fit (back to 2): two full repaints. Longest
main-thread task (PerformanceObserver `longtask`), on a shared, loaded host:

| | after load | while zooming |
|---|---|---|
| before (master's map-canvas) | 5 730 ms | 5 879 ms |
| after (worker) | none over 50 ms | none over 50 ms |

## Judgement calls

1. **The e2e map is Large (40 x 27), not 64 x 64.** The acceptance names a 64 x 64 map, but (a) no public function
   makes one yet (the presets go up to Large; only the generator's save allows 64 x 64, and the Huge preset is outside
   ME2's owns), and (b) the canvas caps keep a 64 x 64 map at k = 1 at every zoom on this screen (3072 px a side at
   k = 1; 4608 at 1.5 passes MAX_CANVAS_PIXELS), so zooming it never repaints. Large at k = 2.5 is 15.6 M pixels, the
   most the board paints (a 64 x 64 map at k = 1 is 9.4 M). When the Huge preset lands, the spec can switch to it.
2. **Superseding inside the worker.** A request already being painted runs to the end (a worker cannot be
   interrupted mid-task); its picture is closed. Newer requests never queue up behind it: only the newest one waits.
3. **`prepareMap` stays on the main thread** (about 3 ms at 22 x 15, 14 ms at 40 x 27, 19 ms at 64 x 64 in Node)
   rather than cloning the rasters back from the worker.

## Tests

- `tests/unit/combat-map-paint-worker.test.ts`:
  - the worker path (`handleRequest` on a structured-cloned request, a recording OffscreenCanvas) and the main-thread
    path (`paintMap`) make the same calls in the same order and put the same pixels at k = 1 and k = 2; the bitmap is
    transferred and has the map's pixel size; no 2D context answers with an error;
  - the client: starts the worker on the first request; a superseded request's bitmap is closed and never handed out,
    and a waiting request is replaced by a newer one (never sent); `cancel` and `dispose` close a late picture; an
    error answer, a worker that fails to load and one that cannot start fail to the caller.
- `tests/e2e/combat-map-hidpi.spec.ts`:
  - "zooming a Large Classic map repaints off the main thread": no main-thread task over 100 ms (table above);
  - "the worker's Classic map has the same pixels as the main thread's (k = 2)": SHA-256 of the canvas pixels with the
    worker (one `combat-map-paint` worker started) equals the digest with `OffscreenCanvas` removed (main thread, no
    worker started), in real Chromium.
- Existing specs (`combat-map-edit`, `-flow`, `-generate`, `-shell`, `combat-maps`, `combat-movement`,
  `combat-vision`, `map-zoom-scrollbars`, plus the HD1 test of `combat-map-hidpi`): 15 of 17 pass. Three failures
  remain, none in HD5's `owns`:
  - **`combat-map-edit.spec.ts:55` needs a one-line change because of HD5.** It waits for the first full paint by
    spying on the page's `putImageData` for a 1440 px wide write; that write now happens in the worker. Waiting for
    the canvas width instead (`expect.poll(() => page.getByTestId("combat-map-canvas").evaluate((el) =>
    (el as HTMLCanvasElement).width)).toBe(fullWrite)`) passes both tests of the file (tried locally, reverted:
    outside `owns`). The stroke checks after it are unchanged: dirty rectangles are still painted on the page.
  - `combat-vision.spec.ts:96` expects the token "Open Ash’s sheet" (the stale locator HD1 already reported; the
    token is "Ash (your character): actions" since 59e3ac15). Not caused by HD5.
  - `combat-map-hidpi.spec.ts` "a Sprites map loads the 1x sprite files at 100 % ..." (HD3) fails the same way with
    master's `map-canvas.tsx` (checked): the map opens at 116 %, not at most 100 %, on this viewport. Not caused by
    HD5.
