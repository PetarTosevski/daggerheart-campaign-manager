# TASK-SP-P4: Offline cutter script and the built-in pack import (the user's 60 sheets)

Status: Done; the user's four answers (2026-10-21, below) are applied and the pack is rebuilt. Plan:
`.omc/plans/sprite-packs.yaml`, tracer P4 (wave 2, depends on P0, P1, P2). Bead: dcm-bxp.56.

## Decisions this tracer implements

- **P2** (user): "The user's 60 sheets are built into the app as the default packs for every campaign: processed
  offline into cut, trimmed, keyed-to-transparency, resized WebP sprites plus a manifest, which ARE committed; the
  raw 2048 px sheets are NOT committed."
- **D6**: "The import (P4) also runs a seam-fix pass on each swatch (offset by half, cross-blend the seam) and
  reports tileability."
- **D8**: "Built-in keys are stable: `<setting>/<slug of the prompts-doc name>` ... WebP files are content-hashed
  (`<slug>.<hash8>.webp`) so they can be served immutable. Extra cut sprites beyond a list ... become numbered
  variants of the named sprite ... through scripts/sprite-packs/overrides.json."
- **Q5 = (a)**: sharp as a devDependency (P0 pinned 0.35.5, the version in node_modules).

## What was built

| File | Does |
|---|---|
| `scripts/sprite-packs/ts-hooks.mjs` | P0's resolve hook (extensionless relative imports -> `.ts` / `/index.ts`) plus a load hook that marks `.ts` files as ES modules (no MODULE_TYPELESS_PACKAGE_JSON warning, package.json untouched) |
| `scripts/sprite-packs/cut-sheets.ts` | `pnpm sprites:cut`: cut, label, apply overrides, write candidates + `manifest-draft.json` + report to `sprite-sheets/_out/`; the repo is not changed |
| `scripts/sprite-packs/build-pack.ts` | `pnpm sprites:build`: the same run, then writes `public/sprite-packs/<folder>/<slug>[-v<n>].<hash8>.webp` and `src/lib/sprite-packs/builtin/manifest.ts`; `--setting` rebuilds only those folders and keeps the rest (the manifest is byte-identical after a partial rebuild of unchanged sheets; checked) |
| `scripts/sprite-packs/lib/options.ts` | `--src` (default `/mnt/c/Users/Petar/sprite-sheets`), `--setting` (repeatable), `--out` (default `sprite-sheets/_out`) |
| `scripts/sprite-packs/lib/pipeline.ts` | decode (sharp) -> P2 `cutSheet` / `cutTerrain` -> overrides -> label by P1 catalog order -> resize (objects fit `w x h` squares at `SPRITE_PX_PER_SQUARE` 160; textures `TEXTURE_PX` 512, then `seamFix`, kept only when it tiles better). Also `unpink`, `unmix`, `rotate90`, the long-item orientation check, extra sheets |
| `scripts/sprite-packs/lib/overrides.ts` + `overrides.json` | the override format (zod-validated) and the fixes below |
| `scripts/sprite-packs/lib/encode.ts` | WebP encode with budgets (object <= 80 KB starting at q82, texture <= 200 KB at q80; quality steps down if needed, never needed today), sha256 hash8, manifest entries, the generated TS source (fixed key order) |
| `scripts/sprite-packs/lib/report.ts` | contact sheets (checkerboard, index, name, size, sight, light, shadow height, the app's shadow preview to the bottom right; terrain tiled 3 x 3 with tileability before -> after), overall contact sheet, `report.html`, `summary.txt` |
| `src/lib/sprite-packs/builtin/manifest.ts` | generated, committed: `BUILTIN_MANIFEST` (schemaVersion 1) |
| `src/lib/sprite-packs/builtin/index.ts` | `BUILTIN_MANIFEST`, `BUILTIN_LOOKUP` (= `createSpriteLookup`), `BUILTIN_SPRITE_BASE` (`/sprite-packs/`), `builtinSpriteUrl(file)` for P6 / P9 |
| `src/lib/sprite-packs/catalog/**` | (added to P4's owns for the answers) extra-sheet items (`extras` in `defineFolder`, `extraSheet`, `entrySheetId`, `entriesOnSheet`); sewer channel crossing 2 x 2, thick hedge 2 x 1, pew row 2 x 2 |
| `public/sprite-packs/**` | 580 WebP files, 8,278,812 bytes (7.90 MB) |
| `docs/sprite-packs/prompts.md` | Status: cutter built, how to regenerate one sheet and rebuild its setting, overrides, extra sheets, frame / grid-line / glow tolerances |

Re-run: `pnpm sprites:cut` (review) then `pnpm sprites:build` (writes the pack); both take about 85 s for all 60
sheets. One folder: `pnpm sprites:build --setting <folder>`.

### Overrides (format in `scripts/sprite-packs/lib/overrides.ts`)

Per sheet id (`<folder>/<file name>`) one object or a list; each may carry `when: {found: n}` and then applies only
while the cutter finds n cuts. Fields: `skip`, `variants` ({cut: slug} -> next numbered variant, D8), `order`,
`unpink` (remove the pink aura of soft glows: every pixel leaning magenta fades out; opt-in because purple objects
lean magenta too, which is why P2 dropped a global version), `unmix` (re-key a cut from the sheet by unmixing the
magenta, no erosion: thin light strands like webs survive), `rotate` (90 / 180 / 270 clockwise), `note`.

### Extra sheets

Any `<props|large|terrain>-<suffix>.<jpg|jpeg|png|webp>` in a folder (e.g. `town-street-and-market/large-2.jpg`) is
cut when present and ignored when absent. New items on it are **new catalog items, not variants** (answer 1): the
folder's catalog file lists them under `extras: { "large-2": [...] }` (the prompts doc gets a matching
`- large-2: ...` line); `defineFolder` appends them to their layout's list (large) with their own keys, traits,
`extraSheet: "large-2"` and their index on that sheet, so the mapping tables and lookups see them. The cutter labels
the extra sheet's cuts from that list in reading order, like a primary sheet, and reports the sheet as absent when the
catalog lists items for a sheet that is missing. `overrides.json` `variants` can still name a cut as a redrawn
existing item; any other cut appears as "UNASSIGNED" with its PNG in `_out/<folder>/`. No extra sheet exists today
(the optional cottage sheet was never made), so the catalog has no extra items and the count stays 580. Checked with a
throw-away copy of town-street-and-market/large.jpg saved as large-2.jpg and two temporary catalog items: 31 sprites,
the two new keys labelled from cuts #1 and #2, cuts #3..#9 unassigned (catalog change reverted).

## Results on `/mnt/c/Users/Petar/sprite-sheets` (all 60 sheets; the `_replaced` folder is ignored)

Every sheet gives its expected count (16 / 9 / 4); 580 catalog items, 580 files, 0 missing, 0 variants, 0
unassigned. Fringe after defringe 0.000 on all 40 object sheets. Largest object 62 KB (cave/giant-spider-web),
largest texture 104 KB (temple/mosaic-floor). Per folder 309 KB (ship-deck) to 498 KB (forest).

| Folder | props | large | terrain | Overrides / notes |
|---|---|---|---|---|
| common | ok | ok | ok | `unpink` #9 campfire, #10 burnt-out campfire, #11 torch, #12 brazier, #16 rope + lantern |
| forest | ok (components fallback) | ok | ok | thick hedge now 2 x 1 rect (answer 4) |
| grassland-and-road | ok | ok (components fallback, #9 stone wall touches border, kept; 1024 px sheet, grid lines keyed out) | ok | — |
| mountain-and-cliffs | ok | ok | ok | `rotate` #7 rope bridge 90 (drawn upright, catalog 2 x 1) |
| cave | ok | ok | ok | `unmix` #10 spider web and large #5 giant spider web (were almost erased); `unpink` #2 glowing mushroom cluster, large #4 chasm crack, #8 collapsed tunnel |
| dungeon | ok (components fallback) | ok | ok | `unpink` #14 candle cluster, large #8 stone stair down, #9 altar with candles |
| crypt-and-graveyard | ok | ok | ok | `unpink` #9 lantern on a post, large #9 catacomb niche wall; `unmix` #10 spiderweb |
| castle-interior | ok | ok | ok | — (red carpet already tiled 1.00; seam fix skipped for it) |
| tavern | ok | ok (components fallback) | ok | terrain sheet regenerated (answer 2); kitchen tiles accepted: tile 0.36, kept as drawn (the seam fix did not improve it), clean in the 3 x 3 preview |
| town-street-and-market | ok | ok | ok | — |
| temple | ok (components fallback) | ok (components fallback) | ok | `unpink` #1 candle stand; pew row now 2 x 2 rect (answer 4); terrain sheet regenerated (answer 2): stone tiles with runes accepted as cut (0.37, kept as drawn); polished wood 0.34 (0.23 before the fix; new on this sheet, looks fine tiled) |
| swamp | ok | ok | ok | `unpink` #5 will-o'-wisp; `rotate` large #9 broken boardwalk 90 |
| snow-and-tundra | ok | ok | ok | `unpink` #5 animal tracks, #8 campfire in snow, large #8 tent, #9 ice cave mouth; igloo variant override present but inactive (sheet regenerated: 9 cuts) |
| desert | ok | ok | ok | `unpink` large #7 giant skeleton ribs |
| coast-and-beach | ok | ok | ok | `unmix` #5 fishing net |
| ship-deck | ok | ok | ok | — |
| sewers | ok (#4 pipe outlet touches border, kept) | ok | ok | `rotate` large #6 stone bridge over channel 90; large #1 is now "sewer channel crossing", 2 x 2 rect (answer 3) |
| ruins | ok | ok | ok | terrain sheet regenerated (answer 2); sand-covered tiles keep the seam-fixed version (0.33 -> 1.00) |
| mushroom-cavern | ok | ok (#8 chasm touches border, kept) | ok | `unpink` #1 glowing blue mushroom (purple rim), #15 drow lantern; #2 glowing purple mushroom left alone (it is purple) |
| volcanic | ok (components fallback) | ok | ok | `unpink` #2 steam vent, #5 scorched bones, #7 ember pile, #9 smoking crater, large #4 fire geyser, #7 lava bridge |

P2's known issues, each resolved or listed: snow-and-tundra/large count mismatch (sheet regenerated, 9 cuts;
the variant override stays for the old sheet, verified on `_replaced/snow-and-tundra-large.jpg`: cut #10 becomes
`igloo` variant 2); border touches kept (listed above); grassland-and-road/large grid lines (keyed out); pink aura
on the swamp will-o'-wisp, dungeon candles, volcanic smoke and dungeon/large stairs (`unpink`, above).
Terrain tileability after the fix: 0.34 .. 1.00. Below 0.5 and accepted (answer 2), not failures: tavern kitchen
tiles 0.36 and temple stone tiles with runes 0.37 (both kept as drawn, the seam fix scored lower), temple polished
wood 0.34 (new swatch; seam-fixed; visually fine in the 3 x 3 preview, recorded for the user). The ruins sand-covered
tiles score 1.00 after the seam fix (0.33 before).

## Review output (git-ignored, for the user)

`sprite-sheets/_out/` in this worktree: `contact-overall.png`, `contact-<folder>.png` (20), `report.html`,
`summary.txt`, `manifest-draft.json`, `<folder>/<slug>.png` candidates and `<folder>/<slug>-3x3.png` terrain
previews.

## Acceptance evidence

- `tests/unit/sprite-builtin-pack.test.ts` (8 tests): manifest passes `builtinManifestSchema`, no unknown keys;
  every catalog item has a file (known-missing list empty); catalog order per folder; file names `<folder>/<slug>
  [-v<n>].<hash8>.webp`; textures carry a seam score; every file exists with the recorded pixel size (read from
  the WebP header), objects fit their squares at 160 px and touch one side, textures are 512 x 512; objects
  <= 80 KB, textures <= 200 KB; no unreferenced file; total <= 24 MB; `git ls-files sprite-sheets` is empty.
- `tests/unit/sprite-catalog.test.ts` (77): extra-sheet lists match the doc, no extra items today, a synthetic
  folder with `large-2` / `props-2` / `terrain-2` extras (keys, sheet id, index, default size, texture suffix), bad
  extra-sheet id and duplicate key throw; the answer-3/4 sizes.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (157 files, 1891 tests) pass.
- No visual spec: P4 has no UI; its counterparts are the contact sheets above.

## Answers (the user, 2026-10-21)

1. **Extra sheets:** new items go into the catalog as new items, not variants. Done as the `extras` mechanism above;
   no extra sheet exists, so no items were added.
2. **Terrain:** the tavern, temple and ruins terrain sheets were regenerated and re-cut; tavern kitchen tiles clean,
   temple rune tiles acceptable as cut, ruins sand-covered tiles keep the seam-fixed version; low scores accepted.
3. **Sewer channel:** a 2 x 2 crossing, renamed "sewer channel crossing" (key `sewers/sewer-channel-crossing`; the old
   key was never merged, so no placed object refers to it).
4. **Sizes:** forest thick hedge 2 x 1 (rect), temple pew row 2 x 2 (rect).

## Outside this tracer

Nothing needed. (P6 reads `src/lib/sprite-packs/builtin` and `public/sprite-packs`.)
