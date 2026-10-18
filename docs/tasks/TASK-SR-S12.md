# TASK-SR-S12: Domains page (domain cards felt hand and vault, heritage and subclass hero cards)

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S12 (wave 2). UI only, no `convex/` changes.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Domain Cards (C/sections/domains.tsx + domains.css, `dk-*` classes):**
  - Domains box (`SheetBox`, region "Domains"): class domain chips with their emblems, "N of M cards chosen" with diamond pips and "Level L + 1 [+ k from advancements]". M is the board's formula: level + 1 + the number of "additional domain card" advancement picks. There are max(M, N) pips.
  - Rest toggle row (editors only): "Swapping during a rest", then the smaller "(free only while the GM has a rest open)" inside the same label so the accessible name stays as before. The Recall Cost note and the `no-open-rest` warning follow the label.
  - Green felt table (region "Loadout and vault"): "Loadout N / 5 in hand", the fanned hand (list "Loadout cards"; 7° per step, the board's drop), and the vault deck.
  - Hand cards: board `hc-face` cards. Each article is keyboard focusable (`tabIndex=0`). Hover or focus raises the card out of the fan and shows its footer, which holds "Move to vault" for editors.
  - Vault deck: a `button` with `aria-expanded`, `aria-controls`, a "Close/Open vault, N cards" label, a stack of up to three domain card backs (board `cb-*` assets) and a count badge. It spreads or gathers the vault (list "Vault cards"). Each vault card's footer is always shown and holds "Move to loadout (<cost>)" or the existing block text (above your level / loadout full).
- **Heritage & Subclass (C/sections/heritage.tsx + heritage.css, `hc-*` classes):**
  - Cards follow the board's `hc-card`: art header with the kind tag, Cinzel name, tier, sub line, feature text, lock line. The grid is `minmax(min(100%,260px),1fr)`.
  - Locked cards grey their art, head and text, as on the board. The lock line stays readable.
  - Specialization and Mastery locks follow `subclassRank`. Mastery shows "Crossed out: you multiclassed" when the character has multiclassed.
  - Multiclass shows the second class card and its foundation card. The class card now uses the multiclass subclass art.
- **Visual spec:** `tests/e2e/visual/S12.spec.ts` shoots domains, loadout (vault gathered), vault-spread and hero-cards. It also checks that a hand card takes focus and that Tab reaches its "Move to vault".

## Defaults and deviations

- **Vault opens spread:** the vault starts spread, unlike the board, where it starts gathered. Moving a card to the vault spreads it again. This keeps `tests/e2e/character-sheet.spec.ts` and `tests/unit/sheet-render.test.ts` unchanged (both expect the "Vault cards" list without a click).
- **Read-only viewers:** they always see the spread, and the deck is a picture (`aria-hidden`), not a button. The read-only unit test allows no non-tab buttons.
- **No Domain Deck:** the board's Domain Deck (every class card, filters, Take card, card backs) is not built. It needs a take-card mutation and the user's confirmation.
- **No hand "Remove" button:** the board's "Remove" button in the hand and the vault is not built. There is no mutation to drop a card.
- **Phone (≤ 640 px):** the felt stacks, with the deck above the hand. Hand and vault cards are full-width faces with their whole text and 44 px buttons, without the fan or the masked text.
- **Hero card height:** hero cards size to their text, with rows stretched to equal height. The board fixes a 5/7.6 aspect ratio and scrolls the text, which would need a focusable scroll region.

## Visual comparison

| Region | App 1440 / 390 | Board 1440 / 390 | Verdict |
|---|---|---|---|
| domains | test-results/visual/S12/domains-* | test-results/visual/board/domains-* | Same layout: chips, count, pips, toggle row. At 390 it stacks with the count block left-aligned. |
| loadout | S12/loadout-* | board/loadout-* | Felt, fan, deck stack with the count badge and the "Click to spread" label match. The board shot has an empty hand. |
| vault spread | S12/vault-spread-* | (board state not shot) | Board `vault-spread` grid (minmax 170 px), the pop-in animation, footers always shown. |
| hero-cards | S12/hero-cards-* | board/hero-cards-* | Same card anatomy and grid. The lock line follows the text. The board's "Test: lock again" buttons are design-only and are not built. |

At 390 there is no horizontal scroll (`shoot` asserts it).

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test`: 100 files, 1047 tests passed.
- e2e on ports 3187/3486: character-sheet (3), level-up (1) and `E2E_VISUAL=1` S12 (1) all passed.
