# TASK-SP-P5: Server side - map style, setting, sprite sources for GM and players, traits in server vision

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P5 (wave 2; depends on P0, P1, P3). Bead: `dcm-bxp.56`.
Rebased on `rebuild` 27ec6d5 (adversary art helper).

## Decisions this tracer implements
- P3 "each map is drawn in "Classic" ... or "Sprites", chosen per map by the GM ... switching is one click" → `setStyle`.
- P1 "The Scene card gets a Setting picker ..., defaulting to "Let Claude choose"" → `setSetting` (null = let Claude
  choose) and `settings`.
- D1 "`setStyle` writes only the map's `style` field" (plus, on a first switch to Sprites, the D7 resolution).
- D7 "Maps without a setting ... resolve it at paint time with the keyword picker on the map's prompt and name, else
  grassland-and-road; switching to Sprites stores that resolution."
- D3 / Q1 / D4 → server vision reads sprite traits and `rot` (ORCHESTRATOR NOTE: "P5 passes resolved traits and `rot`
  on every object given to prepareMap").
- D9 "Deleting an uploaded sprite or pack leaves objects that referenced it in place; they resolve to their Classic kind".
- D10 "Players get exactly what they got before plus the sprite URLs needed to draw the live map; pack lists, labels and
  the upload screen are GM-only."
- Q3 = (c) packs are their own setting or extend a built-in one. Q4 = (a) new maps stay Classic (no `style` written).
- Coordinator extra (2026-10-21): adversary tokens in `playerView` / `previewAs` carry their rulebook art.

## Public functions (`convex/combatMapStyle.ts`)
| Function | Wrapper | Args | Returns |
| --- | --- | --- | --- |
| `setStyle` | gmMutation | `campaignId, mapId: string, style: "classic" \| "sprites"` | `null` |
| `setSetting` | gmMutation | `campaignId, mapId: string, setting: {builtin: string} \| {pack: Id<"spritePacks">} \| null` | `null` |
| `settings` | gmQuery | `campaignId` | `{builtin: {id, label}[], packs: {_id, name, extends: {id, label} \| null}[]}` |
| `spriteSources` | campaignQuery (view, enough owner) | `campaignId, mapId: string` | GM `{view: "gm", mapId, style, setting, settingPicked, sprites: GmSprite[]}` \| player `{view: "player", mapId, style, setting, sprites: PlayerSprite[]}` |

- `PlayerSprite` = `{_id, category, w, h, sight, light, height, footprint, classicKind, classicVariant?, terrain?,
  rotatable?, px, url: string | null}`; `GmSprite` adds `name, packId`. `url` comes from the sprite's `files` row
  (kind "sprite", refId = the sprite, same campaign; CF17); null when the file is gone.
- `setStyle`: no-op when nothing changes; switching to Sprites with no stored setting stores
  `{builtin: pickSetting(prompt, name)}` with `settingPicked: false`. Never touches objects, areas or cells (tested).
- `setSetting`: built-in must be one of the 19 settings (`common` and unknown ids → SPRITE_SETTING_UNKNOWN); a pack must
  exist in this campaign (SPRITE_PACK_NOT_FOUND). `null` stores the keyword pick with `settingPicked: false`, so the
  map draws at once and P7 knows Claude may choose.
- `settings`: packs sorted by name; `extends` null for own-setting packs and for an `extends` that is not a built-in id.
- `spriteSources`: GM may read any campaign map; a player only the live map (else COMBAT_MAP_NOT_FOUND). Setting =
  stored when it still resolves, else the keyword pick (a deleted pack falls back; `settingPicked` false then). GM
  sprites = every uploaded ref on the map (objects, area textures, texture palette) + the setting's packs (a pack
  setting: that pack; a built-in setting: the packs extending it). Player sprites = only the referenced ones, without
  names or packs.

## Helpers
- `convex/lib/spriteSources.ts`: `visionTraitsOf(SpriteTraits): VisionTraits` (the compile-time assignability check),
  `MAX_MAP_SPRITE_REFS` (= MAX_COMBAT_OBJECTS + MAX_COMBAT_AREAS + MAX_TEXTURE_PALETTE; the plan said objects + palette,
  area textures can be uploaded refs too), `resolveRefs(ctx, campaignId, refs)` (one `get` per distinct uploaded id,
  foreign / deleted → absent), `objectTraits`, `loadObjectTraits`, `mapSpriteRefs`, `keywordSetting`,
  `resolveSetting`, `playerSpriteOf` / `gmSpriteOf` and their validators.
- `convex/lib/combatVision.ts`: `visionObjects(ctx, campaignId, objects)` builds `{kind, x, y, r, rot, sight, lit,
  traits}` per object; `loadScene` passes it to `prepareMap`, so `playerView`, `previewAs` and toggleLight's
  `hasSeen` follow the manifest. Objects without a sprite get `traits: null` → the old code path (E5).
- `otherTokenValidator` gains `portrait?: {kind: "url", url} | null`; adversary rows get `adversaryArtSrc`'s URL when
  the adversary has art, otherwise the key is absent (custom tokens never have it), so rows without art keep the D9
  shape and `tests/convex/combat-vision.test.ts`'s R4 key check stays green.

## Acceptance evidence
- `tests/convex/combat-map-style.test.ts` (9 tests): access rows for setStyle / setSetting / settings (anonymous
  UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok) and spriteSources (player ok on the live map,
  COMBAT_MAP_NOT_FOUND on a hidden map, bad and foreign ids); Q4 default, D7 keyword store on first switch, GM pick
  kept, D1 no row writes; setSetting built-in / pack / null and its refusals; settings (Q3); GM vs player sprites
  (D10: no labels, no unplaced sprites), deleted setting pack, deleted / foreign / fileless sprites.
- `tests/convex/combat-vision-sprites.test.ts` (7 tests): assignability check; a sprite wall section (rect 2 x 1,
  r 2) hides a token when upright and not when lying flat (rot); a sprite pool lets sight pass on a blocking Classic
  kind; a deleted uploaded sprite and an unknown built-in key fall back to the Classic kind; built-in and uploaded
  faint glows light a token at night, switched off they do not, a dark sprite on a Classic campfire gives no light,
  previewAs equals playerView; adversary art for players (art URL, absent without art and on custom tokens, no stats).
- Budget (300 sprite objects, half built-in, half over 64 uploaded rows, 10 enemies; convex-test, whole call):
  playerView day 60 ms / night 16 ms, 351 documents, 84 KB; spriteSources GM 8 ms, 368 documents, 85 KB; player
  8 ms, 369 documents, 85 KB. Asserted < 500 ms, < 600 documents, < 512 KB. The engine itself stays within C1's
  50 ms (P3 measured 1 ms median with 300 sprite objects).
- `pnpm lint` 0 problems, `pnpm typecheck` clean, `pnpm test` 158 files / 1899 tests passed; pushed to the local
  backend with `--typecheck=enable`.

## Outside this tracer (exact diff for `convex/combatVision.ts`, owned by P0)
`toggleLight` still uses `objectLightTraits`, which reads only uploaded rows, so a built-in faint-glow sprite on a
non-light Classic kind (e.g. `dungeon/candle-cluster` on `crystal`) is refused with INVALID while server vision lights
it. Replace it with `loadObjectTraits` (verified in this worktree: a built-in candle toggles, a pool on a campfire is
refused, sprite-fields and combat-vision suites pass):

```diff
@@ import {
   pointLevel,
   visibleSquares,
-  type LightTrait,
 } from "../src/lib/domain/combat-map/index";
@@
 import { campaignMutation, campaignQuery, gmMutation, gmQuery } from "./lib/functions";
+import { loadObjectTraits } from "./lib/spriteSources";
 import { atLeast, permissionFor, type Permission } from "./lib/permissions";
@@ export const toggleLight = campaignMutation({
-    const traits = await objectLightTraits(ctx, object);
+    const traits = await loadObjectTraits(ctx, ctx.campaign._id, object);
@@
-/** ...objectLightTraits doc comment... */
-async function objectLightTraits(ctx: QueryCtx & { campaign: Doc<"campaigns"> }, object: Doc<"combatMapObjects">): Promise<{ light: LightTrait } | null> {
-  if (object.sprite === undefined || !("uploaded" in object.sprite)) return null;
-  const sprite = await ctx.db.get("spritePackSprites", object.sprite.uploaded);
-  return sprite !== null && sprite.campaignId === ctx.campaign._id ? { light: sprite.light } : null;
-}
```

## Notes for P6-P9
- P6: `spriteSources` gives `style`, the resolved `setting` (draw with it even when the map row has none) and uploaded
  sprite URLs; built-in files come from the static manifest. Optimistic update for `setStyle`: patch `style` in
  `combatMaps.get` / `spriteSources`.
- P7: `setSetting(null)` stores the keyword pick with `settingPicked: false`; treat `settingPicked !== true` as "Let
  Claude choose". `keywordSetting` / `resolveSetting` are in `convex/lib/spriteSources.ts`.
- P8: `settings` lists packs with `extends`; a pack used as a setting is accepted even when it extends a built-in one
  (spriteSources then lists only that pack's sprites).
- P9: client `isSwitchableLight` should match the toggleLight diff above (catalog traits for built-in sprites).

## QUESTIONS
1. `setSetting(null)` stores the keyword-picked setting (`settingPicked: false`) instead of clearing the field, so a
   Sprites map always has a setting to draw. Clearing it instead is a one-line change.
2. Adversary `portrait` is omitted (not `null`) when there is no art, to keep the existing R4 key test unchanged.
