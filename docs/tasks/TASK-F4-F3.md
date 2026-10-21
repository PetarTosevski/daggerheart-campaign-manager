# TASK-F4-F3: Slayer Die stored at Hope max keeps the Hope (dcm-bxp.65); one featureScope helper (dcm-bxp.68)

Status: Review. dcm-bxp.68 is done. dcm-bxp.65 is reproduced, and its fix is deferred (see below).
Plan: `.omc/plans/followups-4.yaml`, tracer F3. Beads: `dcm-bxp.65` and `dcm-bxp.68`. The orchestrator closes them.

## Book rule (K2, Call of the Slayer, CB p.48)
> Slayer: You gain a pool of dice called Slayer Dice. On a roll with Hope, you can place a d6 on this card instead of
> gaining a Hope, adding the die to the pool. You can store a number of Slayer Dice equal to your Proficiency. [...]

Storing takes back exactly the Hope the roll gave. A roll that gave no Hope (Hope already at maximum after the roll's
costs, CB p.18) has nothing to take back.

## dcm-bxp.68: one featureScope (done, no behaviour change)
- `convex/lib/featureScope.ts` holds `featureScope(campaign)`. It is the only copy of the rule.
- `convex/rolls.ts` and `convex/sessions.ts` import it. Their private `scopeOf` copies are deleted.
- `convex/sessionFeatures.ts` imports it and re-exports it, so `convex/characters.ts` (not in F3's owns) keeps its
  `import { featureScope } from "./sessionFeatures"` unchanged. A later tracer that owns `characters.ts` can import
  from `./lib/featureScope` directly and drop the re-export.

## dcm-bxp.65: reproduced; the fix waits for CA0
**Cause.** `rolls.storeSlayerDie` derives the gain with `rollGaveHope(before, outcome)`. Here `before` is the roll
row's `before` sheet, which is the sheet before the roll's costs, or the current sheet when the row has none.

Example: Hope 6, then spend 1 Hope on an Experience (Hope 5), then roll with Hope (Hope 6). The roll gained a Hope.
But the sheet ended where it started, so the row has no `before`, and `rollGaveHope` reads Hope 6 as "no gain".
Storing therefore keeps the 6; it should drop to 5.

The row and the sheet cannot tell this case apart from "paid nothing at Hope 6, rolled with Hope" (no gain). Both
leave identical data, so no derivation can fix it. The roll has to record whether it gave the Hope.

**Reproduction.** `tests/convex/session-features.test.ts`, "rolls.storeSlayerDie after a roll that paid an Experience
at Hope max (dcm-bxp.65 ...)". It is `it.skip` for now. Unskipped against today's code it fails:
`expected { hope: 6, ... } to deeply equal { hope: 5, ... }`.

**Why deferred.** The fix widens `actionLogFields` in `convex/lib/validators/actionLog.ts`, and tracer CA0 owns that
file (coordinator decision, 2026-10-21). Apply the diff below after CA0 merges, then unskip the test.

**The fix (verified).** I applied this diff locally: typecheck was clean, and `session-features`,
`rolls-session-features` and `rolls` passed 48/48 with the test unskipped. Then I reverted it.

The new field is optional, so this is a pure widen: no migration and no change to existing rows. An old row without
the field falls back to today's derivation.

```diff
--- a/convex/lib/validators/actionLog.ts
+++ b/convex/lib/validators/actionLog.ts
@@ export const actionLogFields = {
   /** GM Fear this row gained (positive) or removed (negative); undo reverts it through `revertFear`. */
   fearDelta: v.optional(v.number()),
+  /** An action roll with Hope: whether it gave the Hope (false at Hope max after its costs). `rolls.storeSlayerDie` takes it back (K2, dcm-bxp.65). */
+  hopeGained: v.optional(v.boolean()),
   undoable: v.boolean(),
--- a/convex/rolls.ts
+++ b/convex/rolls.ts
@@ async function duality(...)   (the logAction call of the roll row)
     roll,
     ...(sheetChanged ? { before: sheet } : {}),
     ...(gained !== 0 ? { fearDelta: gained } : {}),
+    // `paid` is the sheet after the roll's costs and before its gains (K2: the Slayer store takes back only a gained Hope).
+    ...(args.kind === "action" && WITH_HOPE.includes(roll.outcome) ? { hopeGained: rollGaveHope(paid, roll.outcome, args.kind) } : {}),
     undoable: true,
@@ export const storeSlayerDie = keyedUserMutation({
-      // The sheet before the roll (absent: the roll changed nothing). A roll made at Hope max gave no Hope back.
+      // The roll records whether it gave the Hope (after its costs). An older row falls back to its `before` sheet
+      // (absent: the roll changed nothing); a roll made at Hope max gave no Hope back.
       const before = row.before === undefined ? sheet : readSheet(JSON.parse(row.before));
-      const next = storeDie(sheet, { hopeGained: rollGaveHope(before, row.roll.outcome, "action"), entryId: row._id });
+      const next = storeDie(sheet, { hopeGained: row.hopeGained ?? rollGaveHope(before, row.roll.outcome, "action"), entryId: row._id });
@@ export const tagTeamApply = keyedUserMutation({   (the logAction call of each result row)
           ...(i === 0 && gained !== 0 ? { fearDelta: gained } : {}),
+          ...(WITH_HOPE.includes(chosen.outcome) ? { hopeGained: rollGaveHope(sheet, chosen.outcome, "action") } : {}),
           undoable: true,
```

`tagTeamApply` already derives the gain correctly, because its result rows pay no costs. It sets the field anyway, so
every Slayer-eligible row carries it. Then change `it.skip` back to `it` in `tests/convex/session-features.test.ts`.

## Checks
`pnpm lint`, `pnpm typecheck`, `pnpm vitest run --maxWorkers=4 --testTimeout=60000` and
`pnpm tracer:guard .omc/plans/followups-4.yaml F3`.
