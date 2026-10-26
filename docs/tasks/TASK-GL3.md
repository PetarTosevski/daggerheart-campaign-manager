# TASK-GL3: Choose level-up domain cards in the Domain Deck

Status: Review. Plan: `.omc/plans/guided-level-up.yaml`, tracer GL3. No server or schema change.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Target:** the Domain Deck `SheetBox` has `id="lu-target-deck"`, and its `h3` "Domain Deck" takes the focus from `goTo("deck")`.
- **Choosing (`C/sections/domains.tsx`):** while `useLevelUpDraft().active` holds and the viewer can edit, the deck works on the draft:
  - Reach is `cardsWithin(reach, level, MAX_LEVEL, sources)` at the new level. `reach` adds the draft's multiclass domain when the multiclass pick is ticked and the multiclass choice is set (CB 110). The filters follow it through `deckDomains(reach)`.
  - Reachable cards that are not owned or chosen show **"Choose for level N"**, with the accessible name "Choose <card> for level N". A click fills `draft.cardId` first. After that it fills the first empty "additional domain card" pick whose tier cap (`DOMAIN_CARD_CAP`) allows the card, through `setPickTargets`. The button is disabled when no open slot takes the card.
  - Chosen cards get a green ring, a green **"Chosen for level N"** badge and **"Undo choice"** ("Undo choice of <card>"). Undo clears the slot the card filled.
  - Cards that come within reach only at the new level show face-up. "Hide cards above my level" uses the same reach.
  - Take card and No picks left are hidden during the mode.
  - A green dashed line above the filters counts the open slots ("Level 2: choose 1 domain card below.").
- **Exchange (CB 110):** in the mode, every owned card in the hand and the vault shows **"Exchange at level-up"** ("Exchange <card> at level-up"). The hand's action strip stays visible during the mode.
  - A click sets `draft.trade = { out, in: "" }` and calls `goTo("deck")`.
  - The deck then names the card being exchanged and its level cap, and offers **"Take in exchange"** ("Take <card> in exchange for <out>") on reachable cards of that level or lower.
  - The incoming card shows "Exchange for <out> at level N" with Undo choice. The hand or vault card shows "Exchanging at level N" with "Cancel exchange".
  - The ribbon's summary (GL0) already lists `choice.trade` as "Exchange X for Y". The built choice carries the trade only when both cards are set.
- **DD1 follow-up:** `.dkc-more` has `min-width:44px`, so More/Less is at least 44×44 (it was 37×44). `tests/e2e/visual/S13.spec.ts`'s read-only player check now allows the deck's view-only controls and the "Hide cards above my level" checkbox: filters, More/Less, card backs and Turn over. Every other deck button fails the check, and a Take, No picks left, "for level N" or "at level-up" button fails it too.
- **Styles (`domains.css`):** draft-only state uses `--sheet-green` / `--sheet-green-bright`, the colours of the ribbon's done marks: `.dkd-lu`, `.dkc.lu-chosen`, `.dkc-lu-badge`, `.dk-lu-badge`, and the green `.dkc-btn.dkc-lu` and `.dk-btn.dk-lu-btn`.

## Defaults taken (open questions)

- **Choose with every slot filled:** the button is disabled, so the player undoes a choice first. It does not replace the level's card.
- **Starting an exchange always goes to the deck.** Starting a second one replaces the first, because there is one trade per level.
- **The exchange is offered on every owned card,** including one that the "In vault" recall rules would block. The engine checks only ownership and level.
- **The chosen card stays in the deck grid.** It is not moved to the hand preview.

## Verification

- `pnpm lint`, `pnpm typecheck`: clean. vitest: 104 files, 1079 tests passed. The new file `tests/unit/domain-deck-level-up.test.ts` has 4 tests.
- e2e (ports 3145/3402): `E2E_VISUAL=1` GL3 (1) and S13 (2) passed; character-sheet (3) and domain-deck (1) passed. Screenshots: `test-results/visual/GL3/deck-chosen-{1440,390}.png`, `hand-exchange-{1440,390}.png`.
