# TASK-D9-C6: Tokens - party, encounter, custom, move, facing, panel, range circles

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C6 (wave 3; depends on C3). Bead: `dcm-bxp.32`.

## Goal
The GM places the party, a D8 encounter's adversaries and custom tokens; everyone drags the tokens they may move (snapping
to the grid and facing the way they moved), turns them with a handle, edits HP/Stress/conditions in the token panel
(synced to sheets and the tracker), and toggles range circles per token.

## Rules this tracer implements
- **R3** "Range circles on any token (PC or adversary), switched on/off per token; 'hide all'. Melee 1, Very Close 3,
  Close 6, Far 12." → per-viewer localStorage (`tokens/rings.ts`), the panel's "◎ Range circles" and the R key; the
  rings use C1's `RANGE_BANDS`; "◎ Hide all circles" sits in the token panel (with nothing selected the panel shows a
  small "Range circles on N tokens" card holding the button), since the MapBoard toolbar is C3's.
- **R4** "Tokens are linked to the encounter tracker (adversaries) and character sheets (PCs). The GM sees stats; players
  never see an adversary's or NPC's HP, Stress, Difficulty or other stats. Players move and turn only their own PC's
  token." → the token row keeps only `{kind, characterId}` / `{kind, adversaryId}`; stats are read from the sheet or
  `encounterAdversaries` at query time and written through `characters.adjustResource` and `encounterTracking.markHp /
  markStress / toggleCondition`. Players read only `party` (PC tokens). `move` / `turn` check the character with
  `permissionFor` (edit), else COMBAT_NOT_YOUR_TOKEN.
- **R5** "Facing: a token faces the way it last moved; its owner or the GM can also turn it (drag handle, snapped to 15
  degrees). The PC's portrait on the token shows the front." → `moveToken` sets `face = atan2(dy, dx)` when the square
  changes; the gold knob and ⟲ / ⟳ (45°, the board) call `turn`, snapped to 15° on the server (`snapTurn`). The portrait
  is drawn upright with the board's facing arc and arrow (as on the board).
- **Q6** "keep the board's '+ Session encounter' button; it stays disabled ('Comes with Sessions') and does nothing until
  D10 Sessions wires it ... C6 files the D10 bead." → disabled button, title "Comes with Sessions", no handler; bead
  **dcm-bxp.50** (child of dcm-bxp, depends on dcm-bxp.9 D10 Sessions).

CB p.103 (re-checked in `.reference-private/`, Core Book printed page 103), "Optional Rule: Defined Ranges": "If your
table would rather operate with more precise range rules, you can use a 1-inch grid battle map during combat. If you do,
use the following guidelines for play: Melee: 1 square; Very Close: 3 squares; Close: 6 squares; Far: 12 squares; Very
Far: 13+ squares; Out of Range: Off the battlemap." A ring of band r around a token of size s has radius r + s/2 squares
from its centre (the board's rule).

## Public functions (`convex/combatTokens.ts`)
GM wrappers: player FORBIDDEN, outsider NOT_FOUND, anonymous UNAUTHENTICATED. `party`, `move`, `turn` are
`campaignQuery` / `campaignMutation` with `need: "view"`, `enough: "owner"`. Every function has `args` and `returns`.

| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `list` | gmQuery | `mapId: string` | `TokenView[]` (every token, stats, `revealedTo`); unknown map → `[]` |
| `party` | campaignQuery | `mapId: string` | `TokenView[]`, PC tokens only; players: live map only (else `[]`) |
| `combatants` | gmQuery | `mapId: string` | `{ partyLeft, encounter: {_id, name} \| null, queue: {instanceId, name, solo}[] }` |
| `addParty` | keyedGmMutation | `mapId` | `{ added }` |
| `placeAdversaries` | keyedGmMutation | `mapId`, `instanceIds: string[]` (1..60) | `{ added }` |
| `addCustom` | keyedGmMutation | `mapId`, `name`, `hp` (0..99), `side: enemy\|ally\|neutral` | `{ tokenId }` |
| `rename` | gmMutation | `tokenId`, `name` (custom only) | null |
| `setSide` | gmMutation | `tokenId`, `side` (`pc` only for PC tokens) | null |
| `setSize` | gmMutation | `tokenId`, `size` (1..3, stays inside the map) | null |
| `markCustom` | keyedGmMutation | `tokenId`, `track: hp\|stress`, `delta` | `{ hp, stress }` |
| `toggleCustomCondition` | keyedGmMutation | `tokenId`, `condition` (tracker list) | `{ conditions }` |
| `remove` | gmMutation | `tokenId` | null |
| `clear` | gmMutation | `mapId` | `{ removed }` |
| `move` | campaignMutation | `tokenId`, `x`, `y` | `{ x, y, face }` |
| `turn` | campaignMutation | `tokenId`, `angle` | `{ face }` |

`TokenView` (`tokenViewValidator`): `{ _id, kind: pc|adversary|custom, characterId?, instanceId?, side, x, y, size, face,
light, revealedTo? (GM only), name, sub, portrait: null | {kind:"url", url} | {kind:"asset", asset, position}, canMove,
mine, stats: null | { hp, hpMax, stress, stressMax, conditions, difficulty?, down }, tracked? }`. `stats` is null when the
character or tracker instance is gone (the token reads "Missing character" / "Removed adversary" and the GM can remove
it). `tracked`: the adversary's encounter is running (the tracker refuses changes otherwise).

Errors: C0's COMBAT_MAP_NOT_FOUND, COMBAT_TOKEN_NOT_FOUND, COMBAT_TOKEN_LIMIT, COMBAT_NOT_YOUR_TOKEN; common INVALID,
NOT_FOUND; D8's ENCOUNTER_NOT_RUNNING (placing with no running encounter). No new code.

## Details
- **Placing** (the board's `freeSpot` / `addTokens`, `tokens/geometry.ts`): the party and allies start a fifth of the way
  in from the left on the middle row facing east, enemies and neutrals from the right facing west; never on a covered
  square (a 2 × 2 Solo's whole footprint is free), on walkable squares first (not wall, void, deep water or lava; C2's
  `rasterize` of the layout; any square on an image map).
- **Party**: active characters not on the map (benched, dead, retired are skipped). **Queue**: the running encounter's
  instances in tracker order, not defeated and not on this map; a Solo is 2 × 2; ids already placed are skipped.
- **Move**: whole squares, clamped inside the map; the client previews the drag and sends one `move` on release (and
  arrow keys on a focused token). Players move only on the live map.
- **Optimistic updates** (CL4) on `list` and `party` (`store.getAllQueries`): move and turn with the server's geometry,
  HP / Stress pips (`applyResourceDelta` for PCs, `applyMark` for adversaries), conditions, side, size, remove, clear.
- **Token look** (board): portrait (upload or design art; initials otherwise), side-coloured ring, HP bar (remaining,
  red/gold/green), condition badge (initials), facing arc + arrow, carried-light badge, greyed when down, gold glow on
  the player's own token, white ring when selected, name tag on hover / selected / own / "Names".
- **Token panel**: GM — name (custom tokens editable), sub line ("Party · Bard · level 1 · changes sync to the character
  sheet", "Enemy · Difficulty 14 · Bruiser · Bandit camp"), HP and Stress pips, Range circles, ⟲ ⟳, Hide all circles,
  conditions (tracker's 4 for adversaries and custom tokens; PCs read-only), side, size, Done, Remove from map. Player —
  their own PC's pips (sheet), range circles, turn; another PC: read-only pips and range circles only.
- **Keys**: R (circles of the selected token), Delete / Backspace (GM, remove), arrows (move a focused token); N and
  Escape stay the map board's. In Edit mode tokens are drawn but take no pointer or keys (the editor's tools do).

## Acceptance evidence
- `tests/convex/combat-tokens.test.ts`: 15 tests (anonymous / outsider / player / GM on all 15 functions; players move
  and turn only their own PC token, COMBAT_MAP_NOT_FOUND on a map that is not live; players read only PC tokens, never
  an adversary or custom one, no `revealedTo`; cross-campaign ids; party placement once, idempotent, benched skipped;
  queue one-by-one and Place all, Solo 2 × 2, defeated leave the queue; other encounter NOT_FOUND, ENCOUNTER_NOT_RUNNING;
  custom tokens and the 80-token cap; move snapping / clamping / facing and 15° turns; stats only on their own rows
  (sheet and tracker changes show on the token; token rows hold no copy); custom marks, conditions, rename; side, size,
  remove, clear; geometry incl. a 2 × 2 never overlapping).
- `pnpm vitest run`: 134 files, 1518 tests pass. `pnpm lint` (zero warnings) and `pnpm typecheck` clean.
- `tests/e2e/combat-tokens.spec.ts` (1 test): GM adds the party and the queued Bear ("＋ Session encounter" disabled with
  "Comes with Sessions"), drags the Bear two squares up (snapped, faces -90°), turns it with the knob (faces 0°), marks 2
  HP in the panel (the tracker's `encounters.get` shows 2), R shows its circles and "Hide all circles" hides them; the
  player sees their own and the other PC's token and no Bear, drags their own (moves, faces east, the GM's map follows)
  and cannot drag the other PC's. C0's and C3's combat specs still pass.

## Visual comparison
App: `test-results/visual/C6/{gm-play,gm-cards,player-tokens}-{1440,1024,390}.png` (E2E_VISUAL=1).
Board: `test-results/visual/board/combat-{gm-play,player-day}-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Combatants card | Matches: count line, ＋ Party (n), ＋ Session encounter (disabled), Clear tokens (two clicks), the red dashed "From the Adversaries tab" queue with chips and Place all, the custom token form. |
| Tokens on the map | Matches the board's token: side ring, initials or portrait, facing arc + arrow, HP bar, condition badge, gold knob on the selected token, glow on the player's own. Deviation: PCs without an uploaded portrait show their default design art (as on the Party pages) instead of the board's initials. |
| Range circles | Matches: four dashed rings in the board's colours with "Name · Band" labels. |
| Selected token card | Matches the board's card (pips, Range circles, ⟲ ⟳, conditions, side, size, Done, Remove). Adds "Hide all circles" here (the toolbar is C3's). Conditions are the tracker's four (the board also lists Hexed and Marked, which the D8 tracker does not store). |
| Player (player-tokens) | Own token selected with its card. The map looks small because C3 pads the player's stage by 24 squares until C8 fits it (C3's documented deviation). No adversaries are shown until C7. |
| 390 px | Single column, 44 px pips and buttons, no horizontal scroll. |

## Deliberate deviations
- Range circles are per viewer for the GM too (the board stored the GM's on the token); plan data model.
- Turn buttons turn 45° (the board's); the knob snaps to 15° (R5).
- PC conditions are shown read-only in the panel: no existing character mutation sets conditions (see QUESTIONS).
- The carried-light picker (Q3) is not in the panel: `setCarriedLight` is C7's; tokens already show a light badge.
- Before C7, players get PC tokens only (`party`), so they see no adversary, ally, neutral or custom token at all.
