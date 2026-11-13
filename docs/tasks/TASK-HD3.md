# TASK-HD3: @2x sprite-pack files for zoomed-in high-density screens

Status: Review. Plan: `.omc/plans/sharp-4k.yaml`, tracer HD3 (bead dcm-ggk3.4, depends on HD1). User (2026-11-13):
scope "Everything" (all built-in sprite-pack files, textures and objects), the HD2 model (realesr-animevideov3 2x).

## What changed
- `scripts/sprite-packs/upscale-2x.ts` (new): writes an @2x sibling of every built-in file
  (`<folder>/<slug>@2x.<sha256 of the bytes, 8 hex>.webp`, exactly twice the 1x size) and records it in the generated
  manifest as `file2x` (last field of each line, so every other field stays byte-for-byte as it was). Per folder:
  one upscaler run, then that folder's files and the manifest are written, so a stopped run resumes; files that
  already have an @2x file on disk are skipped unless `--force`.
  - Objects: `scripts/srd/upscale.mjs` keeps the alpha clean (colour bled under transparent pixels, alpha resized
    with lanczos3), as for the HD2 art. WebP q82, budget 4 x 80 KB.
  - Textures: each tile is padded with 64 px wrapped from its opposite edges, upscaled, and the centre cropped back
    to exactly 2x, so the network sees the neighbour across every wrap edge. WebP q90 (see "Seams"), budget
    4 x 200 KB. `--preview <dir>` writes a 2 x 2 wrap-around PNG of every texture.
  - Retries: the upscaler sometimes loses the Vulkan device mid-run (`vkQueueSubmit failed -4`, then it writes blank
    images and still exits 0) or hangs. `upscale.mjs` now reads the tool's stderr and fails the run on any "failed"
    line, takes `tile` (`-t`) and `timeoutMs` (kills the Windows process with `taskkill.exe`); `upscale-2x.ts` runs
    with `-t 128` (the auto tile lost the device on most folders), retries a folder up to 4 times, halving the tile
    each time.
- `src/lib/sprite-packs/manifest-schema.ts`: optional `file2x` on every manifest file (`...@2x.<8 hex>.webp`).
  `scripts/sprite-packs/lib/encode.ts` writes it; `build-pack.ts` notes that a rebuilt folder loses its @2x files
  (rerun `upscale-2x.ts --setting <folder>` afterwards); `lib/run.ts` exports `currentManifest`.
- `src/lib/sprite-packs/builtin/index.ts`: `builtinHiRes(url)` maps a built-in file's URL to its @2x URL and the 1x
  pixel size (map built on the first call).
- `src/lib/combat-map/sprites/loader.ts`: `SpriteImages` takes an optional `HiRes` lookup (the page's
  `spriteImages()` passes `builtinHiRes`). `sprite`, `shadow` and `texture` load the @2x file only when the size the
  painter asks for is larger than the 1x file (`w > px.w || h > px.h`; a texture tile above 512 px). While the @2x
  file loads, an already-loaded 1x file is drawn; listeners always hear the 1x URL (the one the painter knows); a
  failed @2x file falls back to 1x. Cached bitmaps are keyed by the file they were drawn from. At normal zoom
  (k = 2 on a mouse screen: 96 px per square, a 384 px texture tile, sprites at most 160 px per square) nothing
  changes. The phone app has its own `SpriteArt` (`apps/mobile/src/features/combat-map/sprite-art.ts`) and reads
  only `file`, so it loads exactly what it loaded before.
- Tests: `tests/unit/sprite-loader-hires.test.ts` (the threshold for sprites, shadows and textures, the 1x stand-in,
  the fallback, uploads, and `builtinHiRes` over the whole manifest); `tests/e2e/combat-map-hidpi.spec.ts` gains
  "a Sprites map loads the 1x sprite files at 100 % and their @2x files once zoomed in on a 2x screen".

## Sizes (public/sprite-packs)
SIZES

## Seams
SEAMS

## How to rerun
```bash
# realesrgan-ncnn-vulkan v0.2.5.0 (github.com/xinntao/Real-ESRGAN releases), Windows build under WSL:
node --import ./scripts/sprite-packs/ts-hooks.mjs scripts/sprite-packs/upscale-2x.ts \
  --upscaler <dir>/realesrgan-ncnn-vulkan.exe [--setting <folder>]... [--force] [--preview <dir>] [--tile 128]
```
After `pnpm sprites:build --setting <folder>`, rerun it for that folder. If a run is interrupted under WSL, end the
Windows process with `taskkill.exe /F /IM realesrgan-ncnn-vulkan.exe`. Work files go to
`sprite-sheets/_out/upscale-2x/` (git-ignored).

## Checks
CHECKS
