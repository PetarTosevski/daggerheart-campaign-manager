# TASK-F9-J2: Paint mode keeps the map view; Terrain view tints Water (dcm-bxp.139)

Root cause 1: `usePanZoom` called `fit()` on every `ResizeObserver` callback. Entering or
leaving paint mode mounts or unmounts the brush toolbar above the map; that changes the page
height (a scrollbar appears or goes, narrowing the viewport by about 15 px, and in full screen
the flex height changes), so the observer fired and `fit()` reset zoom and pan. Fix: a height
change is ignored, a width change up to `SCROLLBAR_SLACK` (24 px) rescales the view
(`rescaleView`: same zoom, same map point), and only a larger change (window resize, full
screen) refits. Playwright's headless Chromium uses overlay scrollbars, so the e2e cannot
reproduce the scrollbar case; `rescaleView` is unit tested.

Root cause 2: the overlay filled Water (`x`) with `transparent` unless painting. The fills now
live in `src/lib/world/terrain-overlay.ts` (`TERRAIN_OVERLAY_FILLS`), shared by both modes;
Water is blue (`TERRAIN_COLOURS["."]`). Impassable was already drawn in both modes.

Tests: `tests/unit/world-pan-zoom.test.ts` (fill per terrain code, `rescaleView`),
`tests/e2e/world.spec.ts` (zoom and transform identical after Paint then Done).
