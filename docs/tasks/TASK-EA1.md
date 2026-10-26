# TASK-EA1: Environment illustrations from the rulebooks

Status: Review. Plan: `.omc/plans/env-actions.yaml`, tracer EA1 (wave 2, after EF1). User (2026-10-19): "Can you add
images to any environments that had them, similar to adversaries".

## Goal
Every environment whose book page shows its illustration gets that art on its stat block and a round thumbnail in the
Environment list, like the adversary art (TASK-AA1). Environments without art look as before.

## What was built
- `scripts/srd/extract-environment-art.mjs` (local only, nothing in CI runs it; same flags as the adversary extractor):
  `node scripts/srd/extract-environment-art.mjs --core <core.pdf> --hf <hopefear.pdf> --pdfjs <node_modules with
  pdfjs-dist> [--sharp <sharp dir>] [--review <dir>] [--dry]`. Scans CB pp.242-251 and HF pp.98-112 (PDF index = printed
  page + 1).
  - The adversary extractor's approach: images from the pdf.js operator list, hand-lettered 7 pt all-caps captions matched
    to environment names, captions paired with the nearest image. Furniture rule changed in one place: backgrounds are
    skipped as boxes over 95 % of the page (they bleed past it), so the Burning Heart of the Woods' full-page art (about
    92 %) is kept.
  - Most pages paint ONE image showing two environments side by side, each part with its own caption. `CROPS` gives each
    such caption its part of the image (fractions of the image), each checked on the rendered page and on the cut result.
    A caption whose image is near another caption and has no `CROPS` entry fails the run, so no environment silently gets
    the other one's picture (the plain nearest-image pairing gave the whole HF p.100 image to Cursed Graveyard and the
    whole HF p.107 image to Astral Realm).
  - Output as AA1: RGBA kept, transparent edges trimmed, WebP at most 900 px wide, quality 80, into
    `public/environment-art/<id>.webp` (regenerated each run).
- `src/lib/srd/environment-art.ts` (generated): `ENVIRONMENT_ART` (id -> `{ src, width, height, credit }`, the
  `AdversaryArt` shape, credit "CB p.N" / "HF p.N"), `ENVIRONMENT_ART_COUNT` per book, `environmentArt(id)`.
- `stat-block.tsx`: the art under the name in the adversary stat block's frame (`adc-sb-art` from catalogue.css: the whole
  picture, `object-fit: contain`, `max-height: 340px`, never wider than its file, centred in a padded frame), alt
  "<name> illustration", the credit in the figure's `title`. EF1's `top` (GM Fear bar) and `renderFeatureActions` are
  unchanged.
- `index.tsx`: the 32 px round thumbnail (`adc-thumb`, decorative `alt=""`) before the name in list rows with art.
- No new CSS: both classes come from catalogue.css, which environments.css imports.

## Assigned: 29 (Core 13, Hope & Fear 16), 2.92 MB
Core: Cliffside Ascent, Local Tavern, Outpost Town, Raging River, Cult Ritual, Hallowed Temple, Haunted City, Mountain
Pass, Burning Heart of the Woods, Castle Siege, Pitched Battle, Chaos Realm, Necromancer's Ossuary.
Hope & Fear: Abandoned Mine (on the HF p.98 list page, captioned), Alchemist's Abandoned Workshop, Corrupted Swamp,
Cursed Graveyard, Hold the Line, Local Festival, Deadly Dungeon, Heist, Masquerade Ball, Witch's Hut, Archmage's Tower,
Astral Realm, Crystal Wasteland, Sunken Citadel, Volcanic Eruption, Realm of the Dead.

## Judgement calls (checked on the rendered pages)
- Shared images cut per caption (`CROPS`): CB p.244 cliff (left) / tavern (right; the cliff stays behind it, the
  cliff's cut stops before the tavern porch); CB p.245 town (upper left) / river and waterfall (right); CB p.246 green
  ritual (left) / temple with the winged statue (right); CB p.247 ruined city (left) / icy cliffs (right); CB p.249 castle
  walls and siege engines (left) / the red army on the field (right, lower part); HF p.100 blood-red swamp trees (left) /
  graveyard and chapel (right); HF p.107 the tower (left) / the blue astral sea (right).
- Least certain: Mountain Pass. The "MOUNTAIN PASS" caption sits at the right end of the Haunted City painting; that end
  shows icy cliffs and ledges, no clear path. Removing it is one `CROPS` line.
- Burning Heart of the Woods (CB p.248): the art is transparent behind the stat block, so only the tree's right part
  (from 47 %) is kept. It is tall (900x2173), so it shows small and whole at 340 px high.

## Left out (no guess)
- CB p.242 list page: twisted trees at the bottom, uncaptioned (maybe Abandoned Grove, not beside its block).
- All other environments: their pages have no illustration of them (e.g. HF p.111 has only an edge sliver).

## Acceptance evidence
- `tests/unit/environment-art.test.ts` (6 tests): 29 ids, all real environments, `src` matches the id; every mapped file
  exists and every file is mapped; width 1-900, height set; per-book counts equal `ENVIRONMENT_ART_COUNT`; credit
  "CB/HF p.N" on the block's page or the list page just before it; total under 5 MB; `environmentArt` for art / none /
  undefined.
- `tests/e2e/visual/EA1.spec.ts` (`E2E_VISUAL=1`): stat block without art (Abandoned Grove, no `.adc-sb-art`), list with
  thumbnails, Cult Ritual with art (credit "CB p.246"), Burning Heart of the Woods at most 340 px high with its aspect
  ratio kept, no horizontal scroll; shots at 1440 and 390 in `test-results/visual/EA1/`.
