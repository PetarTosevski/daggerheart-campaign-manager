# TASK-SP-P11Z: Batch 2 built into the pack - overrides, cut, rebuild, tests

Status: Done. Plan: `.omc/plans/sprite-packs.yaml`, tracer P11Z (depends on P11A, P11B, P11C). Bead: dcm-bxp.56.

## What changed

| File | Change |
|---|---|
| `scripts/sprite-packs/overrides.json` | the 25 batch-2 entries from TASK-SP-P11A/B/C (each note names its tracer) and one from this review, grouped by folder |
| `scripts/sprite-packs/lib/overrides.ts` | `when` takes `sha256` (a hex prefix of the sheet file's SHA-256) next to `found`, so a fix can apply to one sheet file only |
| `scripts/sprite-packs/lib/pipeline.ts` | `stripMagentaFrame` before `cutTerrain`; the sheet file's SHA-256 goes to `activeOverride` |
| `src/lib/sprite-packs/catalog/volcanic.ts` | red-hot cracked ground: terrain `stone` -> `lava` (user, 2026-10-21: difficult terrain; owns widened by the orchestrator) |
| `docs/sprite-packs/prompts.md` | `- props-2:` / `- large-2:` (`- large-3:` town) / `- terrain-2:` lines for the 19 settings and `common/props-2`, `common/large-2`, `common/terrain-2` in the shared section; status, extra sheets, magenta-frame tolerance |
| `public/sprite-packs/**`, `src/lib/sprite-packs/builtin/manifest.ts` | rebuilt: see "Pack" |
| `tests/unit/sprite-catalog.test.ts`, `sprite-builtin-pack.test.ts`, `sprite-painter.test.ts` | pins below; the painter test pins cobblestone road (not every forest path texture) as non-rotatable |

### The town large-3 order fix applies to the current file only

P11B's `order` (row 3 drawn tannery, canal, gallows) is scoped with `when: {sha256: "93c09597b2743fbe"}`, the current
`town-street-and-market/large-3.jpg`, together with its `unpink` of the canal (cut #8 on that file). The user will
regenerate the sheet in catalog order; the new file has another hash, so neither the reorder nor the canal unpink
applies to it (the report lists them as inactive). The `untint` of the market hall and stable entrances (cuts #5, #6,
same place in both orders) stays under `when: {found: 9}`; check it again on the regenerated sheet.

### Magenta outer frame on terrain sheets

`cutTerrain`'s frame finder (`src/lib/sprite-packs/cut/terrain.ts`, `frameDepth`) sets the frame colour from the
outermost non-magenta pixels, so a plain magenta frame is never found. The fix lives in the pipeline (P11Z owns
it, not the cut core): `stripMagentaFrame` cuts away, from each edge, the lines whose middle 60 % is at least half
gap magenta, then `cutTerrain` runs on the rest. Measured frames: grassland terrain-2 76..78 px, mountain 42 px,
town 23..24 px, forest 24..26 px. Sheets with a white or no frame come back unchanged (the same image object), so
every primary terrain swatch is byte-identical.

For the browser upload (P8) the same fix belongs in the cut core. Suggested diff for whoever owns
`src/lib/sprite-packs/cut/terrain.ts`:

```diff
 export function cutTerrain(img: RgbaImage): TerrainCut {
-  const top = frameDepth(img, (k) => midX.map((x) => [x, k]), limit);
+  // A plain magenta frame first (lines mostly gap magenta), then a flat frame of another colour inside it.
+  const magentaDepth = (line: (k: number) => Array<[number, number]>) => {
+    let k = 0;
+    while (k < limit && line(k).filter(([x, y]) => isGapMagenta(...px(img, x, y))).length >= line(k).length * 0.5) k++;
+    return k;
+  };
+  const m = { top: magentaDepth((k) => midX.map((x) => [x, k])), ... };
+  const top = m.top + frameDepth(img, (k) => midX.map((x) => [x, m.top + k]), limit);
   (same for bottom, left, right)
```

### Textures: extra-sheet textures join the Classic -> Sprites mapping

Decision: keep them joining (textures have no `standIn` flag), for more variety. `textureCandidates` lists each
terrain's primary textures first, in order, then the extra-sheet ones (a test pins that no primary texture comes
after an extra one). Picks stay deterministic (`pickTexture` hashes terrain, block and seed, unchanged).

What changes on existing Sprites maps (`textures only add candidates` test pins the counts):

- **70 (setting, terrain) pairs gain variants.** They keep every texture they had and add the new ones; common's new
  gravel, dry yellow grass, pebbled ground and trampled mud reach every setting that falls back to common.
- **11 pairs had no texture of their own and now use the setting's batch-2 one.** 3 were drawn the Classic way
  before and now get a texture: forest water (forest stream pebbles), town water (canal water), coast swamp (tidal
  mudflat). 8 fell back to common's texture and now use the setting's instead: grassland dirt (ploughed soil),
  tavern dirt (straw-covered / sawdust floor), snow dirt (frozen gravel), crypt path (overgrown graveyard path),
  temple path (white gravel), sewers path (wet cobbled tunnel floor), ruins grass (vine-covered ground),
  mushroom-cavern stone (wet obsidian).
- **A block's pick can move to another texture of the same pool.** `pickTexture` takes `hash % list.length`, so a
  longer list re-deals the blocks: a forest grass block that showed moss may now show tall grass. The look of an
  area keeps the same terrain family but is not pixel-stable.

`mapping.ts` is not P11Z's file. If the user wants existing maps to change **only** by gaining variants (old
picks kept exactly, the 8 common fallbacks kept as they were), this change to `src/lib/sprite-packs/mapping.ts`
does it (suggested, not applied):

```ts
/** A terrain's pool: the primary textures it always had (setting, else common) and the extra-sheet ones it gains. */
function texturePool(terrain: Terrain, setting: string) {
  const of = (folder: string) => MAPPING.get(folder)?.terrains.get(terrain) ?? [];
  const primary = (l: readonly TextureEntry[]) => l.filter((e) => !e.extraSheet);
  const extra = (l: readonly TextureEntry[]) => l.filter((e) => e.extraSheet);
  const own = of(setting);
  const common = of(COMMON_FOLDER);
  const base = primary(own).length > 0 ? primary(own) : primary(common);
  const gained = primary(own).length > 0 || extra(own).length > 0 ? extra(own) : extra(common);
  return { base, gained };
}
export function textureCandidates(terrain: Terrain, setting: string): readonly TextureEntry[] {
  const { base, gained } = texturePool(terrain, setting);
  return [...base, ...gained];
}
export function pickTexture(terrain: Terrain, setting: string, x: number, y: number, seed: number): string | null {
  const { base, gained } = texturePool(terrain, setting);
  const bx = Math.floor(x / TEXTURE_SQUARES);
  const by = Math.floor(y / TEXTURE_SQUARES);
  const h = hash(`${terrain}|${bx}|${by}|${seed}`);
  if (gained.length === 0) return base[h % base.length]?.key ?? null; // exactly the old pick
  const g = hash(`${terrain}|${bx}|${by}|${seed}|gained`) % (base.length + gained.length);
  return g < base.length ? (base[h % base.length]?.key ?? null) : (gained[g - base.length]?.key ?? null);
}
```

With it, a block keeps its old texture with probability base / (base + gained) and otherwise shows a new variant;
the painter's noise mix (P6, `sprite-fallback.ts`, `resolve.ts`) reads `textureCandidates` and would need the same
check. The catalog tests above would then pin `forest dirt` = common's 3 and the 8 pairs as base + gained.

## Pack

`pnpm sprites:build` on `/mnt/c/Users/Petar/sprite-sheets` (all 121 sheets: 60 primary, the village, 60 batch 2):

- **1,169 sprites, 1,169 files, 0 missing, 0 variants, 0 unassigned**: 580 primary + 9 village + 580 batch 2. Every
  batch-2 sheet cuts to its count (16 / 9 / 4); fringe after defringe 0.000 on every object sheet.
- **19,078,942 bytes (18.20 MB)** in `public/sprite-packs` against the 24 MB total budget (was 8,453,644).
- Largest object: forest/sapling-thicket 66.9 KB (the `unmix` keeps its thin leaves), then cave/giant-spider-web
  62.3 KB and grassland-and-road/vineyard-rows 59.7 KB, against 80 KB. Largest texture: temple/purple-prayer-carpet
  103.6 KB, forest/pine-needles 103.5 KB, against 200 KB. Per folder 715 KB (tavern) to 1.20 MB (forest).
- The 589 earlier files are byte-identical (the diff only adds 580 files; the manifest only adds lines).
- One fix from this review: `ship-deck/props-2` `unpink` #10 (the pile of caught fish's wet patch). It helps only a
  little: the mauve patch is drawn opaque.
- The cutter reports the magenta frame it stripped: forest 25, grassland 77..78, mountain 42..43, town 24,
  crypt 7..8, temple 8..9 px; castle and tavern 1 px on one side (a JPEG edge line).

## Contact sheets (cuts with overrides applied)

A contact sheet per folder of the 29 batch-2 sprites as built (checkerboard, sheet and index, key), scratch only.
The cutting is clean everywhere: right names in the right order (the town large-3 row 3 now reads tannery, gallows,
canal), no magenta background, no cell lost. What is still visibly wrong is mostly the art (side views), not the cut:

| Folder | Verdict | Still visibly wrong |
|---|---|---|
| common | ok | — (ox rotated head-left; the magic circle glow is soft white) |
| forest | ok | faint rainbow tint on #13 stepping stones (iridescent water, acceptable) |
| grassland-and-road | ok | windmill, bridge, granary and stable drawn 3/4 (readable) |
| mountain-and-cliffs | ok (note) | large-2 #3 waterfall over a cliff and #7 monastery wall corner are side views |
| cave | regenerate large-2 | labels gone, but #3 ledge, #5 waterfall and #8 stalactites are side views, #7 troll in a pit |
| dungeon | ok | props-2 #5 stocks and #10 open door drawn front-on |
| crypt-and-graveyard | ok (note) | large-2 #1 mausoleum, #4 gravedigger's hut and #6 row of headstones drawn in elevation |
| castle-interior | **regenerate recommended** | most of props-2 (chess table, wash basin, writing desk, wine rack, screen, spinning wheel, wardrobe, reading chair) and large-2 #4 pipe organ, #5 gatehouse portcullis (a front elevation, though it is a door), #6 knight statues, #9 battlement wall are side or front views |
| tavern | ok | large-2 #1 wine-cellar rack and #9 back-bar shelves drawn front-on |
| town-street-and-market | regenerate large-3 (planned) | #9 canal: rose-grey haze on both banks; #4 clock tower drawn upright in elevation |
| temple | ok (note) | large-2 #4 entrance steps, #5 brass bell and #9 colonnade are front views |
| swamp | ok | — |
| snow-and-tundra | ok | large-2 #6..#8 are square tiles (as P11B noted) |
| desert | ok | faint pink rim left under props-2 #9 helmet and around #13 quicksand after `unpink` |
| coast-and-beach | ok | violet water halo round large-2 #9 sea-stack arch (reads as water) |
| ship-deck | ok | props-2 #10 fish: mauve wet patch (above) |
| sewers | regenerate large-2 | isometric #5..#7 and #9; the pink halos are gone |
| ruins | ok (note) | large-2 #4, #6, #7 isometric (as P11C noted) |
| mushroom-cavern | ok | terrain-2 #1 violet glowing moss repeats in visible diagonal stripes when tiled |
| volcanic | ok | — |

## Sheets to regenerate, with prompt fixes

Collected from TASK-SP-P11A, P11B and P11C plus this review. The cut sprites from the current sheets are in the pack
now and usable; regenerating a sheet and running `pnpm sprites:cut --setting <folder>` then `pnpm sprites:build
--setting <folder>` replaces them without changing keys.

1. **sewers/large-2** (P11C): #5 sluice gate, #6 smugglers' canal boat, #7 pair of brick pillars and #9 wererat den
   are drawn in 3/4 or isometric view with walls behind them; soft pink halos on 8 of 9 cells. Prompt fix, before
   the style block: "Draw every object strictly from directly above, as a floor plan: no walls standing behind it,
   no front faces, no 3/4 or isometric view. The sluice gate is a wooden gate across a channel seen from above; the
   canal boat is a boat seen from above on no water; the brick pillars are two separate square pillar tops; the
   wererat den is a nest of rags and bones on the floor. Hard clean edges against the magenta: no soft glow, mist or
   halo." (Also consider one pillar instead of a pair: as one rect footprint the pair blocks the gap between them.)
   After regenerating, drop or re-check the `sewers/large-2` unpink list.
2. **cave/large-2** (P11A): a text label under every item; #8 giant stalactite cluster and #5 underground waterfall
   are side views; #7 cave troll sits in a drawn pit. Prompt fix: "No text anywhere: no labels, captions or names
   under the objects. Every object strictly top-down (seen from directly above), never a side view: the giant
   stalactite cluster as a ring of stone cone tips around a dark centre seen from above, the underground waterfall
   as a pool with a foaming fall at one rock edge seen from above, the cave troll standing on plain ground without
   a pit around it." The `cave/large-2` unpink is scoped to `found: 9`; re-check the goblin camp rim.
3. **town-street-and-market/large-3** (P11B), in catalog order (row 3: tannery vats, gallows platform, canal with a
   footbridge): the canal's banks fade from green into magenta and leave a rose haze. Prompt fix: "canal with a
   footbridge: a straight stone-lined canal crossed by an arched stone footbridge; the canal's stone walls end in a
   crisp outline on the flat magenta; no grass, no ground and no soft fade beside the canal." The order fix is
   scoped to the current file's hash (above), so the regenerated sheet is labelled as drawn.
4. **grassland-and-road/terrain-2, town-street-and-market/terrain-2** (P11A, P11B): not needed any more; the
   magenta-frame fix strips the frame (77..78 and 24 px; the swatches show no pink strip). For future terrain prompts add "The four swatches fill the
   image edge to edge: no outer border or frame of any colour; only a thin straight magenta cross separates them."
5. **snow-and-tundra/large-2** (P11B, optional): #6 frozen ship's bow, #7 ice bridge and #8 glacier crevasse are drawn
   as full square tiles with hard square edges. Prompt fix: "each drawn as an object with its own outline on the
   flat magenta, not a square tile."
6. **castle-interior/props-2 and large-2** (this review, recommended): most items are drawn as furniture seen from
   the front. Prompt fix, before the style block: "Every object seen from directly above, as on a floor plan: for
   furniture show the top (the table top, the desk top, the wardrobe's roof, the chair's seat and the back as a thin
   bar), never the front. The gatehouse portcullis is a strip of iron bars across a stone gate passage seen from
   above; the knight statues are two figures on round plinths seen from above; the battlement wall is a stretch of
   wall top with crenellations seen from above; the pipe organ is a console with a bank of pipe tops seen from above."
7. Optional, same "seen from directly above, never a front or side view" line for: mountain-and-cliffs/large-2 (#3,
   #7), crypt-and-graveyard/large-2 (#1, #4, #6), temple/large-2 (#4, #5, #9), ruins/large-2 (#4, #6, #7).
8. Optional: **mushroom-cavern/terrain-2** violet glowing moss: "the glowing patches scattered irregularly, no
   stripes or rows".

## Tests

- `tests/unit/sprite-catalog.test.ts`: the prompts-doc parser reads `common/<sheet>-<n>` extra sheets in the shared
  section; extra-sheet counts per folder (16 / 9 / 4 + the village) and `standIn: false` on every extra object; key
  count 20 x 29 + 9 + 20 x 29 = 1169; the Q1 light lists (+6 torch, +8 campfire, +27 faint glow); the move overrides
  (+92); the doors (6 + 8 = 14: mountain pass gate, dwarven door, wooden door (open), round vault door, gatehouse
  portcullis, town gate, brig cell, sluice gate); red-hot cracked ground is lava / difficult; texture mapping (forest
  grass 6 candidates, forest dirt common's 3, forest water = stream pebbles, 6 picks over 100 blocks, primary-first
  order and the 70 / 11 counts); `folderEntries` 58 per folder.
- `tests/unit/sprite-builtin-pack.test.ts`: 1169 sprites, every batch-2 key has art; every overrides.json sheet is
  one the catalog draws and every index is in range (`order` a permutation); the town large-3 order applies only to
  the current file's hash; `stripMagentaFrame` strips a magenta frame and leaves the cross and a white frame alone.

## Acceptance evidence

- `pnpm lint`, `pnpm typecheck` clean.
- vitest (`--maxWorkers=4 --testTimeout=60000`): 201 files, 3434 passed (1 expected fail, 1 skipped, 188 todo).
  `tests/unit/sprite-painter.test.ts` (owns widened by the orchestrator) pinned "every forest path texture is
  non-rotatable"; forest path falls back to common, which now also has P11A's rotatable `gravel`, so it now pins
  `common/cobblestone-road` as non-rotatable.
- `sprite-catalog.test.ts` + `sprite-builtin-pack.test.ts`: 97 passed.
- `pnpm tracer:guard .omc/plans/sprite-packs.yaml P11Z` passes.
