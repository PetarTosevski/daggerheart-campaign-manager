# TASK-HD2: Sharper adversary and environment art (native extraction + Real-ESRGAN 2x)

Status: Review. Plan: `.omc/plans/sharp-4k.yaml`, tracer HD2 (bead dcm-ggk3.3, wave 1, no dependencies). User
(2026-11-13): re-extract at native size, upscale 2x offline with Real-ESRGAN, write at most 1800 px wide.

## What changed
- `scripts/srd/upscale.mjs` (new): shared helpers. `upscaleAll(sharp, items, { exe, model, work })` runs
  `realesrgan-ncnn-vulkan` once on a folder of PNGs and returns raw RGBA at exactly 2x; `upscaleArg` parses
  `--upscaler <exe>`, `--model realesr-animevideov3|realesrgan-x4plus` (default animevideov3) and
  `--upscale-work <dir>` (keeps the tool's in/out folders). A Windows `.exe` under WSL gets its paths through
  `wslpath -w`; UNC paths (`\\wsl.localhost\...`) work, so no staging folder under `C:\` was needed.
- Both extractors: `MAX_WIDTH` 900 -> 1800 (`withoutEnlargement` kept, lanczos3), QUALITY 80 unchanged. Matching
  (captions, ALIASES, SKIP, PICK, MANUAL, SHARED, CROPS) is untouched; the per-pick encode moved after the page loop
  so every image goes through one upscaler run. Without `--upscaler` the output is native size (up to 1800 px).
- Regenerated `public/adversary-art/` (109 files), `public/environment-art/` (29 files) and the two mapping files.
  The mapping diff against master changes only `width`/`height`, on every entry (138 lines), each exactly doubled
  (an old 900 px cap -> 1800 px; smaller originals -> 2x native). Ids, credits, counts and aspect ratios are unchanged.
- Tests: width bound 1800; budgets set from the measured totals with about 10 % headroom.

Command used (both scripts, same flags):
`node scripts/srd/extract-<adversary|environment>-art.mjs --core <core.pdf> --hf <hf.pdf> --pdfjs <node_modules>
--upscaler <dir>/realesrgan-ncnn-vulkan.exe` (realesrgan-ncnn-vulkan v0.2.5.0 Windows release, Intel Arc 140T over
Vulkan through WSL interop).

## Model choice: realesr-animevideov3 (native 2x)
Compared on 1:1 crops at 2x (lanczos, x4plus brought down to 2x with lanczos3, animevideov3 at 2x): the Head
Vampire's face (SHARED image), the Entombed Empress (painterly, chains), the Sprite (fine bow string and arrow,
alpha edges), the Knight of the Realm and the Local Tavern (environment).
- The originals are JPEG-compressed in the PDFs, with visible 8x8 blocks at native size.
- realesrgan-x4plus removes the blocks most thoroughly, but smooths faces into a waxy, plastic look (the vampire),
  smears hair and leaf texture, and invents brush strokes (hatching on the tavern's dark roof).
- realesr-animevideov3 keeps the painted features and line work closest to the source (the vampire's face, the chains,
  the bow string), removes most of the blocking, and invents nothing visible. Faint blocking survives in a few flat
  areas.
- Speed on this GPU: animevideov3 upscaled all 134 images in about 5 minutes. x4plus managed about one image a minute
  (roughly 2 to 3 hours for the set).

## Timings (animevideov3, final run)
- Adversaries: 105 unique PDF images (109 ids; the two SHARED images are upscaled once each), upscale 210 s, whole
  script 385 s.
- Environments: 29 images, upscale 101 s, whole script 173 s.

## Size totals
| Folder | Before (master) | After | Test budget |
| --- | --- | --- | --- |
| public/adversary-art | 12.2 MB (12 756 126 B) | 29.9 MB (31 341 366 B) | 33 MB (was 15) |
| public/environment-art | 2.9 MB (3 062 992 B) | 7.4 MB (7 778 128 B) | 9 MB (was 5) |

The adversary folder stays well under the 45 MB line, so WebP quality stays at 80. 76 of the 138 images reach the
1800 px cap.

## Alpha handling
Most art is cut out with an alpha mask. The tool's own alpha path was not used. Under fully and nearly transparent
pixels the PDFs store stray colours (black specks, bright green and yellow patches), and the network smears them into
the edge as a halo. For any image with transparency:
1. Pixels with alpha < 16 count as empty. Their RGB is replaced by the colour of the nearest opaque pixels through a
   pull-push fill (halve with premultiplied averaging until 1 px, then fill back up level by level).
2. Only that RGB goes through the model.
3. The original alpha is resized 2x with lanczos3 and recombined.
Checked at 1:1 on white and on black (Skeleton Knight, Sprite): no dark or light fringe. The faint pixels (< 6 %
opacity) now carry the neighbouring colour instead of their stray one, which is not visible.

## Spotlight (SHARED) order
Each SHARED image is upscaled once, before the spotlight. The greying is then computed on the final 2x pixels, and
the image is capped and encoded per adversary. The focus ellipses and the soft edge are fractions of the image, so
the effect is the same at any size. The compare images for the Head Vampire and the Harbinger of War match the old
ones.

## Judgement calls
- **"Thumbnails stay 400 px":** the extractors write no thumbnail files. The catalogue list's round thumbnail uses the
  same WebP. The only 400 px output is the `--review` PNG of unassigned images, which is unchanged.
- **Image width:** the report's "(w x h)" for adversaries is the paint operator's size. Some decoded images are wider
  (e.g. the Acid Burrower: 901 in the report, 1339 decoded). The real native widths are larger than the dry-run median
  suggested, so more images hit the 1800 cap.
- **Upscale-and-cap:** images already wider than 900 px are still upscaled and then brought down to 1800 px. This
  cleans their JPEG blocks too. One environment original (2376 px) is wider than the cap; the upscale gains it
  nothing but cleanup.
- **`--sharp <dir>`:** this option still points at `lib/index.js`, which sharp 0.35 no longer has. It was not needed
  (the plain `sharp` import resolves) and it is out of scope here.
- **Killing a run under WSL:** killing node leaves the Windows process running. Two such orphans once wrote into a
  shared work folder. The helper's header now says to use `taskkill.exe`.

## Review images (outside the repo)
Eight before/after PNGs and `index.txt` in the session scratchpad's `hd2/compare/`. Model crops are in
`hd2/faces/` and `hd2/cmp-anime/`, and the alpha checks in `hd2/edge-*.png`.

## Checks
`vitest --maxWorkers=2` on `tests/unit/adversary-art.test.ts` and `tests/unit/environment-art.test.ts` (12 passed),
`pnpm lint`, `pnpm typecheck`, `node scripts/tracer-guard.mjs .omc/plans/sharp-4k.yaml HD2`.
