# TASK LN3-AO: area overlay, area-effect sprites, point picking, GM draw / move / resize

Plan `.omc/plans/lanes-2.yaml`, wave 9, tracer AO (label `lane:w1-e4-targeting-areas`, branch `lane3-ao`). Beads
dcm-lqnt (overlay + point-picking UI), dcm-u2wx (client half: send `point`), dcm-bxp.99.19.39 (Dark Cloud: the GM
draws / adjusts). Book pages are printed pages (CB = Core Book). No `types.ts` or `src/lib/srd/**` file was edited.

## What landed

- **Art pipeline** (`scripts/sprite-packs/cut-areas.ts`, `lib/areas.ts`, `lib/areas-manifest.ts`): reads
  `/mnt/c/Users/Petar/sprite-sheets/area-effects/{fills-1..4,decals,walls}.jpg` (magenta background; `--src` to
  override, `--dry` for PNG previews only), cuts the 2×2 fill sheets (seam-fixed tiles; the swirl fills aura-earth,
  aura-air and ink are not seam-fixed), the 3×3 decal sheet (cut-out rings) and the four wall strips, and writes
  `public/area-effects/<kind>.<hash>.webp` (29 files, ~1.2 MB) plus the generated
  `src/lib/combat-map/area-effects/manifest.ts`. Reruns are reproducible (same hashes). Raw sheets are never committed.
- **Kinds** (`src/lib/combat-map/area-effects/kinds.ts`, `index.ts`): sheet layout, draw mode per kind (`tile`,
  `scale` for the swirls, `decal`, `wall`), opacity (fills 0.6, moonlight / silence 0.45), the label → kind table (first
  match wins, shape must fit: a wall kind only for a wall), `generic` fallback; `areaArt(label, shape)` gives the URL.
- **Overlay** (`src/components/combat-map/map-view/area-overlay.tsx`, mounted in `map-board.tsx` over the canvas,
  under fog and tokens): every live area of `combatAreas.list` (the server returns only the live map's areas to a
  player). Fills are a pattern clipped to the circle; swirls one image scaled to the circle and clipped; decals scaled
  to the circle; walls a strip repeated along the line, one square thick (no wall art: a dashed line). A circle reaches
  its Defined Range (CB p.103) plus half its centre's footprint, as the vision engine's disc. Own error boundary
  (rule 11).
- **Point picking** (`area-pick.tsx`): a small module store (`startAreaPick` / `cancelAreaPick`), a banner and a
  crosshair click layer over the map with a hover square and the radius preview; Escape cancels. The sheet drawer's
  Use (`drawer/use/index.tsx` `AreaUse`, `model.ts` `pointAreaOf` / `areaUseLine`) detects a use whose `area` step is
  `point`-centred (no targets, not a wall), closes the drawer, asks for the square and sends
  `combatFeatures.useFeature` with `point`; the banner shows the roll and whether the area went down.
- **GM edits** (`convex/combatAreaEdits.ts`, all `gmMutation`): `draw` (circle: centre + radius, default Close; wall:
  two ends; owned by a PC of the campaign; `featureId: "gm:hand"`, lasts the scene; at most 60 live areas per map,
  COMBAT_AREA_LIMIT), `move` (circle centre; a wall keeps its length / direction or takes new ends `to`), `resize` (a
  circle's radius). Remove uses `combatAreas.remove`. Squares off the map: COMBAT_TARGET_INVALID. The GM is not held to
  a feature's `placeWithin`.
- **GM tools** (`AreaTools` in `area-overlay.tsx`, the board's "Areas" toggle in Play): list with radius select
  (optimistic), Move (pick on the map), Remove (optimistic); a draw form (name, shape, radius, owner PC, blocks sight)
  that picks on the map. Minimal until the combat UI redesign (dcm-bxp.99.32).
- **Authz**: `combatAreaEdits.draw` / `move` / `resize` entries (access `gm`) in `tests/convex/authz/combat.entries.ts`.
- **Tests**: `tests/unit/area-effects-kinds.test.ts` (kind table, styles, manifest, `areaArt`, `pointAreaOf`,
  `areaUseLine`), `tests/unit/area-effects-cutter.test.ts` (cutter on a synthetic fixture sheet),
  `tests/convex/lane3-ao-area-edits.test.ts` (draw / move / resize, defaults, refusals, players only see the live map,
  a moved token-centred area stops following its token, player FORBIDDEN), `tests/e2e/area-overlay.spec.ts` (two browsers: GM draws a Dark Cloud, resizes,
  moves, draws a Wall of Flame, removes both; a level-5 Nightwalker picks Dark Cloud's square from the drawer; the
  player sees the live map's areas only).

## Beads

| Bead | State | What / left |
|---|---|---|
| dcm-lqnt | closable | Overlay with sprites, generic fallback, point picking UI, GM tools. The Hand (card) side of point picking is the wave-10 follow-up below. |
| dcm-u2wx | closable (client half) | Drawer sends `useFeature` `point` for point-centred feature areas. Server half was E6's (wave 8). |
| dcm-bxp.99.19.39 | closable after S2 | GM draw / move / resize done (Close by default). The SRD data switch (radius `veryClose` → `close` in ranger-rogue.ts) is S2's in this wave. |

## Follow-ups (to file at merge)

- Hand / card point picking: `useCard` needs a `point` arg (E1.3a, lane:w1-e1-triggers-rolls); then the Hand calls
  `startAreaPick` the same way as `AreaUse`.
- Walls and `count` areas from a feature use (two / several squares): `useFeature` takes one `point` only;
  `pointAreaOf` skips walls. Needs a `points` arg (lane:w1-e6-endings-durations).
- Token-centred areas whose token the viewer cannot see are not drawn for that viewer (by design); fine-tune when the
  combat UI redesign lands (dcm-bxp.99.32, combat-ui).

## Data switches ready for wave 10

None from this tracer (no `src/lib/srd/**` file needed changing). ranger-rogue.ts Dark Cloud radius `close` is S2's.

## Merge-time actions

- package.json script (not AO's file):
  `"sprites:areas": "node --import ./scripts/sprite-packs/ts-hooks.mjs scripts/sprite-packs/cut-areas.ts"`
- Regenerate `convex/_generated` (new module `combatAreaEdits`); the authz entries are already in combat.entries.ts.

## QUESTIONS

- None blocking. Assumption: an area the GM draws by hand belongs to a PC (the `combatAreas` row needs a caster; the
  draw form picks one, default the first PC token) and lasts until the scene ends or the GM removes it. If the user
  wants GM-owned areas without a PC, `combatAreas.characterId` must be widened to optional.
