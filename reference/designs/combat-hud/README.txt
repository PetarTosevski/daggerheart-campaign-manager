Combat HUD export for Claude Code

HANDOFF.md   start here: layout, components, state model, copy, data, build order
boards/      the boards exactly as on the canvas (images load from the canvas, /_blob/<id>)
preview/     the same boards with images pointed at ../assets, plus the board runtime (support.js)
assets/      map, portraits, card art and card backs used by the boards
canvas.json  the canvas layout

Look at a board locally:
  cd combat-hud && python3 -m http.server 8000
  open http://localhost:8000/preview/Main.dc.html  (or GMDesktop, PlayerPhone, Cmp*...)

Suggested first prompt in Claude Code:
  "Read combat-hud/HANDOFF.md and the boards in combat-hud/preview, then rebuild the combat map UI to match, starting with step 1 of the build order."
