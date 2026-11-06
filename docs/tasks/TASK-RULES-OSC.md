# TASK-RULES-OSC: sheet optional rules, Gold coins and Shared domain cards

Plan `.omc/plans/rule-switches.yaml`, tracer OSC (epic dcm-jh6d part A, bead dcm-bxp.134). Builds on RS0
(`docs/tasks/TASK-RULES-RS0.md`): both rules are already in the registry and the stored modes; OSC wires them into the
sheet, the pickers and the server.

## The book

CB p.104, "Optional rule: Gold coins": "If your group wants to track gold more granularly, you can add coins as your
lowest denomination. Following the established pattern, 10 coins equal 1 handful." The established pattern, same page:
"When you have marked all of the slots in a category and you gain another gold reward in that category, you mark a slot
in the following category and clear all the slots in the current one."

CB p.21, "Shared domains": "If a fellow player's class has the same domain as yours, we encourage you to coordinate with
them and choose different cards from that domain deck (even if your group has multiple copies). This way, each player
feels distinct and shines when they bring their unique abilities to the story. However, if the GM and players agree,
feel free to make an exception. Sharing cards is common when more than one player chooses the same class or when three
(or more) players share the same domain."

## User decisions (binding)

- Gold coins (Q12 a, 2026-11-05): a Coins row 0–9 on the sheet's gold, shown only while the rule is on; 10 coins roll
  into 1 handful, like handfuls into bags. Off by default.
- Shared domain cards (Q16, changed 2026-11-05): a three-way setting Allow / Warn / Refuse; Warn for every campaign,
  existing ones included (no pin migration: an unset value resolves to `warn`). Refuse is labelled "not in the books".

## Behaviour

| Setting | What happens |
|---|---|
| Gold coins off (default) | No Coins row. `adjustGold { coin: "coins" }` is `MECHANIC_DISABLED`. Stored coins are never changed. |
| Gold coins on | Coins row (stepper 0–9). 10 coins roll into a handful, and on into bags and the chest; a gain that would need a second chest is `INVALID`, as for handfuls. Spending stops at 0 coins (a handful isn't broken into coins). |
| Shared cards Allow | No note, no check. |
| Shared cards Warn (default) | Pickers show "Mira already has this card" on a card another character of the campaign holds (loadout or vault). Never refused. |
| Shared cards Refuse | The same note, plus "this campaign doesn't share domain cards"; the picker disables the card. The server refuses creation (`INVALID`), the Domain Deck's `takeCard` (`INVALID`) and a level-up that gains the card (`LEVEL_UP_RULE`). |

"Another character" is every character of the campaign but the one choosing, whatever its status (the plan's "another
PC of the campaign holds"). Moving a card between loadout and vault is not taking it, so it is never checked.

## Pieces

| Piece | File |
|---|---|
| `MAX_COINS`, `Gold.coins?`, `addGold(gold, "coins" \| "handfuls" \| "bags", delta)` | `src/lib/domain/characters/index.ts` |
| `cardHolders`, `sharedCardNote`, `sharedCardRefusal`, `SharedCardsMode` | `src/lib/domain/characters/index.ts` |
| `goldValidator` widened with `coins?` (rule 7) | `convex/lib/validators/characters.ts` |
| `adjustGold` takes `coins`; `updateSheet` keeps stored coins on a whole-gold write; `assertCardsUnshared` on `create` and `takeCard` | `convex/characters.ts` |
| `levelUp.apply` refuses gained cards under Refuse | `convex/levelUp.ts` |
| `useSharedCards(campaignId, exceptId?)`: mode + holders for any picker | `src/components/party/level-up/shared-cards.ts` |
| `SharedCardNote` (the note on a card) | `src/components/party/sheet-ui/index.tsx` |
| Creation wizard step 8: the note, disabled cards under Refuse, step 8 waits (`sharedCardsMissing`) | `src/app/(gm)/campaigns/[campaignId]/party/new/` |

Adding the note to another picker:

```tsx
const shared = useSharedCards(campaignId, character._id);
const note = shared ? sharedCardNote(shared.mode, shared.holders, card.id) : null;
const refused = note !== null && shared?.mode === "refuse";
// <SharedCardNote note={note} refused={refused} />, and disable the take button when `refused`.
```

## Outside OSC's owns (follow-up)

- `src/lib/validation/characters.ts`: the stored sheet's zod `gold` needs `coins: z.number().int().min(0).max(9).optional()`.
  Until then `storedSheet` strips the coins and they don't persist (the `it.todo` in the test file).
- `src/app/(gm)/campaigns/[campaignId]/party/[characterId]/sections/story.tsx` (the Coins row in `GoldWealth`) and
  `sheet-context.tsx` (`adjustGold` takes `"coins"`).
- The level-up and Domain Deck pickers (`party/[characterId]/sections/domains.tsx`, `level-up-draft.tsx`) still need the
  note: the server already refuses under Refuse.

## Tests

`tests/convex/rules-sheet-options.test.ts`: `addGold` with coins; `adjustGold` off and on; the shared-card helpers and
the wizard's step-8 gate; Warn and Allow never refusing; Refuse on creation, `takeCard` and `levelUp.apply`.
