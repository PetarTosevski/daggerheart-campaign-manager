# TASK-SP-P7: Setting picker on the Scene card; Claude and the keyword fallback lay out sprite maps

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P7 (wave 3; depends on P4, P5). Bead: `dcm-bxp.56`.
Branched from `rebuild` 0b062ee (P4).

## Decisions this tracer implements
- P1 "The Scene card gets a Setting picker (forest, tavern, dungeon, ... from the packs), defaulting to "Let Claude
  choose", in which case Claude picks the setting from the description."
- Earlier brief: "Claude's layout prompt gets the chosen setting's kinds; the keyword fallback also works with packs."
- Q2 = (a) "two calls: a short classification call (description + the setting names ...) picks the setting, then the
  layout call gets only that setting's and common's kinds; the rate limit counts the pair as one generation".
- Q3 = (c) packs are a setting of their own or add to a built-in one; D1 (objects keep a Classic kind), D7 (a map
  stores its resolved `setting` and `settingPicked`), E6 (Classic `scenePrompt` and keyword layout unchanged).
- User goal (orchestrator brief 2026-10-21): generated maps should match the chosen setting (village, dungeon, tavern,
  ship...), not default to forest.

## Public functions
No new public function. `combatMapGenerate.generate` (userAction, GM via the internal access check, rate limit
`combatMapGenerate`) gains an optional argument:

| Arg | Type | Meaning |
| --- | --- | --- |
| `setting` | `{builtin: string} \| {pack: Id<"spritePacks">}` (optional) | the GM's pick; absent = "Let Claude choose" |

Its result is unchanged (`{mapId, saved, drawnBy, claude, reason?}`); the resolved setting is read from the map
(`combatMaps.get` returns `setting` and, for the GM, `settingPicked`). New internal functions: `context` (widened:
style, name, packs; validates a picked setting), `packSprites` (uploaded sprites of the setting's packs), `save`
(widened: `setting`, `settingPicked`; objects may carry `sprite`, areas `texture`).

Errors: a picked built-in id that is not one of the 19 settings (or `common`) → `SPRITE_SETTING_UNKNOWN`; a pack that
is not this campaign's → `SPRITE_PACK_NOT_FOUND` (both P0 codes, as `setSetting`).

## How a generation runs
1. Setting: the GM's pick; else, on a **Sprites** map with an API key, one classification call
   (`settingPrompt`: the 19 built-in settings as `id = Label` and the campaign's own-setting packs as `pack-N = Name`,
   `max_tokens` 40) parsed by `parseSetting` (exact id, else the longest id in the text); else the keyword picker
   (`pickSetting(description, map name)`).
2. Layout with Claude:
   - Classic map: `scenePrompt` word for word (E6). If the GM picked a setting, the scene reads
     `<description>\nSetting: <Label>.`; with "Let Claude choose" the prompt is byte-for-byte today's.
   - Sprites map: `spritePrompt` (src/lib/sprite-packs/sprite-layout.ts) lists the setting's and common's objects as
     `key (name; WxH; blocks sight|cover|flat)`, the textures as `key (name; paints <terrain>)` and the uploaded
     sprites of the setting as `custom/<slug>` (own pack, or every pack that adds to the built-in setting, Q3). Reply:
     objects `{sprite, x, y, rot, scale}`, areas `{terrain, texture?, shape...}`. `cleanSpriteLayout` drops unknown
     sprites and textures used as objects, caps at 300 objects / 60 areas, clamps numbers through C1's `clean()`,
     sets `r = scale x max(w, h) / 2` (scale 0.5..2), fills each object's Classic kind and variant from the catalog or
     the uploaded row (D1) and gives a textured area the texture's terrain class.
3. Without a key, on a failed call or an unusable reply: the keyword layout as today. When the setting was picked or
   the map is Sprites, the description gets the setting's layout hint (`SETTING_LAYOUT_HINT`, e.g. tavern → "hall
   room", ship-deck → "ship", snow → "snow") so the keyword layout takes the right branch; on a Sprites map
   `spriteFallback` maps it with P1's tables (objects → `pickSprite`, areas → a texture of their terrain), scatters
   0-6 of the setting's own 1 x 1 flat or cover props on open squares (seeded) and titles it with the setting label.
   The card's message line is the board's copy as today ("Drawn from keywords ...", "Claude couldn't draw this one").
4. `save` writes the layout plus `setting` and `settingPicked` (true only for a GM pick). Style is never written here.

The classification pair is one `generate` call, so one `combatMapGenerate` use (tested: 10 generations = 20 calls,
the 11th is RATE_LIMITED). A failed classification skips the layout call (keyword layout, `claude: "failed"`).

## Scene card
- `src/components/combat-map/generate/setting-select.tsx`: "Setting" select under the description, in both styles.
  Options: "Let Claude choose" first, then the 19 settings sorted by label ("Settings" group), then the campaign's packs
  ("Your packs": own settings by name, extensions as "Name (adds to Forest)").
- After a generation Claude or the keywords chose, the first option reads "Let Claude choose (chose: Forest)".
- On a map, a change calls `combatMapStyle.setSetting` with an optimistic update of `combatMaps.get` (setting,
  settingPicked); before the first map exists the pick is kept by the card and passed to the first generation.
- Generate sends `setting` only when the map's setting was picked (or the pending pick before a map).
- 390 px: the select is full width with a 44 px touch target; the card stays inside the column (no horizontal scroll).

## Tests
- `tests/convex/combat-map-generate-sprites.test.ts` (fetch stubbed, no real API call): roles (anonymous
  UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok); Let Claude choose runs two calls (classification then
  sprite layout) and saves `settingPicked: false`; a picked setting runs one call; variation line; a Classic map gets
  `scenePrompt` exactly and stores the keyword pick (and a picked setting adds `Setting: <Label>.`); an answer naming no
  setting → keyword pick, still Claude's layout; a failed classification → keyword layout, one call; an unusable sprite
  reply → sprite fallback; without a key, forest / tavern / snow / village market / dungeon / pirate ship descriptions
  give sprite layouts whose refs are only that setting's and common's (no forest trees elsewhere); a picked Tavern on a
  forest description gives no trees; own-setting packs in the classification and uploaded sprites in the layout
  prompt, stored as `{uploaded: id}`; SPRITE_SETTING_UNKNOWN / SPRITE_PACK_NOT_FOUND; the pair counts as one use;
  `parseSetting` cases.
- `tests/unit/sprite-layout.test.ts`: palette contents and uploaded tokens; prompt lines; cleaner drops, caps and
  clamps; fallback determinism per seed, 0..6 props on open squares from the setting's own props, a tavern keeps no
  trees, a pack setting maps through common.
- `tests/convex/combat-map-generate.test.ts` passes unchanged (E6).
- e2e `tests/e2e/sprite-generate.spec.ts` at 1440 and 390: the GM picks Tavern (optimistic, then the server is polled),
  regenerates a Sprites map (fallback) whose refs are tavern / common and has no trees; Let Claude choose on "a frozen
  lake ambush" resolves to snow-and-tundra and the select says "(chose: Snow and tundra)".
- Visual `tests/e2e/visual/SP-P7.spec.ts` (E2E_VISUAL=1): shots in `test-results/visual/SP-P7/`.

## Visual verdict
There is no board for sprites. Counterpart: the C4 Scene card (`test-results/visual/C4/scene-*.png`).

| Region | Shot | Verdict |
| --- | --- | --- |
| Scene card, no map | `scene-empty-{1440,1024,390}.png` | Matches C4 plus one labelled select between the description and the size buttons, in the card's field style (`cm-in`). |
| After Let Claude choose | `scene-claude-chose-{1440,1024,390}.png` | First option reads "Let Claude choose (chose: Snow and tundra)". |
| Tavern picked, Sprites map | `scene-tavern-*.png`, `gm-edit-tavern-*.png` | Select shows Tavern; the map still draws Classic until P6's painter lands (deliberate: P6 owns the painter). |

Deliberate deviations: the canvas cannot show sprites yet (P6), so the e2e checks the tavern sprites on the server's
map rows; the Sprites style is switched through `setStyle` because the StyleSwitch slot is P6's.

## Questions
- Q2 says Classic maps run the classification call too. `tests/convex/combat-map-generate.test.ts` must pass unchanged
  and asserts exactly one Messages API call for a Classic map without a pick, so Classic maps take the keyword picker's
  setting instead (no extra call). Should Classic maps also classify (that test would then expect two calls)?
- A setting the GM picks for a Classic map is named in the scene (`Setting: Tavern.`) and steers the keyword layout,
  so a picked setting changes Classic layouts too; "Let Claude choose" on Classic is exactly today's. Keep?
- The keyword fallback stores sprite and texture refs on the objects and areas it maps (so the layout is explicit and
  testable); D7's "changing the setting re-maps only objects without a ref" then keeps them. Prefer refs-free mapping at
  paint time instead?
