# TASK-D9-C7: Vision on the server - player view, reveals, lights, explored areas, fog marks

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C7 (wave 4; depends on C1, C5, C6). Bead: `dcm-bxp.32`.

## Goal
A player's query returns only the tokens their character can see under the campaign's time and the map's lights,
without any adversary stats; the GM reveals dim tokens to a player, anyone switches a map light they can see, PCs
carry a light, explored areas are remembered, and the GM brushes fog.

## Rules this tracer implements
- **R8** "Day phases and Nautical Dawn = full vision in the cone. Dim phases are ONLY Nautical Twilight ... and
  Nightfall ...: full vision, tokens shown, a badge ..." → `light` (day | dim | night) from C1's `lightOf(phase)`.
- **R9** "Map lights are switched on/off by the GM AND by players (a player only for a light they can see or have
  seen)." → `toggleLight`; carried lights → `setCarriedLight`.
- **R10** "Dim light at night hides tokens (other than PCs, see Q4). ... on a success the GM reveals that token to that
  player ('Reveal to...')." → `revealTo` / `unrevealTo`; a revealed dim token comes with `revealed: true`.
- **R11** "Each player sees only their own character's view. Explored areas stay faintly visible, but tokens there are
  hidden unless the character can see them now." → `playerView`, `explored`, `markExplored`.
- **R12** "The GM sees everything, can preview any PC's view, and can reveal or hide areas by hand with a brush."
  → `previewAs`, `paintFog`. User 2026-10-20: the brush decides token visibility too ("reveal" squares are clear,
  tokens there show; "hide" squares are unseen, tokens there hidden), as C1 built it.
- **R4** "players never see an adversary's or NPC's HP, Stress, Difficulty or other stats" and the user's
  2026-10-20 decision: adversary / NPC / custom tokens carry only name + portrait/initials + size + side + face.
- **Q1** players get the whole layout from C3's `combatMaps.live`; TOKENS are filtered here.
- **Q3** "every token can carry a light ... the GM sets any token's light, a player only their own PC's. A carried
  light lights the area around its bearer for every viewer who can see that area."
- **Q4** "a player always sees the other PCs' tokens, but NOT what those PCs see"; user 2026-10-20: including their
  HP/Stress bars (every member reads every sheet).

No new book page is cited; the light radii and vision rules are C1's (its task doc quotes CB p.103, p.104, p.129).

## Public functions (`convex/combatVision.ts`)
Wrappers from `convex/lib/functions.ts`; authorization only through `permissionFor` (the wrappers, and the
character's `edit` permission for "own character", as C6's `move`). Every function has `args` and `returns`.

| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `playerView` | campaignQuery (view) | `characterId?: string` | `ViewResult` (below) |
| `previewAs` | gmQuery | `characterId: string`, `mapId?: string` (default: live) | `ViewResult`, exactly what the player gets |
| `explored` | campaignQuery (view, enough owner) | `characterId: string`, `mapId?: string` | `null` \| `{ mapId, characterId, length, bits }` |
| `markExplored` | campaignMutation (view, enough owner) | `mapId: string`, `characterId: string`, `bits: string` | `{ grew: boolean }` |
| `revealTo` | gmMutation | `tokenId: string`, `characterId: string` | null (idempotent) |
| `unrevealTo` | gmMutation | `tokenId: string`, `characterId: string` | null (idempotent) |
| `setCarriedLight` | campaignMutation (view, enough owner) | `tokenId: string`, `light: none\|torch\|lantern\|alistair` | null |
| `toggleLight` | campaignMutation (view, enough owner) | `objectId: string`, `lit: boolean` (the wanted state) | `{ lit }` |
| `paintFog` | gmMutation | `mapId: string`, `squares: number[]` (`y * w + x`), `mark: reveal\|hide\|erase` | null |

`ViewResult` = `{ state: "noMap" }` (no live map) | `{ state: "noCharacter", mapId }` (the character has no token on
the map) | `{ state: "ok", mapId, characterId, tokenId (own token), phase (string | null), light, instinct, coneDeg,
vision: { sw, sh, scale, seen, clear }, pcs: TokenView[], others: OtherToken[] }`.
- `pcs`: every PC token (C6's `TokenView`: portrait, HP/Stress/conditions, light; `mine` = the viewer's own token;
  `canMove` = the viewer's player's edit permission; never `revealedTo`).
- `others`: the non-PC tokens `tokenVisibility` allows: `{ _id, name, side, x, y, size, face, revealed }` only;
  `revealed` = in dim light at night, shown because the GM revealed it to this character (R10). Hidden ones are absent.
- `vision`: the character's current sight as two masks in C1's explored codec (`decodeExplored(text,
  exploredLength(w, h))`, `sw * sh` half-square samples): `seen` = dim or clear, `clear` = clear.

Access: anonymous UNAUTHENTICATED, outsider NOT_FOUND. GM functions: player FORBIDDEN. A player acts only for a
character they can edit (else COMBAT_NOT_YOUR_TOKEN) and only on the live map (else COMBAT_MAP_NOT_FOUND).
Errors: C0's COMBAT_MAP_NOT_FOUND, COMBAT_TOKEN_NOT_FOUND, COMBAT_OBJECT_NOT_FOUND, COMBAT_NOT_YOUR_TOKEN,
COMBAT_NO_CHARACTER (markExplored without a token), COMBAT_LIGHT_NOT_SEEN; common INVALID, NOT_FOUND. No new code.

## Details
- **One scene per call** (`convex/lib/combatVision.ts`): `loadScene` reads the map's objects (≤ 300), painted tiles
  (≤ 12, decoded with C3's `decodeCells`), tokens (≤ 80) and the campaign phase, and runs C1's `prepareMap` once;
  `viewOf` builds one `createView` per viewer (own token, Instinct from the sheet, every token's carried light, the
  GM's fog marks); `buildView` filters with `tokenVisibility` and shapes the rows.
- **Campaign time**: a Witherwild campaign's phase from its `campaignTime` row (no row = the initial time, Dawn);
  frames without campaign time get `phase: null` and are lit as by day (see QUESTIONS).
- **Picking the viewer**: `playerView` without `characterId` uses the first PC token on the live map whose
  character the caller owns; with it, any character the caller can edit.
- **Explored areas**: `markExplored` keeps only the delta's samples the character sees now (computed on the server),
  so a client cannot mark what it never saw; it merges into the stored row with C1's `mergeExplored` and writes only
  when `exploredGrows`. A row stored for another map size (an image map whose grid changed) reads as empty.
- **Lights**: `toggleLight` applies to C1's light objects (campfire, wall torch, brazier). A player passes when any
  character they can edit on the live map has the light's centre in view now (`pointLevel > 0`) or its sample in
  their explored row. C5's `updateObject.lit` stays as the GM's edit-card switch.
- **Fog marks**: one stroke writes only the touched fog tiles; an emptied tile is deleted (C5's tile helpers).

## Acceptance evidence
- `tests/convex/combat-vision.test.ts`: 13 tests. Access (anonymous / outsider / player / GM) on all 9 functions,
  own-character and live-map rules, bad and other campaigns' ids, `noMap` / `noCharacter`; a token behind a painted
  wall is absent and fog marks reveal / hide / erase; at night a torch-bearer's dim-band enemy is absent until
  `revealTo` (then `revealed: true`, for that character only), absent again after `unrevealTo`, and present
  during Nightfall (dim phase, not revealed); another PC is always present with its HP/Stress but an enemy only it
  sees is absent and outside the player's mask (Q4); an enemy's carried torch makes it and its surroundings clear for
  the player, and without it the enemy is absent (Q3); adversary and custom rows have exactly `_id, face, name,
  revealed, side, size, x, y` (no hp, stress, difficulty, conditions, light); `previewAs` equals `playerView`; a
  frame without campaign time is day; explored samples merge, keep only what is seen, write only when they grow;
  a player cannot switch an unseen light (COMBAT_LIGHT_NOT_SEEN), can switch a seen or explored one, never on a map
  that is not live; the GM switches any.
- **Cost on the largest map** (44 x 32, 300 objects incl. 50 lit lights, 4 areas, 80 tokens with every 7th
  carrying a torch, the viewer's 130-degree cone with a torch), whole `playerView` call through convex-test, median
  of 7: about 8 ms by day and 10.5 ms at night (max 24 ms), result about 4.1 KB; `markExplored` about 9 ms. It reads
  about 400 documents (map, 300 objects, ≤ 12 tiles, 80 tokens, the time row, PC characters, adversary instances,
  grant lookups), far inside Convex's per-query limits (1 s, 16,384 documents, 8 MiB).
- `pnpm vitest run`, `pnpm lint`, `pnpm typecheck`: see the tracer report.

## For C8
- Players: `useQuery(api.combatVision.playerView, { campaignId })` plus C3's `combatMaps.live` for the layout. The
  GM's preview: `previewAs({ campaignId, characterId, mapId? })`, the same shape.
- Paint the fog from `vision` (`decodeExplored(vision.seen | vision.clear, vision.sw * vision.sh)`): do not
  recompute levels on the client, because hidden tokens' carried lights (Q3) are not sent. Use C1's engine on the
  client for the cone outline (`coneDeg` is in the result) and the GM's own view.
- Explored: `explored({ campaignId, characterId, mapId? })` returns the stored mask; paint explored-but-not-seen
  squares faintly. After a view update, `next = mergeExplored(stored, seen)`; when `exploredGrows(stored, seen)`,
  call `markExplored({ campaignId, mapId, characterId, bits: encodeExplored(seen) })` (throttled; the server drops
  samples the character does not see now and never overwrites).
- `others` rows have no portrait: draw initials (C6's `initialsOf`). `revealed: true` gets the dashed outline.
- `pcs` are C6 `TokenView`s and can go straight to C6's token layer; `others` need adapting (stats null, canMove false).
- Lights: `toggleLight({ campaignId, objectId, lit })` with the wanted state; optimistic update on `combatMaps.live`
  / `get` objects' `lit`. Carried light: `setCarriedLight({ campaignId, tokenId, light })`.
- Fog brush: `paintFog({ campaignId, mapId, squares, mark })`; optimistic update with C5's `paintTile` on the fog layer.

## QUESTIONS
1. Frames without campaign time (every frame but Witherwild): treated as day (`phase: null`). Reversible: a GM
   light switch per map, or another default.
2. Non-PC rows omit the carried light (the user's list is name + portrait/initials + size + side + face); a visible
   enemy's torch still shows as lit ground in the mask. Reversible: add `light` to `others`.
3. `playerView` answers `noCharacter` instead of throwing COMBAT_NO_CHARACTER, so a player not yet placed sees an
   empty state rather than an error card; `markExplored` throws it.
4. `toggleLight` takes the wanted state (`lit`) rather than flipping, so a double click or a stale client cannot undo
   itself (CL3).
