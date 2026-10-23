# TASK HF1: The Map Hand as a fanned hand along the bottom of the map; drag a card onto the table to play it

Plan `.omc/plans/hand-fan.yaml`, tracer HF1 (wave 1, no dependencies). Bead `dcm-bxp.99.30`. Status: Review.

## User answers implemented (bead, 2026-10-23)

- "use the same layout as the loadout in the domains tab (as if you are holding the cards like in a DCG duel) on the
  bottom side of the map with a show / hide cards if all tokens need to be seen"
- "a slim bar above the fan holds the 'Play for this character' switch, Roll options and a small vault deck at the
  right end; hiding leaves a peek tab 'Show cards (N)' at the bottom edge with card tops peeking, remembered per
  player; hover or tap raises a card out of the fan; DRAGGING a card onto the table plays it, and targeting on the map
  happens after it is played (cards with nothing to target fire at once, as I1). Keep a keyboard/non-drag way to play
  (Use on the raised card) for WCAG 2.5.7."

## What changed

| File | What |
|------|------|
| `src/components/cards/fan.ts` (new) | The fan maths, shared: `fanPose(i, n, turned)` (7° per step from the middle, a drop of 7 px times the square of the offset, left under right; a used card 16° and 14 px further), `fan()` (the `--rot` / `--ty` / z-index CSS both fans read), `CARD_BACKS`, `GENERIC_BACK`, `deckBacks()` (the vault deck's three backs). |
| `…/party/[characterId]/sections/domains.tsx` | Uses `fan`, `deckBacks`, `CARD_BACKS` and `GENERIC_BACK` from `fan.ts` instead of its own copies. Same numbers, so the tab looks the same; `domains.css` is unchanged. |
| `actions/hand/dock.tsx` (new) | `HandDock` portals the Hand into the map board (`.cm-board`). It finds the board from an anchor in the column, through `useSyncExternalStore` and a `MutationObserver` on `.cm-area`, so it follows a board the error boundary remounts. With no board (outside the page, unit tests) it renders in place. `HandFan`: the loadout as the fan. Pointer events drag a card (mouse, pen and touch); a press under 6 px is a tap, which focuses the card and so raises it. `VaultDeck`: the small deck button (three backs and the count) at the bar's right end. |
| `actions/hand/index.tsx` | `HandBody` is now the dock: panels (a card waiting for its target, the locked note, errors, "The card is in play…", the card result with ✕, waiting uses, the vault strip), then the bar (title, the caller's controls, Roll options, "Hide cards", the vault deck), then the fan, or the peek tab "Show cards (N)". `play(card)` (the end of a drag) runs the same path as Use (`playNow`), except for a one-enemy card with no enemy picked (below). `Hand` (player) and `GmHand` (GM) render it through `HandDock`. `HandColumn` (new) is the column's or the phone sheet's Hand card: where the cards are, and "Hide my hand from the other players". |
| `actions/hand/model.ts` | `aimsOnMap(form, …)`: true for a one-enemy card whose only missing answer is that enemy. It is never true for the GM, or when an enemy is already picked. `dropsOnTable(point, table, tray)`: inside the map's viewport and outside the hand's tray. `DRAG_SLOP_PX`. |
| `actions/targets/state.tsx` (+ re-exports in `targets/index.tsx`, `actions/index.tsx`) | `ActionsProvider` holds `aim` (`{ characterId, cardId, cardName, onTarget }`). While a card waits, the next enemy picked on the map through `toggleTarget` (the vision layer's click) goes to `onTarget` from that click's handler, and the aim ends. No effect fires a mutation (rule 13). |
| `actions/index.tsx` | `ActionsPanel` mounts `Hand` once, outside the 760 px layout switch, so the dock stays at every width. The desktop cards and the phone sheet's Hand tab show `HandColumn`. The sheet keeps its four tabs. |
| `actions/hand/hand.css` | The dock, the bar, the popover roll options, the vault deck, the fan and the peek tab (below). The vault strip is a horizontal row. |

No server file, schema, validator, public function or error code changed.

## How it works

- **Dock.** The board is a flex column (toolbar, viewport, hint). The dock goes between the viewport and the hint. It
  has no height of its own and holds an absolutely placed hand that grows upward over the viewport's bottom edge.
  Only the bar, the panels and the cards catch the pointer, so the map around them still pans and takes clicks. The
  fan's `clip-path` cuts the cards at the map's bottom edge and leaves the top and sides open, so a raised or dragged
  card leaves the fan whole.
- **Fan.** Card width and peek: 168 / 118 px; 150 / 106 at ≤1180 px; 124 / 96 at ≤1000 px (a 768 px tablet keeps the
  300 px column); 104 / 84 at ≤760 px. A raised card is scaled 1.1, 1.25 or 1.45 at those widths. Hover, focus (a
  tap, or tabbing to its More or Use) raise a card to full size above the edge. A card waiting for its target only
  lifts and glows, so the map and the "tap an enemy" panel stay clear. The panels sit above a raised card.
- **Drag.** A card can be dragged only when it can be played: the hand is playable (not the GM's locked view or
  another player's hand), the card is ready with a ready action use, the roll options are not blocked, and no use is
  in flight. Used, passive, greyed and read-only cards never drag. While a card is dragged, the map's viewport is
  outlined. A card let go over the viewport and outside the tray is played. Anywhere else it goes back.
- **Targeting after the play.** A dragged card goes the same way as its Use button:
  - It fires at once when nothing is asked, or when it is a one-enemy card and an enemy is already picked (F8-I1).
  - It opens the dialog when it asks something else (a spell, a number, a situation, …).
  - A one-enemy card with no enemy picked waits instead: "Bolt Beacon: tap an enemy on the map to target it.", with
    "Pick from a list" (the dialog) and "Cancel". The enemy tapped next is its target, and the card fires with the
    roll options as they are then.
  - The GM picks no targets on the map (GM clicks select tokens), so a GM's dragged card opens the dialog, as Use does.
- **Use** on the raised card is the keyboard and single-pointer way (WCAG 2.5.7). It works as in I1.
- **Show / hide.** "Hide cards" (`aria-expanded`, `aria-controls` the fan) hides the bar and the panels. It leaves
  the peek tab "Show cards (N)" and the fan 28 px high, `inert` and `aria-hidden`. The choice is kept in localStorage
  under `dh.combat.handHidden:<campaignId>:<characterId>`, through the map's `useViewerFlag`, which wraps every access
  in try/catch. Without storage the hand starts shown, and Hide still works for the visit (`useHiddenChoice`).
- **Read only.** The GM's locked view and another player's hand are the same fan, greyed, with no Use, Recall or drag.
  The bar says whose hand it is and carries "Your hand" (player) or the switch and ✕ (GM). A hidden hand shows why,
  in place of the cards, and is never asked for.
- **Error boundaries.** `Hand` stays inside `PartBoundary` ("Your hand") and `GmHand` inside "The hand". A failing
  hand shows its alert in the column, and the map is untouched.

## Tests

- `tests/unit/card-fan.test.ts` (new, 7 tests): `fanPose` for one, five and two cards and for a used card; `fan`'s CSS;
  `deckBacks` from the vault's domains, the class's domains, and the generic back.
- `tests/unit/combat-hand.test.tsx` (41 tests, 12 new in "HF1"):
  - model: `dropsOnTable`, `aimsOnMap`;
  - the fan's turns;
  - a drag onto the table sends the same `useCard` request as Use;
  - a drop over the tray, off the map, or a tap plays nothing, and a tap focuses (raises) the card;
  - a dragged Bolt Beacon waits, and the enemy then picked through `toggleTarget` is its target, with roll options
    set while it waited;
  - Cancel and "Pick from a list";
  - used, passive and GM-locked cards don't drag, and another player's hand is a read-only fan;
  - a GM's dragged card opens the dialog;
  - Hide, Show, and the choice remembered per campaign and character;
  - blocked storage;
  - the dock portals into `.cm-board`.

  Updated: the vault opens from the deck; "Hide my hand" is in `HandColumn`.
- `tests/e2e/combat-cards.spec.ts` (4 tests):
  - the player drags Bolt Beacon onto the table with `dragTo`, taps the Bandit, and it hits with the roll options;
  - then Use by keyboard (focus + Enter) fires it again;
  - "Hide cards" and "Show cards (2)" survive a reload;
  - Mira's hand is read only, with nothing draggable, and the vault opens from the deck;
  - Deft Maneuvers is dragged and fires at once; once used it can't be dragged;
  - the GM's dragged card (1440 px) or Use (390 px) opens the dialog.
- `tests/e2e/a11y-combat-hand.spec.ts` (new): axe on the fan, a raised card, the roll options open, the vault open, a
  card waiting for its target, and the peek tab. At 768x1024, 1024x768 and 390x844, hidden and shown: no sideways
  scroll, at least 35% of the map viewport above the hand, and 44 px controls in the bar and on the peek tab.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 292 files, 7775 passed, 1 expected fail.
- e2e (`E2E_REUSE_SERVERS=1`, ports 3135 / 3382): `combat-cards.spec.ts` (4), `a11y-combat-hand.spec.ts` (1) and
  `combat-attack.spec.ts` (2; the phone sheet keeps its four tabs): 7 passed.
- `pnpm tracer:guard .omc/plans/hand-fan.yaml HF1`: OK.
- `tsconfig.json` and `convex/_generated` untouched (no new public module).

## Notes

- `tests/e2e/visual/CA-CA6.spec.ts` (not owned) still opens the phone sheet's Hand tab and expects the card result
  there. The result now shows above the docked fan, so that visual spec needs updating by its owner.
