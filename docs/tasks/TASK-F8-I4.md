# TASK-F8-I4: Sprite pack fixes (followups-8, tracer I4)

Plan: `.omc/plans/followups-8.yaml`, tracer I4. Beads: dcm-bxp.84, .85, .86, .92, .93, .94, .95, .96, .97, .98
(sprite-pack gaps G2-G16 from `docs/tasks/TASK-SP-P10.md`). The user answered G10-G16 on 2026-10-23 (bead notes).

## Done

### dcm-bxp.85 (G3): soft edges between textures of the same terrain class
The Sprites painter feathered only where the Classic terrain class changes (`PreparedMap.edge`), so a painted texture
patch on its own class (moss on grass, an area texture on its class) showed a straight square edge.

- `src/lib/combat-map/sprites/terrain.ts`: `planTextures` now also returns `tedge`, which marks every fine cell
  within `EDGE_REACH` (3 sub-cells = 0.75 square, the Classic edge band) of a cell that draws another texture source
  (`sourceEdges`). `compositeTextures` sends those pixels through the edge path too: the same noisy displacement and
  the 0.35-square nine-tap feather as class edges. The wall rim still applies only on class edges, so a texture edge
  near a wall shades the same as before.
- A marked pixel in a uniform region composites exactly as an unmarked one (every tap hits the same source), so the
  band can be generous and maps with a single source per class do not change. The band (0.75 square) stays inside
  the editor's repaint pad (`terrainDirtyRect`, 2 squares).
- Tests (`tests/unit/sprite-painter.test.ts`): a two-square texture patch on grass changes pixels just outside the
  patch (soft edge) and nothing more than one square away, and the plan marks the band. This test fails without the
  fix. `sourceEdges` marks the band around a source change and nothing in a uniform region.

### dcm-bxp.94 (G12): attachSprite deletes the blob on label errors too
User answer: keep `SPRITE_LIMIT` as built (file deleted, `{ok: false, code: "SPRITE_LIMIT"}`), and delete the blob
at once on label errors instead of leaving it to the orphan sweep.

- `convex/spritePacks.ts` (`attachSprite`): the unclaimed check (`NOT_FOUND`, thrown, file kept) now runs before the
  label checks, so a label error (name, sizes, texture without terrain, D2 Classic look) deletes only an unclaimed
  file and returns `{ok: false, code: "INVALID", message}` (a throw would roll the delete back, CF16). The uploader
  already shows `result.message` for `ok: false`.
- Test (`tests/convex/sprite-packs.test.ts`): every bad label returns `ok: false, INVALID`, the file is gone, no
  `files` row or sprite is left. The SPRITE_LIMIT test is unchanged.

### dcm-bxp.96 (G14), part (a): refuse texture strokes on Classic maps
- `convex/combatMapEdit.ts`: `paintCells` with `{layer: "texture"}` on a map whose style is not `sprites` (absent =
  Classic) throws INVALID before anything is written. The editor offers textures only in Sprites style, so the UI
  is unchanged.
- Test (`tests/convex/combat-map-edit.test.ts`): a texture stroke on a Classic map is INVALID and writes no tiles
  or palette; the same stroke paints after switching to Sprites.
- Part (b) (refuse `addObject` with `kind` + `sprite`) is not done: see the table below.

### dcm-bxp.92 (G10): kept as built
User answer: keep as built; the bead is already closed. No change.

## Not done: needs files outside I4's owns

| Bead | Needs |
|---|---|
| dcm-bxp.84 (G2) per-object light override | `convex/tables/combatMaps.ts` / `convex/lib/validators/combatMaps.ts` (widen-only `light` on `combatMapObjects`), `convex/lib/combatVision.ts` (`visionObjects`, `toggleLight`), the canvas glow in `src/components/combat-map/map-view/**` and the matrix entries for any argument change |
| dcm-bxp.86 (G4) pack `extends` in `spriteSources` | `src/components/combat-map/map-view/paint-spec.ts` (`paintSetting`) and the canvas that passes `spriteSources` to it |
| dcm-bxp.93 (G11) byte (magic-number) check on every upload path (user answer 2026-10-23) | A shared internal action that reads the blob's first bytes and deletes on a mismatch with png/jpeg/webp/gif, scheduled from every upload path: `convex/lib/files.ts` (`acceptUpload` / `isAllowedImage`), `convex/combatMaps.ts`, `convex/maps.ts`, `convex/photoImport.ts`, `convex/characters.ts`, `convex/codex.ts` (and `convex/spritePacks.ts`, owned here, once the shared helper exists); CF16 in `docs/best-practices.md`; tests in `tests/convex/files*.test.ts` and each area's upload tests. Not started here so all paths share one helper. |
| dcm-bxp.98 (G16) send `portrait: null` for adversaries and custom tokens without art (user answer 2026-10-23) | `convex/lib/combatVision.ts` (`otherTokenValidator` and the rows that omit `portrait`) and the R4 key test in `tests/convex/combat-vision.test.ts` |
| dcm-bxp.96 (G14) part (b): `addObject` with both `kind` and `sprite` is INVALID (user answer 2026-10-23) | The server change is one line in `convex/combatMapEdit.ts` (owned: `if (kind !== undefined && sprite !== undefined) throw appError("INVALID", ...)` before the placement), but `tests/convex/combat-map-edit-sprites.test.ts` (not owned; `tests/convex/sprite-*.test.ts` does not match it) asserts in "fills the Classic kind, variant and radius from the catalog" that `kind` is ignored when a sprite is given (`kind: "crate", sprite: OAK` stores kind `tree`). That assertion must become an INVALID check in the same tracer. |
| dcm-bxp.97 (G15) thumbnails ignore painted cells | `convex/combatMaps.ts` (the list row carries no `combatMapCells`), plus a design choice (send the painted tiles in the list, or cache a thumbnail) |

## Deferred
dcm-bxp.95 (G13): deferred by the user on 2026-10-23. No change.

## Open questions
None: G10-G16 all have user answers.
