# Combat Map: design brief for the missing board parts

For Claude Design. Extend the existing board `reference/designs/project/Combat.dc.html`;
keep its look (dark teal cards, Cinzel headings, gold accent `#e3b45a`, square 5-ft grid,
painted map renderer, token style, header with GM Fear and the campaign nav).
Issue: `dcm-bxp.32`. Rules decided with the user on 2026-10-19.

## What the board already has (keep)

- Scene card: describe the battlefield, Small / Medium / Large, Generate, "Another version",
  Stop, "Use my own map image".
- Combatants card: add the party, the session encounter, adversaries sent from the
  Adversaries tab, custom tokens.
- Selected-token card: HP and Stress pips, conditions, side, size, remove.
- Map: drag to move (snaps to the grid), pan, zoom, Fit, names, range circles
  (Melee 1, Very Close 3, Close 6, Far 12 squares; Core Book p.103).

## What to add

### 1. Several maps per campaign

A map list (or switcher) for the campaign: name, thumbnail, size. The GM creates, renames,
duplicates and deletes maps and marks one as **live**: the map the party sees. Show which
map is live, in the list and in the header line.

### 2. Editing a map by hand

The GM can edit a generated layout as well as regenerate it: paint terrain (grass, stone,
water, wall and the rest), place / move / delete objects (trees, rocks, tents, crates…),
and mark what each object does for vision:

- **Blocks sight**: anything big enough to hide behind (walls, trees, tents, boulders).
- **Cover only**: half walls, logs, crates: they do not block sight.

For an uploaded image: resize and realign the grid over the image at any time (square
size, offset), and paint sight-blocking areas on top of the image.

### 3. Range circles per token

Each token has its own on/off switch for its range circles (PCs and adversaries alike), so
several tokens can show them at once without cluttering the map. Replace the single
global "Ranges" toggle with this; a "hide all circles" button is welcome.

### 4. Facing

Tokens have a facing. The portrait on the token shows the front. A token faces the way
it last moved, and its owner (or the GM) can also turn it with a drag handle on the
token's edge.

### 5. Vision and fog of war

Each **player sees only their own character's view**. Show these states:

- **Vision cone**: forward from the token's facing. Width from Instinct:
  Instinct 0 = 70°, ±15° per point (−1 = 55°, +2 = 100°, +4 = 130°), capped at 180°.
  Never anything behind.
- **Blocked**: sight-blocking terrain and objects cast shadows; nothing behind them is seen.
- **Light by time of day** (from the campaign clock):

| Light | Clear (terrain + tokens) | Dim (faint terrain, **no tokens**) | Dark (nothing) |
|---|---|---|---|
| Day, dawn | whole cone | — | — |
| Dim phases (Nautical Twilight, Nightfall) | whole cone; ranged attacks at disadvantage | — | — |
| Night, no light | Melee | Very Close | beyond |
| Night, torch / lantern | up to Close | Close to Far | beyond |
| Night, Alistair's Torch | up to Far | — | beyond |
| Night, wall torch (map object) | up to Close | Close to Far | beyond |
| Night, campfire (map object) | 12 squares | 12 to 24 squares | beyond |

  Show a small badge for the dim phases ("Dim light: ranged attacks at disadvantage").
  Light sources: a character can carry one (torch, lantern, Alistair's Torch). Map objects
  give light too and are clicked on / off: a **wall torch** lights like a torch (clear to
  Close = 6 squares, dim to Far = 12); a **campfire** lights double that (clear to 12
  squares, dim to 24). Show lit and unlit states.
- **Explored areas** stay faintly visible after the character looks away, but tokens
  there are not shown unless the character can see them now.
- **Hidden in dim light**: tokens in dim light at night are hidden from players. The GM
  asks for a roll; on a success the GM reveals that token to that player. Design the
  GM's "Reveal to…" action and how a revealed token looks to the player.

### 6. GM view

The GM sees the whole map and every token, with a way to **preview what any one PC
sees**. The GM can also reveal or hide areas by hand (a brush or a rectangle), on top of
the automatic vision.

### 7. Player view

A separate view of the same page for players:

- only the live map; no Scene card, no map list, no edit tools;
- the player's own character highlighted; they drag and turn **only their own token**;
- adversary and NPC tokens show a portrait or initials and a name, **never HP, Stress,
  Difficulty or other stats**; other PCs show their public info only;
- range circles available on any token they can see;
- the fog and light rules above, from their character's point of view.

## States to draw

GM with no map · GM editing a map · GM in play (live map, a few tokens with circles on)
· GM previewing a PC's view · player by day · player at night with a torch (a hidden token
in the dim band, one revealed by the GM) · player during a dim phase · the map list.
Desktop at 1440 px and a tablet at about 1024 px.
