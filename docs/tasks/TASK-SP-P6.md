# TASK-SP-P6: Sprite painter and the per-map Classic / Sprites switch

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P6 (wave 3; depends on P4, P5). Bead: `dcm-bxp.56`.
Branched from `rebuild` 0b062ee (P4).

## Decisions this tracer implements
- **P3** (user): "each map is drawn in "Classic" (today's procedural painter) or "Sprites", chosen per map by the GM.
  The user decides later which one they prefer, so switching is one click and Classic stays fully working."
- **D1**: "Classic draws kind / terrain and ignores the refs; Sprites draws the refs and, where an object or area has
  none, maps the Classic kind / terrain to the map's setting through the catalog's mapping tables (deterministic per
  object id and seed), else to `common`, else draws that one object or terrain the Classic way."
- **D4**: "An object's `r` scales its sprite (default r = max(w, h) / 2); `rot` rotates it."
- **D5**: "Shadows: drawn by the app from each sprite's alpha, one light direction from the top-left ..., so shadows
  fall to the bottom-right; blur and offset by the manifest's `height` (flat = no shadow, low, tall). Constants in one
  module (SHADOW_DIR, SHADOW_ALPHA, SHADOW_BLUR, offsets per height) so the user can tune them."
- **D6**: "textures are tiled in world space; a terrain class with several textures (the setting's + common's) is
  mixed by a seeded low-frequency noise mask; rotatable textures ... get a seeded rotation / flip per tile; boundaries
  between terrains are feathered with a noisy alpha mask (about 0.35 square); terrains with no texture in the setting
  (wall, void, deep, lava when absent) are painted the Classic way and feathered the same way."
- **D9**: deleted / fileless uploaded sprites resolve like no ref. **D10**: players get only the sprite URLs the live
  map needs. **Q4 = (a)**: new maps stay Classic. **E2**: `src/lib/combat-map/painter.ts`, `raster.ts` and
  `fallback-layout.ts` are unchanged.

## What was built

| File | Does |
|---|---|
| `src/lib/combat-map/sprites/painter.ts` | The Classic painter's interface: `prepareMap(spec, paint)`, `paintMapRect(ctx, map, rect, opts)`, `withObjects(map, objects)`, `paintMap(ctx, spec, opts)`, plus `objectBounds(object, spec, cell)` and `mapUrls(map, cell)` (which images a map draws, for repaints). Order per rectangle: Classic terrain where needed, textures, Classic hulls, flat sprites, shadows, light glows, sprites and Classic objects in layout order, grid, vignette. |
| `sprites/resolve.ts` | D1: an object's art = its ref (built-in key via `BUILTIN_LOOKUP`, a cut variant picked per object id; uploaded row with a URL), else `pickSprite` (setting, then common), else null = Classic. A terrain's textures = the setting's + common's (`textureCandidates`), explicit area / cell refs win. |
| `sprites/terrain.ts` | D6: `planTextures` (per fine cell: texture cell > winning area's texture > the terrain class's textures > Classic) and `compositeTextures` (world-space tiling at TEXTURE_SQUARES = 4 squares per swatch; variant mix by low-frequency noise with soft transitions; per-tile seeded rotation / flip for rotatable textures, cross-faded with the neighbours' orientation near tile edges so rotated seams do not show; a +-9 % low-frequency brightness variation against repetition; the Classic painter's noisy edge displacement plus a nine-tap jittered feather, 0.35 square; untextured terrains keep the Classic pixels and are feathered the same way; the Classic dark rim along walls). `classicSquares` tells the painter which squares need the Classic terrain underneath (untextured, edges, textures still loading), so fully textured squares skip the Classic pass. |
| `sprites/objects.ts` | Sizes (D4: refs fit w x h squares scaled by r / (max(w, h) / 2); stand-ins take the Classic kind's drawn size at its r, clamped 0.6..3), bounds (sprite + shadow + glow, united with the Classic bounds so the Classic -> sprite repaint fits), glows (`GLOW`: campfire / torch / faint glow, Classic gradients, none when switched off), and the Classic drawing of objects without a loaded sprite: Classic `paintMapRect` on a one-pixel rectangle through a context view that ignores its clip and image-data writes, so the object is drawn by painter.ts itself, pixel for pixel. |
| `sprites/shadows.ts` | D5 constants (`SHADOW_DIR` bottom-right, `SHADOW_ALPHA` 0.42, `SHADOW_BLUR` low 0.05 / tall 0.09 sq, `SHADOW_OFFSET` low 0.1 / tall 0.26 per square of radius, `SHADOW_MIN_OFFSET_PX` 2), `shadowSpec`, `renderShadow` (silhouette from the sprite's alpha via an off-canvas draw with `shadowOffset`, works in every browser). |
| `sprites/loader.ts` | `SpriteImages`: lazy load + decode once per URL (built-in `/sprite-packs/...` and uploaded URLs), listeners on arrival, caches per drawn size: scaled sprite bitmaps, shadow bitmaps (per size and rotation), texture pixels per tile size (LRU caps 1500 / 160). A failed image stays missing (Classic). `spriteImages()` = one cache per page. |
| `src/components/combat-map/map-view/map-canvas.tsx` | Picks the painter from `layout.style` (Classic path unchanged). Sprites: same partial repaints (objects by id with sprite refs; terrain inputs = setting, areas, textures, uploaded URLs); arriving images repaint the objects drawn with them, or the whole map for a texture (batched per frame). Queries `spriteSources` only when the layout references an uploaded sprite, inside its own boundary (a map that just stopped being live falls back to drawing without uploads). A 220 ms fade-in when the style changes, skipped with `prefers-reduced-motion`. `data-style` on the canvas. |
| `map-view/paint-spec.ts` | `toSpritePaintSpec`, `paintSetting` (stored built-in setting; a GM pack -> common only; none -> `pickSetting(prompt, name)` as `setStyle` stores it), `hasUploadedRefs`, `decodeTextureCells` (TEXTURE_CODES[i] = texturePalette[i]). |
| `maps/thumbnail.tsx` | Draws the map's style: Sprites thumbnails show the textures (4 px per square), repainted as they load. |
| `style/index.tsx` + `style-switch.css` | `StyleSwitch`: "Map style" `cm-seg` group, Classic / Sprites, `aria-pressed`, one `setStyle` intent per click with an optimistic update on `combatMaps.get` (style, and the keyword setting on a first switch), `combatMaps.list` and `spriteSources`; errors in a `role="alert"`. Hidden for uploaded image maps; players never get it (the page mounts it for the GM only). 44 px targets at 390 px (combat-map.css), full width on phones. |

## Acceptance evidence
- `tests/unit/sprite-painter.test.ts` (14 tests; recording mock context with a real RGBA buffer, fake art, the committed
  manifest plus two uploaded fixture sprites): resolution (ref, stand-in, deleted / fileless / unknown ref -> stand-in,
  hull -> Classic), texture lists (setting + common, none for wall / void, rotatable flags); determinism (same calls
  and pixels for a seed, different for another seed); dirty rect touches only its rectangle (every image-data read /
  write and clip inside it) and equals the full paint there, repainting a painted map changes nothing; a moved object
  repainted in its old + new bounds equals a fresh paint; sprites by ref and stand-in, Classic hull first, a shadow per
  non-flat sprite; shadow direction and length per height; a missing sprite draws the Classic crate, loaded it is a
  sprite; lit campfire glows, switched off does not; textures replace Classic terrain, wall keeps Classic pixels,
  nothing loaded = exactly the Classic terrain; variant mixing across a 24 x 24 map and texture cells; `mapUrls`;
  loader: one load per URL, listeners, cached sprite / shadow / texture bitmaps (no re-decoding), failures stay null.
- `tests/e2e/sprite-style.spec.ts` (2 tests, passed): the GM switches a generated forest map to Sprites (canvas changes
  at once; `expect.poll` on `combatMaps.get` through a convexAs client until the server has `style: "sprites"` and the
  keyword setting `{builtin: "forest"}`), the thumbnail follows, a joined player has no switch and sees the live map
  change to Sprites and back live; Classic -> Sprites -> Classic gives the identical Classic canvas (`toDataURL`).
  At 390 px: 44 px targets, keyboard (Enter), server polled, no horizontal scroll.
- Performance: a 44 x 32 keyword forest map (48 objects) at 48 px per square, Node, mock context, machine under load:
  Classic paint about 850 ms, Sprites about 1100 ms (textured squares skip the Classic terrain pass). Images are
  decoded once and every drawn size is a cached bitmap, so repaints never decode or rescale; partial repaints stay
  partial (objects, cells, arriving images).
- `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test`: 169 files, 2227 passed, 1 failed:
  `tests/unit/wizard-steps.test.tsx` (step 1) timed out at its 15 s limit under load average 30; rerun alone it
  passes (6/6), and it does not touch any file of this tracer.
- Regression e2e in this worktree: combat-maps, combat-map-edit, combat-vision, combat-map-flow, sprite-style and
  sprite-packs-shell: 13 passed.

## Visual (SP-P6, `E2E_VISUAL=1`): `tests/e2e/visual/SP-P6.spec.ts`
Shots in `test-results/visual/SP-P6/` (per map: `<map>-<style>-{1440,1024,390}.png` = the Combat Map page,
`<map>-<style>-canvas-1x.png` = the whole canvas, `-canvas-2x.png` = a 2x crop of its middle). Counterparts: the same
map in Classic, and P4's contact sheets.

| Region | Verdict |
|---|---|
| forest sprites vs classic | Same layout; trees, bushes, dead trees, tents, logs, campfire are pack sprites; grass mixes forest floor, moss, tall grass and common grass with no tile seams or 4-square grid at 1x or 2x; grass / dirt edges feathered; water (no water texture in forest or common) stays Classic with its foam edge; shadows all fall to the bottom-right. |
| tavern sprites vs classic | Stone floor textures (kitchen tiles, stone hearth floor, common flagstones) mixed per room; walls Classic with the Classic bevel and a dark rim. The kitchen tiles read as tiles (a grid by nature; the user accepted its 0.36 tileability in P4). |
| dungeon sprites vs classic | Flagstones / mossy / cracked stone and dirt-and-straw mixed; straight wall edges as in Classic (stone next to wall is crisp in Classic too). |
| Header switch 1440 / 1024 / 390 | The Classic / Sprites group sits in the header next to GM Fear; full width on phones, 44 px targets; no horizontal scroll. |

Deliberate deviations: pillars, wall torches and statues without a stand-in (P1's mapping rule: same R7 sight and
light) stay Classic on Sprites maps, as D1 says; stand-in sprites are sized like the Classic drawing of their kind
(not by D4's default r), so Classic layouts keep their spacing; a map whose setting is a GM pack maps unreferenced
Classic kinds to `common` only (the client does not know the pack's `extends` for players).

## Outside this tracer (exact diff, owner per the plan's ORCHESTRATOR NOTE: P6, but the file is not in P6's owns)
`src/components/combat-map/vision/vision-layer.tsx` still offers light switches by Classic kind only, so a built-in
faint-glow sprite on a non-light kind (a candle on `crystal`) gets no switch, and a sprite with light "none" on a
Classic light kind gets one the server refuses:

```diff
@@
-import { RANGE_BANDS } from "@/lib/domain/combat-map/ranges";
+import { givesLight } from "@/lib/domain/combat-map/light";
+import { RANGE_BANDS } from "@/lib/domain/combat-map/ranges";
+import { spriteTraits } from "@/lib/sprite-packs/traits";
@@
-import { brushSquares, isSwitchableLight, objectLabel } from "../editor/edit-model";
+import { brushSquares, objectLabel } from "../editor/edit-model";
@@
-        if (!isSwitchableLight(o.kind)) return false;
+        if (!givesLight({ kind: o.kind, traits: o.sprite ? spriteTraits(o.sprite) : null })) return false;
```
(Uploaded sprites need their rows for traits; without them `spriteTraits` returns null and the Classic kind decides,
which matches the server for uploads labelled like their Classic kind.)

## QUESTIONS
1. Stand-in sprites are sized like the Classic drawing (a crate at r 0.8 is about 0.64 squares, never under 0.6 of
   the sprite's own size). Prefer D4's literal r-scaling for them too (a crate at r 0.8 would be 1.6 squares)?
2. A map whose setting is a GM pack maps objects without refs to `common` only. Use the pack's `extends` setting
   instead (needs `extends` in `spriteSources`, P5's file)?
3. The style change fades the canvas in over 220 ms (none with reduced motion). Keep, or switch instantly?
