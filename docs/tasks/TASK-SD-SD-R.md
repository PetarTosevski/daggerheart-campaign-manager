# TASK SD-R: Rest-time heritage features in the rest flow (Q15 b)

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD-R (depends on SD1, FE-ancestry-core, FE-heritage-hf; bead dcm-bxp.99.19).
Book pages are printed pages. CB = Core Book, HF = Hope & Fear.

## Book texts

- Hardy (Frostborne, HF p.29): "When you take a rest, you clear a Hit Point."
- Efficient (Clank, CB p.53): "When you take a short rest, you can choose a long rest move instead of a short rest move."
- Celestial Trance (Elf, CB p.56): "During a rest, you can drop into a trance to choose an additional downtime move."
- Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take the
  higher result."
- CB p.105: "If a short rest is interrupted (such as by an adversary's attack), characters don't gain its benefits. If a
  long rest is interrupted, the characters instead gain the benefits of a short rest".

## What landed

| File | What |
|------|------|
| `src/lib/domain/rest/feature-moves.ts` | Pure. `restFeaturesOf(sheet, scope)` reads `owned()` (mixed ancestries, Shapeshifter and the Hope & Fear option resolve as in the drawer) for the four rest-trigger ids of FE-ancestry-core / FE-heritage-hf. `efficientMoves`, `restMoveSlots`, `validateFeatureChoice` (2 moves, 3 with Celestial Trance, at most one Efficient move), `applyHardy`, `applyMovesWithOasis` |
| `convex/rests.ts` | `current.open.moves[]` gains `efficient` (the long rest moves a Clank can take one of), `slots` (2 or 3) and `oasis`. `choose` gains an optional `efficient` flag and checks through `validateFeatureChoice`. `applyRest` runs Oasis on the moves' dice and Hardy after `restedSheet`, in the same transaction and the rest's actionLog group, so `undo` reverts them with the rest. An interrupted long rest runs as a short rest (Oasis applies, the trance's third move is converted like the others, Hardy applies); an interrupted short rest gives nothing |
| `src/components/party/rest/picker.tsx`, `rest.css` | "Drop into a trance" adds a "Trance move" slot; "Use Efficient" shows the long rest moves, greys the other slots' long rest moves once one slot holds one, and sends `efficient: true`; the Oasis note. Toggles are 44 px; disabled chips are dimmed |
| `tests/unit/rest-feature-moves.test.ts` | Domain tests per feature with the book texts, mixed ancestries, the Hope & Fear option; picker tests (trance slot, Efficient toggle and the one-move limit, the args sent) |
| `tests/convex/rests-features.test.ts` | Hardy on short and long rests and its undo, Hardy without Hope & Fear, Efficient (offered, used, one move, not held), Celestial Trance on both rests, Oasis for an ally, a lower reroll, none on a long rest, and an interrupted long rest (Hardy, Oasis, trance) versus an interrupted short rest |

Every existing rests test passes unchanged. The test parties of `tests/convex/rests.test.ts` and
`rest-frame-hooks.test.ts` are Clanks (the first Core ancestry), so Efficient is opt-in (`choose`'s `efficient` flag, the
picker's "Use Efficient") and its moves are a separate `efficient` list: without the flag a Clank's short rest checks
exactly as before.

## Not done: the Oasis "Reroll (keep higher)" button

The acceptance asks for an Oasis "Reroll (keep higher)" button on a rolled downtime die. The server rolls the downtime
dice inside `finish` and applies them in the same mutation, so no rolled die exists before the rest is over. A button
needs either:

1. a new public mutation (for example `rests.oasisReroll`) after `finish`, plus the per-die results stored somewhere
   (`rests` or `restChoices`, `convex/lib/validators/rests.ts`), plus its row in `tests/convex/authz/play.entries.ts`; or
2. a dice step before the rest ends (roll at `choose`, store the dice, apply at `finish`), also a schema change.

Both touch files outside SD-R's `owns` (the schema validators and the authz entries), so this tracer applies Oasis
automatically at `finish`: each holder rerolls the lowest downtime die the party rolled that no holder rerolled yet, and
keeps the higher result; the holder's log row says which die, both results and the kept one. The picker shows a note,
not a button. **Follow-up for the orchestrator:** a tracer that owns `convex/lib/validators/rests.ts` and the play authz
entries, if the user wants the player to pick the die (QUESTION 1).

## QUESTIONS

1. **Oasis: who picks the die, and when?** HF p.27: "you or an ally can reroll a die used for a downtime move and take the
   higher result." The book doesn't say who picks the die. SD-R picks it for the player: the lowest die not yet
   rerolled. With several Duneborne PCs, each holder rerolls one die. Should the player pick the die after seeing the
   dice (option 1 or 2 above)? Is it one reroll per holder per short rest?
2. **Efficient: one long rest move or both?** CB p.53: "you can choose a long rest move instead of a short rest move."
   SD-R reads the singular literally: at most one of the two (or three) moves is a long rest move. Prepare and Prepare
   together are on both lists and count as short rest moves.
3. **Efficient on an interrupted long rest.** CB p.105 gives an interrupted long rest "the benefits of a short rest".
   SD-R converts every long rest move to its short rest counterpart, as `interruptedMoves` does for everyone, so a Clank
   keeps no long rest move. Should Efficient let a Clank keep one long rest move (for example Tend to All Wounds)?
4. **Hardy on an interrupted short rest.** "When you take a rest, you clear a Hit Point" (HF p.29). An interrupted short
   rest gives no benefits (CB p.105), so SD-R gives no Hardy there. An interrupted long rest gives Hardy once.
5. **Celestial Trance and frame rules.** The trance's third move uses the same move list (frame and class moves
   included, forbidden moves excluded). On an interrupted long rest it is converted like the other two.
