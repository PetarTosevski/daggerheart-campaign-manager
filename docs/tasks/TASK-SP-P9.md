# TASK-SP-P9: Hand editing in the Sprites style (C5 extension)

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P9 (wave 4; depends on P6, P8). Bead: `dcm-bxp.56`.
Branched from `rebuild` 887a54c (N4, includes P6 501e9d1). The orchestrator added
`src/components/combat-map/map-view/map-canvas.tsx` to P9's owns (rebuild 78b8819) for the partial texture repaint.

## Decisions this tracer implements
- **P3** (user): "each map is drawn in "Classic" ... or "Sprites", chosen per map by the GM ... Classic stays fully
  working." The Classic editor (D9 pickers, tools, arguments) is unchanged.
- **D1**: "Every map object keeps a Classic `kind` (one of the 22) and MAY carry a `sprite` ref; every area keeps a
  Classic `terrain` ... and MAY carry a `texture` ref." Placing a sprite stores its Classic kind and variant from the
  catalog or the uploaded row; painting a texture paints its terrain class too.
- **D2**: the Classic fallback lights like the sprite; the light switch uses the sprite's traits (ORCHESTRATOR NOTE:
  `givesLight({kind, lit, traits})` in `edit-model.ts` `isSwitchableLight` and the panel's reach via `mapLightReach`).
- **D3**: "Sight for a sprite object = the GM's per-object override ?? the sprite's manifest default ?? the Classic
  kind's R7 default." The panel's "Default" is the manifest sight.
- **D4**: "default r = max(w, h) / 2; `rot` rotates it." Smaller / Bigger / rotate are C5's.
- **D9**: a deleted uploaded sprite cannot be placed (SPRITE_NOT_FOUND); objects already placed keep their ref.
- **Q1 = (b)**: faint glow is switchable like the other map lights.

## Public functions (`convex/combatMapEdit.ts`, all `gmMutation`, unchanged otherwise)
| Function | Change |
|---|---|
| `addObject` | `kind` now optional, new optional `sprite: spriteRef`. One of the two is required (INVALID). A built-in key must be an object in the catalog (SPRITE_UNKNOWN; a texture key too); an uploaded sprite must be this campaign's (SPRITE_NOT_FOUND) and an object (INVALID). Kind + variant from the catalog / row, r = max(w, h) / 2. C5's calls are unchanged (E4). |
| `paintCells` | `paint` also accepts `{layer: "texture", texture: spriteRef}`: a catalog texture (SPRITE_UNKNOWN) or this campaign's uploaded texture (SPRITE_NOT_FOUND / INVALID); it takes its slot in `texturePalette` (added when absent; a slot no square uses any more is reused; SPRITE_PALETTE_FULL when all 16 are in use), then the stroke writes the texture layer and the texture's terrain class on the terrain layer in the same mutation. Painting a terrain or "eraseTerrain" also clears the texture under the brush ("erase clears both"). |
| `clearPaint` | "Undo all painting" (terrain) also deletes the texture tiles and unsets `texturePalette`. |
| `updateObject` | `lit` allowed when `givesLight({kind, traits})` (traits from `loadObjectTraits`, P5): a faint-glow candelabra on `crystal` can be switched; a sprite with light "none" cannot, whatever its kind. |
| `setObjectSight`, `moveObject`, `removeObject` | Unchanged (the "default" now means D3's manifest sight for sprites; the vision engine already resolves it). |

## Client (`src/components/combat-map/editor/`)
- `edit-model.ts` (shared with the server): `strokeLayers` also clears the texture layer for terrain paint / erase;
  `isSwitchableLight(kind, traits?)`; new `sameRef`, `spriteRadius`, `builtinPlacement`, `uploadedPlacement`,
  `builtinTextureTerrain`, `usedTextureCodes`, `paletteSlot`, `textureCode`, `paintLayoutTextures`.
- `sprite-palette.ts` (pure): `spritePalette(folder, uploaded)` lists the setting's object sprites, then common's,
  then the uploaded ones (same for textures), built straight from `CATALOG` (`folderEntries`: props, large, terrain,
  extra sheets included), so new catalog items (and M0's `move` trait later) appear with no editor change;
  `searchPalette`, `spriteName`, thumbnails from the manifest (`builtinSpriteUrl`) or the upload URL.
- `use-sprite-editing.ts`: reads `combatMapStyle.spriteSources` when the map is Sprites or holds uploaded refs, and
  `combatMapStyle.settings` only for a pack setting (to add the built-in setting it extends); gives the palette,
  `traitsOf` and `nameOf`.
- `editor-state.tsx`: `sprite` (to place; null = first in the picker) and `texture` (null = plain terrain).
- `edit-tools-panel.tsx`: in Sprites style the Objects tool shows the sprite picker (search box "Search sprites",
  groups "This setting" / "Common" / "Your sprites", thumbnails, `aria-pressed`) and the Terrain tool shows the
  textures (same groups) plus "Without a texture" (the 14 plain terrains, for walls, water, void...). The selected
  object's panel shows the sprite's name, its manifest sight as the default, and the light switch with the trait's
  reach. In Classic style everything is the D9 card.
- `editor-layer.tsx`: places the picked sprite, paints the picked texture (one intent per stroke), draws sight
  outlines from the traits.
- `use-edit-mutations.ts`: optimistic updates for sprite placing (placement from the catalog or the cached
  `spriteSources` row), texture strokes (palette slot, texture tiles and terrain tiles, the server's own helpers),
  terrain paint / erase clearing textures, Undo all painting clearing textures and palette.
- `editor.css`: `cm-ed-sprite*`, `cm-ed-thumb` (checkerboard). 390 px: the page's 44 px buttons; no horizontal scroll.
- `map-view/map-canvas.tsx`: texture cells are no longer part of the Sprites `structure` key; `refDiff` adds the
  squares whose texture changed to the terrain dirty rectangle, so a texture stroke repaints only around itself.

## Acceptance evidence
- `tests/convex/combat-map-edit-sprites.test.ts` (11 tests, passed): access for addObject with a sprite, a texture
  stroke, a sprite's light switch and sight (anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok,
  asserted on `ConvexError.data.code`); built-in placement (oak: tree / green / r 1; bush r 0.5; `kind` ignored with a
  sprite); SPRITE_UNKNOWN for unknown and texture keys, INVALID without kind or sprite; uploaded placement (pillar,
  r 1), an uploaded texture as object INVALID, another campaign's and a deleted sprite SPRITE_NOT_FOUND, the placed
  object keeps its ref; light by traits (candelabra on crystal switchable, bush not, bush ref on a campfire kind not);
  sight override and default; texture strokes (palette, texture tiles, grass / path terrain class, same slot reused);
  the client's optimistic helpers produce exactly the server's tiles and palette; erase / terrain paint / Undo all
  painting; SPRITE_PALETTE_FULL at 17 and reuse of a freed slot; texture ref checks; the pickers' order, catalog
  coverage and search.
- `tests/convex/combat-map-edit.test.ts` passes with one change, approved by the orchestrator (rebuild df9785d added
  the file to P9's owns): the placeable kinds count goes 18 → 19 for M2's Door. C5's arguments are unchanged (E4).
- `tests/e2e/sprite-edit.spec.ts` (2 tests, passed): on a Sprites forest map the GM picks Moss in the Terrain tool
  and paints a stroke (every putImageData after the stroke narrower than the map: a partial repaint; the server has
  palette `[forest/moss]` and the texture cells), searches "oak" and places an Oak tree (panel "Selected object: Oak
  tree", Blocks sight by default), places the uploaded "Standing stone" from "Your sprites", places a Bush (default
  cover only) and sets it to Blocks sight; `expect.poll` on `combatMaps.get` until the server has all three objects;
  after a reload the bush still blocks sight and the stone is there; a joined player north of the oak facing south
  sees the Bandit beside it but not the Wolf behind it, and sees the Wolf once the GM moves the oak aside. At 390 px:
  search, 44 px sprite and texture buttons, keyboard pick (Enter), place by tap (server polled), no horizontal
  scroll. With `map-canvas.tsx` reverted, the same spec fails on the partial-repaint check (a 1440 px wide write,
  the whole map), so the check proves the patch.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (see the final report for counts).

## Visual (SP-P9, `E2E_VISUAL=1`): `tests/e2e/visual/SP-P9.spec.ts`
Shots in `test-results/visual/SP-P9/` at 1440, 1024 and 390: `sprite-picker`, `sprite-search` ("tree"),
`sprite-panel` (a selected oak), `texture-picker`, `map-sprites` (an edited forest clearing: moss, a muddy path, oaks,
pines, bush, stump, log, campfire) and `map-classic` (the same map in Classic, the counterpart).

| Region | Verdict |
|---|---|
| Sprite picker / search | Matches the Combat Map's look (`cm-card`, `cm-btn`, `cm-in`); two columns of thumbnails with names, long names ellipsized (full name in the tooltip); the list scrolls inside the card. |
| Texture picker | Texture thumbnails above the plain terrain swatches; same grid as the D9 terrain palette. |
| Selected sprite panel | The D9 panel with the sprite's name and its manifest sight as the default. |
| Map sprites vs classic | Same layout; painted moss is grass in Classic, the muddy path is path; sprite objects draw as their Classic kinds in Classic. |

Deliberate deviations: a hand-painted texture's edge against the same terrain class with another texture is crisp
(P6's painter feathers only between terrain classes, D6), so a painted moss patch on grass shows a straight edge; the
Terrain tool keeps the 14 plain terrains under the textures, so walls, water and void can still be painted on a
Sprites map.

## Movement and doors (M0, M2, merged into this branch before the commit)
- The sprite picker reads the catalog, so M0's `move` trait and M2's six door sprites show up with no editor change.
- `PLACEABLE_OBJECTS` gains the Classic "Door" (r 0.5). A placed door, Classic or sprite, has kind `door` and no
  `open` field, so it starts closed (convex test). The overlay and panel pass `open` to `sightOf`, so an open door
  shows no sight outline. The door switch itself is M2's (vision panels). Drawing doors in the Classic painter
  (closed and swung open) is M1's job; until then a Classic door on a Classic map may draw nothing.

## QUESTIONS
1. Q1's answer says "the GM can set any sprite to none / faint glow / torch / campfire in P8's labelling screen and
   P9's editor". `combatMapObjects` has no per-object light field (P0's schema), and a built-in sprite's catalog
   trait always wins over its Classic kind, so P9 cannot override light per object. Uploaded sprites get it per
   sprite in P8's screen. Add an optional per-object `light` override (a P0-style schema widening + vision read)?
2. Painting a texture on a Classic-style map is allowed (it also paints the terrain class, so Classic stays right);
   the UI only offers it in Sprites style. Refuse it on Classic maps instead?
3. Should hand-painted texture patches feather into neighbouring textures of the same terrain class (a P6 painter
   change), instead of the crisp edge they have now?
4. `addObject` with a sprite ignores `kind` when both are sent. Refuse the pair as INVALID instead?
