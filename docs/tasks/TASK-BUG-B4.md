# TASK-BUG-B4: Players switch doors and lights only from Melee range; a light they switch stays theirs like a door

Status: Review. Plan: `.omc/plans/d12-bugs.yaml`, tracer B4 (wave 2, after B2 / dcm-bxp.121).

## Decisions this tracer implements
- USER ANSWERS (2026-10-22, binding): "yes to both". (1) A door a player switches is stored as explored (B2's reading
  of D8, confirmed). (2) Light switches get the same fix. "Make sure that player tokens need to be in melee range to
  interact with doors or light sources (turn on off close open)".
- DEFAULTS (orchestrator):
  - Melee is 1 square (CB p.103, "Optional Rule: Defined Ranges": "Melee: 1 square"). It is measured Chebyshev from any
    square of one of the player's character tokens on the live map to any square of the object's footprint, with
    rotation. Adjacent (diagonal too) or overlapping counts.
  - The GM is never range-limited.
  - The player must also have seen the object (D8). Unchanged.
  - A new error code, `COMBAT_OUT_OF_REACH`, with no position in the payload.
  - The vision panel and the on-map door clicks show an out-of-reach switch disabled, with the text "Move next to it"
    (not colour only).
  - A carried light (`setCarriedLight`) is not a map object and is not affected.

## Implementation choices (reversible)
- **Footprint squares** (`src/lib/domain/combat-map/reach.ts`, `objectSquares`): the vision engine and movement already
  define an object's footprint (`prepareMap`, `markFootprints`). A rect sprite is its w x h rectangle, scaled by `r` and
  turned by `rot`. Any other object is the circle `r * blockRadiusFactor(kind)`, and a door is at least half a square.
  A square counts when the centre of one of its half-square vision samples lies inside. The square under the object's
  centre always counts. So a hand-placed Classic door covers its own square, and a turned 3 x 1 gate covers a column.
- **Seen and reach are separate checks**: one of the player's characters must have seen the object, and one of their
  character tokens must stand within Melee. Usually both are the same token, because a player plays one character.
- **Order of refusals**: "not seen" comes first (`COMBAT_OBJECT_NOT_FOUND` for a door, `COMBAT_LIGHT_NOT_SEEN` for a
  light), then `COMBAT_OUT_OF_REACH`. An unseen object still answers exactly as before, so the reach refusal never
  reveals that an unseen object exists. Players already receive the whole layout (`combatMaps.live`, Q1), so the reach
  refusal tells them nothing new about where it is.
- **`doors` carries `reach`**: each door view has a new `reach` field. It is true for the GM. For a player, it is true
  when one of their character tokens is within Melee now. The server computes it so the UI never needs a door's sprite
  traits. The query already reads the tokens, so `reach` updates live as tokens move. Only a returns validator is
  widened; nothing stored changes.
- **Light switches compute reach on the client** with the same `anyInMelee` function. It uses the player's PC tokens
  from `playerView.pcs` (`canMove`: the same edit permission `ownViewers` uses), the layout object and its resolved
  sprite traits (`spriteTraits`, as the server's `loadObjectTraits`). The server check is still the authority.
- **The UI**: in the vision panel's Doors card, an out-of-reach door's Open/Close button is `disabled`, with the
  visible muted text "Move next to it" beside it (linked by `aria-describedby`). The on-map door and light switches are
  invisible until hovered or focused, by design (the painter draws the object). Out of reach, they get
  `aria-disabled="true"`, the click does nothing, the title reads "<name>: Move next to it", and a visible
  "Move next to it" tag (`.cm-vis-reach`) shows under the switch while it is hovered or focused. They use
  `aria-disabled`, not `disabled`, so they still take hover and keyboard focus and can show the text. Playwright and
  assistive technology treat them as disabled. A refused click still rolls back its optimistic update (Convex drops it
  when the mutation throws) and shows the message in the board's alert.

## Server (`convex/combatVision.ts`)
- `ownViewers` also returns each character's token.
- `inReach(viewers, object)` calls `anyInMelee` over the tokens.
- `toggleDoor` (player): the live map, then `doorSeen`, then `inReach` (else `COMBAT_OUT_OF_REACH`), then
  `exploreObject`, then the patch.
- `toggleLight` (player): the live map, then `lightSeen` (the former `hasSeen`, now over the loaded scene), then
  `inReach`, then `exploreObject`, then the patch. `exploreObject` is B2's `exploreDoor`, renamed. It stores the
  object's samples each of the player's characters sees now, through `addExplored`. A light switched after a short look
  therefore stays switchable after the character turns away, exactly as B2 fixed for doors.
- `doors`: each door view has `reach`.
- `src/lib/errors/combatMap.ts`: `COMBAT_OUT_OF_REACH: "Move next to it first."`.

## Role table

| Caller | `toggleDoor` | `toggleLight` |
| --- | --- | --- |
| anonymous | UNAUTHENTICATED | UNAUTHENTICATED |
| outsider | NOT_FOUND | NOT_FOUND |
| player, map not live | COMBAT_MAP_NOT_FOUND | COMBAT_MAP_NOT_FOUND |
| player, object not seen now nor explored | COMBAT_OBJECT_NOT_FOUND | COMBAT_LIGHT_NOT_SEEN |
| player, seen, no own token within Melee | COMBAT_OUT_OF_REACH | COMBAT_OUT_OF_REACH |
| player, seen, a token within Melee (adjacent, diagonal or overlapping) | ok, and the door is stored as explored | ok, and the light is stored as explored |
| GM (any map, any distance) | ok | ok |
| anyone, object that is not a door / not a light | INVALID (a player: only once seen) | INVALID |

## Tests
- `tests/unit/combat-reach.test.ts`: footprint squares (door, campfire, an unturned and a quarter-turned 3 x 1 rect).
  `inMelee` for adjacent, diagonal, overlapping, 2 away, a 2 x 2 token and a rotated multi-square object. `anyInMelee`.
- `tests/convex/combat-doors.test.ts`:
  - New: "a player switches a door only from Melee". Out of reach at 5 and at 2 squares, with only `code` in the error
    data. Ok adjacent, diagonal and overlapping. The GM from anywhere. `doors.reach` follows.
  - The access, sprite-door, walk-through and dcm-bxp.121 tests now step Ash next to the door first.
  - The explored-door test checks that the door is out of reach from 5 squares, then switches it diagonally with
    Ash's back turned.
- `tests/convex/combat-vision.test.ts`:
  - New: "a player switches a light only from Melee" (2 away refused with only `code`, diagonal ok, on it ok, the GM
    from anywhere).
  - New: "a light the player switched stays theirs to switch after they turn away". It fails with the `exploreObject`
    call removed from `toggleLight`, and only the light's samples are stored.
  - The R9 test now walks Ash up to each light and checks `COMBAT_OUT_OF_REACH` for a light that is seen but far away.
- `tests/convex/authz/combat.entries.ts`: the `toggleLight` and `toggleDoor` rows get an entry `setup` (`inReach`) that
  steps characterA's token to (7, 10), on the campfire and next to the door. The player still gets `ok`. The shared area
  setup is unchanged, so `combat.test.ts` (not owned) is untouched and still passes.
- e2e:
  - `combat-vision.spec.ts`: the wall torch's switch is disabled with "Move next to it" from (4, 10). Ash walks to
    (6, 11), switches it, and walks back.
  - `combat-movement.spec.ts`: the door is disabled with "Move next to it" from (7, 16). Ash steps to (8, 16) and opens
    it (the walk-through and close were already in Melee).
  - `live-combat.spec.ts`: the door section moved after the preview checks. The player's door is disabled with
    "Move next to it" from (15, 10), and the GM's card is enabled. Liriel walks east to (23, 10), the GM opens the
    door, the player closes it on the map, and Liriel walks back and is turned east. The GM turns her only after her
    last step is on the server. Without that wait, a step still in flight faced her west again: one failure in the
    first `--repeat-each 3` run.
  - `sprite-packs-flow.spec.ts` switches lights only as the GM and needed no change.
  - Results on the worktree stack (ports 3176 / 3464, `E2E_REUSE_SERVERS=1`):
    - `combat-vision`, `combat-movement` and `live-combat` with `--repeat-each 3`: 15 of 15 passed.
    - `live-combat` alone with `--repeat-each 5`: 5 of 5 passed.
    - `sprite-packs-flow` and `a11y-play`: passed.
    - `combat-light-uploaded`: fails as expected (see below).

## Outside this tracer's owns (reported, not edited)
- `tests/e2e/combat-light-uploaded.spec.ts` switches the uploaded "crystal" light as a player from (4, 7). The light is
  at (8, 7), 4 squares away. Under B4 its switch is disabled, so the player's click on "Put out the crystal" fails. The
  fix is to place Ash next to the stone (for example `move` to (7, 7), then `turn` to 0) before `player.goto(url)`.
- `tests/e2e/a11y-play.spec.ts` (player) only checks that "Open door 1" is visible. The switch is still there, now
  with `aria-disabled`, so the spec needs no change.
