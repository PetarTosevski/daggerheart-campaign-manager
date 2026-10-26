# TASK SC1: Hand cards readable with 'More' on every card; 'More' opens a large card popup

Plan `.omc/plans/sheet-cards.yaml`, tracer SC1 (no dependencies). Beads: dcm-bxp.126 (hand cards: buttons over the text,
no 'More'), dcm-bxp.127 ('More' opens a large card that can be read in full).

## What landed

| File | What |
|------|------|
| `src/components/cards/card-dialog.tsx` | `CardDialog` (controlled: `card`, `used`, `open`, `onClose`, `returnFocus`) and `CardMore` (the 'More' button plus its dialog). It is a native modal `<dialog>` with `showModal()` (CL12), portalled into `<body>` while open and labelled by the card name (an `h2`). It shows the art (`next/image`, decorative `alt=""`), the level badge, the Recall badge, CA7's `Used · <label>` ribbon when the once-per limit is spent, a domain / level / type / recall cost `<dl>`, and the whole text. Escape, the Close button and a backdrop click close it, and focus goes back to 'More'. The card type is a `Pick` of `DomainCard`, so the Combat Map Hand (CA6) can pass SRD cards or server display fields. Imports only SRD leaf modules (CL9). |
| `src/components/cards/card-dialog.css` | The large card in the board's look: domain-coloured head with Cinzel caps, a parchment body, gold rules, and the blue Recall badge on the art. Garamond text at 18 px (17 px on phones). Width `min(560px, 100% - 32px)`. Only the dialog scrolls, and only when the card is taller than the viewport. The text never scrolls inside the card. |
| `sections/domains.tsx` | The felt-table `CardFace` always has a footer *after* the text: 'More' first (on the left, which the next card in the fan never covers), then the face's buttons (Move to vault / Move to loadout / Exchange at level-up). The `actsShown` hover overlay is gone. The Domain Deck's `DeckCard` replaces the inline 'More'/'Less' scroll (its `open` state, the `region`, the focusable text) with `CardMore`. Every 'More' passes the card's once-per state. |
| `sections/domains.css` | `.dk-face` loses its fixed 5:7 ratio. `.dk-face-text` shows five lines and fades. `.dk-face-acts` is a normal footer with a gold rule on top, always visible, no longer absolutely positioned over the text. New `.dk-more` (Cinzel, underlined, 44 px on phones). The `.dkc.open` scroll rules are removed. |
| `tests/unit/card-dialog.test.tsx` | 7 tests: closed renders nothing; 'More' opens a dialog named by the card with its fields, whole text and decorative art; the used ribbon; the Close button and Escape (the close event) return focus to 'More'; backdrop click closes but a click on the card does not; a card without art. |
| `tests/unit/domains-exhausted.test.tsx` | 2 more tests: every hand and vault card has 'More' in the footer after the text, before Move to vault; a used hand card's dialog shows its ribbon and gives focus back. |
| `tests/e2e/sheet-cards.spec.ts` | At 1440 and 390: hand cards' 'More' and Move to vault are visible and sit below the text box (layout offsets, so the fan's rotation does not skew them), and the footer is static at opacity 1. 'More' on two hand cards and one vault card opens the dialog. The text has no inner scroll, there is no sideways scroll, and Escape or Close returns focus to 'More'. The Domain Deck's 'More' opens the same dialog, and 'Less' is gone. |
| `tests/e2e/visual/SC1.spec.ts` | Shots `felt`, `dialog-book-of-ava` and `dialog-deft-deceiver` at 1440 and 390, saved to `test-results/visual/SC1/`. |

## Design notes

- The board has no large card, so the dialog scales up the board's own card face (`hc-face` / `dkc`). The head and meta use Cinzel caps, and the gold `#c9a35a` rules and the parchment `#fffaf0` match the felt table's faces.
- In the fan the cards still overlap their neighbours, as on the board. Hover or focus raises a card, and its footer is never hidden behind its own text.
- On phones (≤ 640 px) the faces stay full width with their whole text, as before, and now have 'More' too.
- Read-only viewers also get 'More': it is a viewing control, like the deck's filters.

## Tests outside the first owns (added to owns by the orchestrator)

- `tests/unit/sheet-render.test.ts` ("renders read-only with no edit controls") counted every button outside the Domain Deck. It now also leaves out `More about …`, because read-only hand and vault cards keep 'More'.
- `tests/e2e/visual/DD1.spec.ts` expected the inline 'Less about Book of Ava' toggle. It now opens the dialog, closes it with Escape and checks that focus is back on 'More'.
- `tests/e2e/visual/S12.spec.ts`: pressing Tab from a focused hand card now reaches 'More about Deft Deceiver' first and then Move to vault.

## QUESTIONS

1. Hand cards in the fan are now about 20 px taller, because the footer sits under five lines of text. Should the fan show fewer lines to keep the board's card height?
