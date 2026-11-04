# TASK LN-A1: Drawer engine, the reaction-window answers

Plan `.omc/plans/lanes.yaml`, tracer A1 (lane `w0-a-drawer-engine`). DA10 was merged into `rebuild` by the orchestrator
(975efbc) before this tracer started; this branch holds the rest: dcm-bxp.99.19.55 items (3) and (6). dcm-22q stopped on
a rule question (below). Items (1) and (2) of dcm-bxp.99.19.55 belong to lane B1; items (4), (5), (7), (8) are as built.

Book pages are printed pages (CB = Core Book, HF = Hope & Fear).

## What landed

| File | What |
|------|------|
| `src/lib/domain/adversary-actions/window.ts` | (3) only Done (`pass`) ends the hit PC's turn: after "Don't mark" / OK (`noArmor`) the target stays owed an answer while a card or feature still fits (`answerScope`, `awaiting`). (6) a slot substitute (Stable, Celestial Wings) is the armor answer only when the hit allows one Armor Slot; when it allows more (`slotAllowance`: I Am Your Shield "any", Iron Will +1) and the PC can mark one, the substitute replaces ONE slot and the rest are still asked for (`armorAnswered`, `targetPrompt.maxSlots` one lower); a substitute is refused after another one or after real slots that fill the allowance (`substituteBlocked`, replaces `armorReductionTaken`). New `targetArmorPreview`: the "mark N" preview counts the severity steps and "N fewer HP" answers already folded in. |
| `convex/lib/incomingHits.ts` | `hitView` uses `targetArmorPreview` for the hit PC's armor preview (Stable's step before the remaining slot shows). |
| `src/components/combat-map/actions/reactions/model.ts` | `afterAnswer` (optimistic `pending`): Don't / OK behaves like a marked slot (cards and features still listed, `armorAnswered`), only Done ends it. The prompt already shows "Armor answered … or Done" for that state. |
| `tests/convex/feature-reactions.test.ts` | Don't mark keeps the window open (dwarf: Increased Fortitude still offered, a second armor answer refused, Done resolves: 3 HP); Don't mark then Increased Fortitude (2 HP); Iron Will + Stable in both orders (Severe → Minor, 1 HP, 1 slot, the Focus spent; one slot left after Stable, its preview, 2 slots refused INVALID); both of Iron Will's slots marked: Stable no longer fits. |

Tests updated outside `owns` (the bead asks for it: "update the Get Back Up convex tests that expected the turn to
end"); the orchestrator should accept these three or move them:

- `tests/convex/adversary-actions.test.ts`: the arena clears the fixture warriors' loadout (their Get Back Up fits a
  Severe hit, and the Bear's damage is rolled, so "Don't mark" would leave the window open at random). No test there
  used the default loadout.
- `tests/convex/combat-cards.test.ts`: Book of Grynn on Bryn: after "Don't mark", Done if the window is still open.
- `tests/unit/feature-window.test.ts`: "Don't mark ends the turn" became "Don't mark keeps the fitting answers until
  Done".

## Book quotes and answers used

- User answer 2026-10-30 (dcm-bxp.99.19.55 (3)): "'Don't mark' (or OK) keeps the hit PC's window open with their other
  fitting reactions until Done, like after marking a slot".
- User answer 2026-10-30 (dcm-bxp.99.19.55 (6)): "When a hit allows more than one Armor Slot … Stable or Celestial Wings
  may replace ONE of those slots and the others can still be marked".
- I Am Your Shield (CB p.341; the bead cites its card number 252): "When you take damage from this attack, you can mark any number of Armor Slots."
- Iron Will (CB p.36): "When you take physical damage, you can mark an additional Armor Slot to reduce the severity."
- Stable (HF p.12): "You can spend a Focus instead of an Armor Slot to reduce damage."
- Celestial Wings (HF p.19): "Once per scene while flying, you can spend a Hope instead of marking an Armor Slot."
- CB p.114: one Armor Slot per hit unless an effect says otherwise.

## Decisions

- After "Don't mark" a slot substitute (Stable, Wings) still fits: the PC declined a real slot, not the reduction.
- Order is free (CB p.107): Stable before or after the real slots. With one slot allowed the DA8 rule stands (Stable OR
  the slot, never both), and Stable first still closes the armor question, so Iron Will can't follow it (as built).
- "More than one slot" is the allowance (1 + extra, or "any"), not the free slots; with no free slot left the substitute
  is the whole armor answer.

## Not built: dcm-22q (Grace-Touched, rule question)

CB p.335 Grace-Touched: "When 4 or more of the domain cards in your loadout are from the Grace domain, gain the following
benefits: • You can mark an Armor Slot instead of marking a Stress. …"

The swap is optional ("you can") and needs a free Armor Slot, so folding it into the Stress-mark call sites
(`markStressOn`, `unshake`, `unshakePlan` in `convex/lib/unshakable.ts`) means deciding how the player chooses. That is
not specified (CE-grace question 7 was never answered), so this tracer didn't guess. Questions for the user:

1. How is it used? (a) automatically: each Stress the server would mark becomes an Armor Slot while one is free; (b) asked
   each time (a prompt "Mark an Armor Slot instead?" before the Stress lands); (c) a toggle on the sheet, on = automatic.
2. Which Stress? (a) every Stress (card and feature costs, a hit's Stress, riders); (b) only Stress forced on the PC.
3. With Unshakable (CB p.59) too: roll the d6s first, and swap only the Stress still marked? (a) yes; (b) swap first.

No vocabulary change is needed: `wouldMarkStress` exists in `src/lib/domain/card-effects/types.ts` (DA0 / SD0 NV6), and
the Grace entry (`src/lib/srd/card-effects/grace.ts`, not this lane's file) would move to it in a data lane.

## Follow-ups

- dcm-22q stays open with the questions above.
