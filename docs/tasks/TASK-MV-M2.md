# TASK-MV-M2: Doors - open/closed field, the door switch like the light switch, closed doors block sight and movement, Classic door kind

Status: Review. Plan: `.omc/plans/map-movement.yaml`, tracer M2 (wave 2). Bead: `dcm-bxp.80`.

## Decisions this tracer implements
- USER ANSWER (2026-10-21): "doors need to be able to be opened and closed. closed doors block opened doors do not. add a
  switch similar to light campfire to open the doors. closed doors also block sights".
- D7: an object is a door when its sprite `move` is "door" (the six catalog doors), or it has no sprite `move` and its
  Classic kind is the new `door`. An uploaded sprite whose Classic kind is `door` defaults to `move: "door"`. Map objects
  gain optional `open` (absent = closed). A closed door blocks movement and an open one never does. A closed solid door
  blocks sight: the Classic `door` (sight default "block") and the wooden door sprite. Bars and gates block movement
  while closed but stay see-through as cover: portcullis section, crypt gate, sewers iron gate, grassland wooden gate,
  wooden fence gate. An open door has no sight effect, whatever the GM's override.
- D8: the switch follows the light-switch rule. The GM can always switch a door. A player can switch one only on the live
  map, and only when one of their characters sees the door now or has explored it.
- Seen (my choice, reversible): any half-square sample of the door's footprint counts, not just its centre, because a
  closed door blocks its own centre from anyone looking at its face. The footprint is `objectSampleBox`: samples whose
  centre lies inside the door's footprint box, at least its own sample.
- Secrecy (my choice, reversible): when a player switches a door they have not seen, the server answers
  `COMBAT_OBJECT_NOT_FOUND`, the same as for an id that is not there. `combatVision.doors` never sends such doors.
- M0 follow-up: an object of Classic kind `hull` is a deck whatever its sprite (`isDeck(o) = o.kind === "hull"`), and a
  hull never blocks (`moveEffect` returns "open"). A Sprites ship drawn with the ship's-bow sprite keeps its deck walkable.

## Schema (widen only)
- `COMBAT_OBJECT_KINDS` / `OBJECT_KINDS` gain `door` (23 kinds; every older kind stays valid).
- `combatObjectFields.open: v.optional(v.boolean())`. Existing rows have no `open` and read as closed.
  `toggleDoor` stores closed as an absent field.
- `combatMaps.get` / `live` object view: `open: v.optional(v.boolean())`, sent only when it is true. M1 draws from it.
- The spec (`mapObjectSchema`, `clean`) keeps `open: true`.
- Catalog: the six door items' Classic kind is now `door`; their `move` stays "door".

## Functions (`convex/combatVision.ts`)
`doors({mapId?})` returns `null | {mapId, doors: [{_id, x, y, r, rot, open, solid}]}`. The GM gets every door on `mapId`
(default: the live map). A player gets only the live map's doors that one of their characters has seen.

`toggleDoor({objectId, open})` returns `{open}`. `open` is the wanted state, so a double click does not undo itself.

| Caller | doors | toggleDoor |
| --- | --- | --- |
| anonymous | UNAUTHENTICATED | UNAUTHENTICATED |
| outsider | NOT_FOUND | NOT_FOUND |
| player, map not live | COMBAT_MAP_NOT_FOUND (with `mapId`) | COMBAT_MAP_NOT_FOUND |
| player, door not seen | not listed | COMBAT_OBJECT_NOT_FOUND |
| player, door seen (now or explored) | listed | ok |
| player, seen non-door | - | INVALID |
| GM | every door | ok; INVALID for a non-door |

Reads: a GM's `toggleDoor` reads the object, its map, and the object's uploaded sprite row if it has one. A player's
`toggleDoor` and `doors` also run `loadScene` (the same reads as `toggleLight`), plus one permission check and one
explored row for each PC token of theirs.

## Vision and movement
- `sightOf` (sight.ts) returns "none" for `open === true`. `VisionObject.open` is passed by `visionObjects`
  (convex/lib/combatVision.ts), so `prepareMap`, `playerView`, `previewAs` and `markExplored` all follow the door.
- `movement.ts` `moveEffect` reads `open` ("door" blocks unless `open === true`). `convex/lib/combatMovement.ts` (M0)
  already passes the row's `open`, so `combatTokens.move` refuses a player's move through a closed door and allows it
  once the door is open.

## UI (`src/components/combat-map/vision/**`)
- `useDoors` uses `combatVision.doors`: the GM in Play, the player on the live map.
- `useVisionActions().setOpen` calls `toggleDoor` with an optimistic update. It patches every cached `doors` list and the
  `combatMaps.get` / `live` layouts.
- The vision panel has a "Doors" card for the player (under "Your view") and for the GM in Play (under "Vision & fog").
  Each door gets a row such as "Door 1 · closed" with an Open / Close button (`aria-pressed`, aria-label
  "Open door 1"). Solid doors are labelled "Door n", bars and gates "Gate n", numbered by reading order.
- The map has a switch over each listed door, like the light switches: invisible until hovered or focused, labelled
  "Open door 1" or "Close gate 2", `data-testid="combat-door"`. M1 draws the door open or closed.

## Tests
- `tests/unit/combat-doors.test.ts`: the kind and field, `clean`, sight (Classic door, wooden door sprite, the five
  gates as cover), the view through an opened door, the seen box (face-on, explored, rotated), movement (Classic door,
  portcullis), `isDoor` / `defaultMove`, and the panel labels.
- `tests/unit/combat-movement.test.ts`: the Classic `door` kind is a door, and the sprite-hull deck test.
- `tests/unit/sprite-catalog.test.ts`: exactly the six door sprites map to Classic `door`, with move "door".
- `tests/unit/combat-map-spec.test.ts`: 23 kinds.
- `tests/convex/combat-doors.test.ts`: the role table, unseen and explored doors, INVALID, maps that are not live, the
  layout's `open` and older rows, a player opening a door then seeing and walking through it and closing it again,
  wooden door versus portcullis, and the GM's preview.
