# TASK-SP-P0: Sprite-packs foundation

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P0 (wave 1, foundation, no dependencies). Bead: `dcm-bxp.56`.
Rebased on `rebuild` 32ab37f (after P3 merged), so `toggleLight` uses P3's `givesLight`.

## Decisions this tracer implements
- P2 "GMs can ALSO upload their own sheets or single sprites per campaign (files table, image allowlist, size caps)" →
  the `spritePacks` / `spritePackSprites` tables, `files.kind` "sprite", the `spriteUpload` rate limit and the caps.
- P3 "each map is drawn in "Classic" … or "Sprites", chosen per map by the GM" → `combatMaps.style` (absent = classic, Q4).
- D1 (one layout serves both styles) → optional `sprite` on objects, `texture` on areas; `kind` / `terrain` stay.
- D7 → `combatMaps.setting` + `settingPicked`. Q3 = (c) → `spritePacks.extends?`. Q1 = (b) → light
  `"none" | "faintglow" | "torch" | "campfire"` (spelling agreed across tracers). Q5 = (a) → `sharp` devDependency.
- E3 / E4 / E8 → widen only; existing reads return the new fields; `duplicate` copies them.

## What was built
- **Validators** (`convex/lib/validators/combatMaps.ts`): `spriteRefValidator` = `{builtin: string}` (catalog key
  `<setting>/<slug>`, D8) | `{uploaded: Id<"spritePackSprites">}`; `settingRefValidator` = `{builtin: string}` |
  `{pack: Id<"spritePacks">}`; `mapStyleValidator` ("classic" | "sprites"; `MAP_STYLES`). `combatMapFields` gain
  `style?`, `setting?`, `settingPicked?`, `texturePalette?` (array of spriteRef). `combatAreaValidator` gains
  `texture?`. `combatObjectFields` gain `sprite?`. `CELL_LAYERS` gains `"texture"`; `TEXTURE_CODES = "ABCDEFGHIJKLMNOP"`
  (code i = `texturePalette[i]`, "." none; uppercase so it never reads as terrain / block / fog). schemaVersion stays 1.
- **Tables** (`convex/tables/spritePacks.ts`, validators in `convex/lib/validators/spritePacks.ts`):
  - `spritePacks` {campaignId, name, extends? (built-in setting id; absent = own setting), createdBy, createdAt,
    updatedAt}; index `by_campaign_updated`.
  - `spritePackSprites` {campaignId, packId, fileId (files row, kind "sprite"), name, slug, category object|texture,
    w, h (squares), sight block|cover|none, light none|faintglow|torch|campfire, height flat|low|tall, footprint
    circle|rect, classicKind (one of the 22), classicVariant?, terrain? (one of the 14), rotatable?, px {w, h},
    order, createdAt}; indexes `by_pack_order` [packId, order], `by_campaign`.
  - Caps: MAX_SPRITE_PACKS 20, MAX_PACK_SPRITES 64, MAX_TEXTURE_PALETTE 16, MAX_SPRITE_BYTES 1 MB, MAX_SPRITE_PX 1024,
    MAX_PACK_NAME / MAX_SPRITE_NAME 60, MIN/MAX_SPRITE_SQUARES 1..4.
- **files**: `kind` gains `"sprite"` (refId = the `spritePackSprites` id). `claimFile` now returns the new `files` id.
- **Errors** (`src/lib/errors/spritePacks.ts`, joined in `AppErrorCode` and `convex-errors`): SPRITE_PACK_NOT_FOUND,
  SPRITE_PACK_LIMIT, SPRITE_NOT_FOUND, SPRITE_LIMIT, SPRITE_UNKNOWN, SPRITE_SETTING_UNKNOWN, SPRITE_PALETTE_FULL.
  Upload rejections return `{ok: false, code: "INVALID"}` as `attachImage` does (CF16).
- **Rate limit**: `spriteUpload` token bucket 200 / hour, capacity 64.
- **Reads** (`convex/combatMaps.ts`): `get` and `live` return `style`, `setting`, `texturePalette`, area `texture`,
  object `sprite`, and the texture layer's tiles as a separate optional `textureCells` [{tile, cells}]; `cells` keeps
  the D9 layers only, so every Classic reader stays unchanged. `settingPicked` goes to the GM only (like `prompt`, D10).
  `list` returns `style` and `setting` for the thumbnail. Absent fields stay absent (E3). `duplicate` spreads every
  stored field, so all new fields and texture cells are copied (E8, tested).
- **Vision** (`convex/combatVision.ts`): no return validator there echoes map or object rows, so none needed widening.
  `toggleLight` asks P3's `givesLight({kind, lit, traits})`: an uploaded sprite's `light` comes from its row
  (`objectLightTraits`); a built-in sprite's trait still comes from its Classic kind until P5 adds the catalog lookup.
- **cells.ts** (`src/components/combat-map/map-view/cells.ts`, added to P0's owns by the orchestrator): new
  `StoredCellTile` (layer may be "texture"); `decodeCells` takes it and decodes fog codes only on the fog layer, so
  texture tiles are ignored. `CellTile` / `CellLayer` are unchanged.
- **Purge** (`convex/cleanup.ts`): steps for `spritePackSprites` (by_campaign) and `spritePacks` (by_campaign_updated);
  sprite files go with the campaign's files step (blob included). schema-guard: both tables are CAMPAIGN_SCOPED.
- **Page and slots**: `slots.ts` documents `StyleSwitchProps` {campaignId, map} (P6), `PacksLinkProps` {campaignId}
  and `PacksScreenProps` {campaignId} (P8), plus `packsHref(campaignId)`. Stubs: `style/index.tsx` `StyleSwitch` →
  null; `packs/index.tsx` `PacksLink` (a `cm-btn` link "Sprite packs") and `PacksScreen` (empty-state card "Your
  packs"). The Combat Map page mounts `StyleSwitch` in the header (GM, map on screen) and `PacksLink` under the Maps
  card (GM), each in its own error boundary. Route `combat-map/packs/{page.tsx,error.tsx}`: GM header ("Sprite packs",
  "← Combat Map") + `PacksScreen` in a boundary; a player is `router.replace`d to the Combat Map (UX only, CF22).
- **Static files**: `next.config.ts` serves `/sprite-packs/:path*` with `public, max-age=31536000, immutable`.
- **Tooling**: `sharp` 0.35.5 devDependency, exact (see QUESTIONS 1). Scripts:
  `sprites:cut` = `node --import ./scripts/sprite-packs/ts-hooks.mjs scripts/sprite-packs/cut-sheets.ts`,
  `sprites:build` = the same with `build-pack.ts`. TypeScript runs on Node 24's built-in type stripping (no tsx,
  no tsconfig change). The source files import each other without extensions (CH6), which Node's ESM resolver refuses,
  so P4 adds `scripts/sprite-packs/ts-hooks.mjs`, a sync resolve hook (tested in this worktree on
  src/lib/domain/combat-map and sharp):

  ```js
  import { registerHooks } from "node:module";
  import { existsSync } from "node:fs";
  import { fileURLToPath } from "node:url";

  registerHooks({
    resolve(specifier, context, next) {
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.([cm]?[jt]s|json)$/.test(specifier) && context.parentURL?.startsWith("file:")) {
        for (const suffix of [".ts", "/index.ts"]) {
          const url = new URL(specifier + suffix, context.parentURL);
          if (existsSync(fileURLToPath(url))) return next(url.href, context);
        }
      }
      return next(specifier, context);
    },
  });
  ```
  Code the scripts import must be erasable TypeScript (no enums, no parameter properties, no namespaces).

## Notes for later tracers
- P5: `setStyle` / `setSetting` write the fields above. Wire built-in sprite traits into `objectLightTraits` in
  convex/combatVision.ts (or replace it with `spriteTraits` from P1) and pass traits into `prepareMap`.
  `textureCells` is in `get` / `live` already.
- P6: read `style`, `setting`, `texturePalette`, `textureCells`, area `texture`, object `sprite` from `combatMaps.get` /
  `live`; `list` rows carry `style` / `setting` for thumbnails. Fill `StyleSwitch` (props in slots.ts).
- P7: save `setting` + `settingPicked` with the layout.
- P8: `claimFile` returns the files id. `spritePackSprites.fileId` is required and the files row's `refId` must be
  the sprite id, so claim with a placeholder refId, insert the sprite, then patch the files row's `refId` (as
  tests/convex/cleanup.test.ts does), all in one mutation. Upload URLs use `rateLimit: "spriteUpload"`. Fill
  `PacksLink` / `PacksScreen`.
- P9: paint the "texture" layer with `TEXTURE_CODES[i]` and grow `texturePalette` (SPRITE_PALETTE_FULL past 16).
  The C5 optimistic updates read `layout.cells` (D9 layers); texture strokes update `layout.textureCells`.
  `edit-model.ts isSwitchableLight` should use `givesLight` (orchestrator note).

## Acceptance evidence
- `tests/convex/sprite-fields.test.ts` (12 tests): the widening (layer order, texture codes), decodeCells ignoring
  texture tiles, GM get / list / player live with every field (settingPicked and prompt hidden from players),
  playerView and previewAs on a sprite map with texture cells, a D9 row without the fields, access rows (anonymous,
  outsider, player, GM) for get / list / live / duplicate, duplicate copying every field (E8), toggleLight on sprite
  traits (faint glow on, light kind with "none" refused, Classic unchanged, deleted sprite falls back), error codes.
- `tests/convex/cleanup.test.ts`: the seed has a pack, a sprite, its sprite file and a sprite map; a new test checks
  the purge removes packs, sprites and sprite files with their blobs.
- `tests/e2e/sprite-packs-shell.spec.ts` (3 tests): the GM's link to the shell and back, 390 px without horizontal
  scroll, a player has no link and is sent back.

## QUESTIONS
1. Q5 says sharp 0.34.5, but the lockfile and node_modules have **0.35.5** (it comes with Next 16.4.1). The
   acceptance says "the version already in node_modules", so P0 pins 0.35.5 exactly. Nothing new was downloaded.
2. The plan lists `light` as none / torch / campfire. Q1 = (b) adds faint glow, so the stored union is
   none / faintglow / torch / campfire, the spelling the orchestrator set.
