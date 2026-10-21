# TASK CA7: Sheet shows the same once-per state on domain cards

Plan `.omc/plans/combat-actions.yaml`, tracer CA7 (depends on CA1). Analysis: `.omc/autopilot/combat-actions-analysis.md`
(git-ignored). Book pages are printed pages; CB = Core Book.

## What landed

| File | What |
|------|------|
| `src/app/(gm)/campaigns/[campaignId]/party/[characterId]/sections/domains.tsx` | The felt table's card face reads `cardAvailability(sheet, cardId)` (CA1, `card-effects/availability.ts`). An exhausted card is greyed (`grayscale(.9) brightness(.82)`), its hand card is turned 16° further and sinks 14 px in the fan, and a ribbon under the art reads `Used · Back after a rest` / `Used · Back after a long rest`. The article's accessible name becomes `<name>, used: <label>` and it carries `data-exhausted="true"`. Vault cards show the same grey and ribbon (not turned). |
| `tests/unit/domains-exhausted.test.tsx` | Sheet fixtures for both limits, a ready card, foreign keys ignored, `expire` after a short and a long rest, a used card in the vault. 6 tests. |

## Rules and answers

- **CB p.101, "Usage Limits"**: "Some domain cards have an exhaustion limit that restricts how often you can use that card
  (for example, once per long rest). If you use that card, you'll need a way to remember that it's temporarily
  unavailable. You might choose to … turn it on its side". The sheet turns and greys the card.
- **Q3 (a)**: one shared `featureUses` record keyed `card:<id>`; the map (CA4) writes it, the sheet reads it. Rests clear
  it through `expire` (`characters/expiry.ts`), so a card is ready again after its rest with no code here.
- Only the card's own key (`card:<id>`) greys the card, as the acceptance says. Sub-use keys (`card:<id>:<useId>`, a
  grimoire spell or an optional part) do not grey the whole card.

## Design and accessibility

- `domains.css` is not this tracer's file, so the grey, the turn and the ribbon are inline styles in the felt palette
  (ink `rgba(26,20,36,.9)`, parchment `#f6ead2`, gold rules `#c9a35a`, Cinzel caps), matching the board's card faces.
- The state is in text twice: the visible ribbon and the accessible name. Grey is never the only signal.
- Hover and focus still straighten and raise a turned card (the existing `.dk-hand-card:hover` rule), so it stays readable.
  The narrow-screen layout drops the fan transform; the grey and the ribbon remain.

## QUESTIONS

1. **Turn angle.** The book suggests turning a used card "on its side". A full 90° turn in the overlapping fan covers the
   neighbouring cards, so the sheet tilts it 16° further and drops it 14 px. Want a full sideways turn instead (it would
   need a `domains.css` change, so a follow-up tracer)?
2. **Sub-use limits.** A grimoire whose one spell is used (`card:<id>:<useId>`) shows ready on the sheet. Should the sheet
   list used spells on the card face (for example a second ribbon line), once CA5's Hand settles how it shows them?
3. **Moving a used card to the vault**: the entry stays, so the card comes back still used until its rest. That matches
   the book (the limit is on the card, not its place); confirm.
