# TASK-SP-P8: GM upload and labelling screen for custom sheets and single sprites

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P8 (wave 3; depends on P2, P5). Bead: `dcm-bxp.56`.
Based on `rebuild` ad3b7b6.

## Decisions this tracer implements
- P2 "GMs can ALSO upload their own sheets or single sprites per campaign (files table, image allowlist, size caps),
  cut and labelled in an upload screen (name / kind, size in squares, blocks sight / cover / none, gives light)."
- D9 "Uploaded sprites are cut in the browser (the same pure cut core as the offline script, on canvas ImageData);
  only the cut, re-encoded sprites are uploaded (WebP, PNG where the browser cannot encode WebP), never the sheet.
  Each sprite is one `files` row (kind "sprite") claimed by its `spritePackSprites` row. Deleting an uploaded sprite
  or pack leaves objects that referenced it in place; they resolve to their Classic kind."
- Q3 = (c) "the GM chooses per pack: New setting or Add to <built-in setting>". Q1 = (b): light none / faint glow /
  torch / campfire. D2: the Classic fallback lights like the sprite. D10: everything here is GM-only. E7 / CF16 /
  CF17: checked uploads, rejected files deleted and `{ok: false, code}` returned, a storage id is never proof.

## Public functions (`convex/spritePacks.ts`)
| Function | Wrapper | Args (besides `campaignId`) | Returns |
| --- | --- | --- | --- |
| `packs` | gmQuery | - | `PackRow[]` (oldest first): `_id, name, extends: {id, label} \| null, createdAt, sprites: GmSprite + slug, order` |
| `createPack` | keyedGmMutation | `name, extends?` (built-in setting id) | `{packId}` |
| `renamePack` | gmMutation | `packId, name` | `null` |
| `setPackExtends` | gmMutation | `packId, extends: string \| null` | `null` |
| `deletePack` | gmMutation | `packId` | `null` |
| `spriteUploadUrl` | gmMutation, rate limit `spriteUpload` | - | upload URL |
| `attachSprite` | gmMutation | `packId, storageId, name, category, w, h, sight, light, height, footprint, classicKind, terrain?, rotatable?, px` | `{ok: true, spriteId} \| {ok: false, code: "INVALID" \| "SPRITE_LIMIT", message}` |
| `updateSprite` | gmMutation | `spriteId, patch` = exactly one of name, category, w, h, sight, light, height, footprint, classicKind, terrain, rotatable (a union of one-key objects) | `null` |
| `removeSprite` | gmMutation | `spriteId` | `null` |
| `reorderSprite` | gmMutation | `spriteId, direction: "up" \| "down"` | `null` |

Rules in the handlers:
- Names 1..60 characters after trimming (INVALID). `extends` must be one of the 19 settings (`common` and unknown
  ids: SPRITE_SETTING_UNKNOWN). At most 20 packs (`.take(21)`, SPRITE_PACK_LIMIT). Unknown / foreign pack:
  SPRITE_PACK_NOT_FOUND; unknown / foreign sprite: SPRITE_NOT_FOUND.
- `attachSprite` order: pack (thrown), labels (thrown INVALID: sizes 1..4 integers, a texture needs a terrain, D2
  Classic look), file unclaimed and present (thrown NOT_FOUND, file kept), then the returned rejections that delete
  the file: type not png/jpeg/webp/gif or over 1 MB (INVALID), pixel size outside 1..1024 (INVALID), pack full at 64
  (SPRITE_LIMIT). Then `claimFile` (kind "sprite", refId "pending"), insert the sprite (unique slug in the pack,
  order = max + 1; textures store terrain and rotatable, default true), patch the files row's refId, all in one
  mutation (the P0 note).
- `updateSprite`: a new name re-slugs; a new light moves the Classic look to one that lights the same way (D2:
  torch → torch, campfire → campfire, faint glow / none off a light kind → the suggestion); a Classic look that would
  light differently is INVALID; switching to texture fills terrain (grass) and rotatable (true).
- `deletePack` / `removeSprite` delete the sprite rows and their `files` rows + blobs (`deleteFilesOf`). Map
  objects keep their `sprite` ref; P5's `spriteSources` and vision then resolve them to their Classic kind (D9).

## Client (`src/components/combat-map/packs/`)
- `index.tsx`: `PacksLink` (unchanged) and `PacksScreen`: New pack card (name, Setting "New setting" / "Add to
  <setting>", Create pack via `useIntent`), then one card per pack; the "Your packs" empty state stays.
- `pack-card.tsx`: pack name (saves on blur / Enter), Setting select, two-click Delete pack (3 s, as the maps list),
  "＋ Add sprites" (open by default while the pack is empty), and the saved sprites: thumbnail, name, every label
  saved per field, ↑ / ↓, two-click Delete.
- `uploader.tsx`: drop zone + "Choose images…" (several files allowed), "Sheet layout" Auto / Props 4 × 4 / Large
  3 × 3 / Terrain 2 × 2 / Single sprite (changing it re-cuts the loaded images), cut notes (count mismatch, border
  touch, removed lines, terrain flags), labelling grid (checkbox, name, Object / Terrain texture, width and height
  1..4, Blocks sight / Cover / None, Gives light None / Faint glow / Torch / Campfire, Shadow Flat / Low / Tall,
  Classic look auto-suggested from size, sight and light until the GM picks one; Terrain for textures), Select all /
  none, "Upload selected (n)" with per-row Uploading… / Uploaded / error. The room left in the pack and the names
  are checked before uploading. Footprint at upload: round for w = h, rectangle otherwise (editable later).
- `browser-image.ts`: `readSheet` (png/jpeg/webp/gif, at most 20 MB and 4096 px per side, `createImageBitmap` →
  canvas `ImageData`), `thumbnail`, `encodeSprite` (scale down to 160 px per square for objects or 512 px for
  textures, never over 1024; WebP 0.9, then 0.75; PNG when the browser cannot encode WebP; error over 1 MB).
- `cut-files.ts` (pure): runs P2's `cutSheet` / `cutTerrain` (+ `seamFix` on each swatch, D6) per image; Auto =
  props when the count matches, else large when it matches, else single (terrain is never guessed).
- `labels.ts` (pure, shared with the server): layouts, limits, `classicFits` (D2), `suggestClassic`,
  `classicAfterLight`, `defaultLabels`, `cleanName`, `slugOf`, `uniqueSlug`.
- `use-packs.ts`: optimistic updates on `spritePacks.packs` for rename, setting, delete pack, every label edit
  (mirroring the server's D2 rule), delete sprite and reorder (CL4: `getQuery` checked, rows copied).
- `fields.tsx`: `SpriteFields` (labelled selects) and `BlurText` (local text only while focused, CL7; Escape cancels).
- `packs.css`: `cm-pk-*` only; 390 px: one column, 44 px inputs, buttons and move arrows.

## Acceptance evidence
- `tests/convex/sprite-packs.test.ts` (17 tests): every function for anonymous UNAUTHENTICATED, outsider NOT_FOUND,
  player FORBIDDEN, GM ok; another campaign's pack / sprite and bad ids; createPack (Q3, idempotent replay, the
  Setting picker's `settings` lists both packs), names / settings / the 20-pack cap; rename and extends; deletePack
  removes sprites, files and blobs while an object keeps its ref and `spriteSources` drops it (D9); attach claims as
  kind sprite with refId, unique slugs, order, texture defaults; SVG, text, over 1 MB, over 1024 px and 0 px files
  deleted with `{ok: false, code: "INVALID"}`; a claimed file NOT_FOUND and kept; bad labels INVALID before the file;
  SPRITE_LIMIT at 64 with the file deleted; a pack added to Forest feeds a forest map's `spriteSources` (labelled
  for the GM, nothing for the player); one field per update (two fields refused by the validator); D2 on light and
  Classic look; remove and reorder; the label helpers.
- `tests/e2e/sprite-packs-upload.spec.ts` (4 tests, committed fixture `tests/fixtures/sprite-uploads/props-4x4.png`,
  8 KB): the GM creates "Moorland" added to Forest in the UI, drops the 4 x 4 sheet (16 cuts, "read as Props 4 × 4"),
  labels cut 1 "Standing stone" 1 x 1 Blocks sight (Classic look Pillar) and uploads it; it shows in the pack;
  `settings` lists the pack under Forest; a forest map's `spriteSources` has it with w 1, h 1, block and a URL; a
  Shadow edit and a two-click delete are polled on the server. An SVG renamed .png: the browser cannot decode it,
  shows an alert and uploads nothing; posted straight to the server as image/svg+xml it is refused
  (`ok: false, INVALID`) and deleted (a second attach gets NOT_FOUND). A player is sent back from the URL and gets
  FORBIDDEN from `packs` and `spriteUploadUrl`. At 390 px with 16 cuts (forced Large 3 × 3, count note shown) there
  is no horizontal scroll. `tests/e2e/sprite-packs-shell.spec.ts` (P0, 3 tests) still passes.
- `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 167 files / 2166 tests passed; pushed to the local
  backend with `--typecheck=enable`.

## Visual (`tests/e2e/visual/SP-P8.spec.ts`, E2E_VISUAL=1)
Shots in `test-results/visual/SP-P8/`: `labelling-{1440,1024,390}.png` (the cut sheet in the grid, three cuts
labelled) and `saved-{1440,1024,390}.png` (a pack with three saved sprites). There is no design board for sprites;
the counterparts are the Combat Map's own cards (same `cm-card`, `cm-btn`, `cm-go`, `cm-in` look) and the P4
contact sheets (the checkerboard behind each thumbnail). Verdict: matches the Combat Map's look at all three
sizes; no horizontal scroll at 390. Deliberate deviations: the labelling grid uses selects (not segmented buttons)
so nine labels fit one card; the screen has a single column (no map), as P0's shell.

## Notes for later tracers
- P9: uploaded sprites come with `spriteSources` (P5); `packs` lists every pack for a picker if needed.
- P7: packs created here appear in `combatMapStyle.settings` at once.

## QUESTIONS
1. An SVG renamed .png and uploaded with `Content-Type: image/png` would pass the server check (mutations cannot
   read file bytes; the check is on the recorded type, as `attachImage`). The screen never uploads such a file (the
   browser cannot decode it, and only re-encoded canvas output is uploaded), and storage serves it as image/png, so
   it never runs as SVG. Sniffing bytes would need an action; say if you want that.
2. `attachSprite` past 64 sprites deletes the file and *returns* `{ok: false, code: "SPRITE_LIMIT"}` (E7: a rejected
   file is deleted) rather than throwing; the screen also checks the room before uploading.
3. Label errors in `attachSprite` (bad name, size, D2 mismatch) are thrown before the file is touched; the unclaimed
   file is then removed by the existing orphan sweep. Deleting it there too is a one-line change.
4. `packs` reads at most 20 packs x 64 sprites + their files (about 2,600 documents) in one query; fine for the cap,
   but a per-pack query would be cheaper if packs grow.
