# TASK LN2-MG: Vanishing Act source marker for rogues already Cloaked

Plan `.omc/plans/lanes-2.yaml`, tracer MG (lane `w0-c-cloaked`), wave 8. Beads: dcm-3ias (user answer 2026-10-31:
"write a migration").

## What landed

| File | What |
|------|------|
| `convex/migrations/vanishingActMarker.ts` | `addMarker`: a batched, idempotent `@convex-dev/migrations` migration over `characters`. It adds Vanishing Act's source marker (lane C2, `docs/tasks/TASK-LN-C2.md`) to a rogue Cloaked by Vanishing Act before C2's deploy. The marker is written by `writeSheetChanges` (`convex/lib/cardRunner.ts`, not edited) from the feature's own Cloaked step (`sourceEnds`: `duration: "rest"`, `endsOn: ["rollWithFear"]`), so it is exactly what a use writes today; only the sheet's `effects` change. Helper `withVanishingActMarker` is exported. |
| `tests/convex/lane-mg-vanishing-act-marker.test.ts` | 3 convex-test tests. Migrated: the effects after the migration equal the effects a real `combatFeatures.useFeature` wrote (marker stripped in between), nothing else on the sheet moves, and a dry run changes nothing. Not migrated: below mastery, Cloaked with no use in the feed, Cloaked again the ordinary way after the use's Cloaked ended, a rest since the use. Run twice: a second run with `reset: true` changes nothing. |

No stored shape changed (the marker is an ordinary `effects` entry), so rule 7 needs no widening and no narrowing step. No
public function was added (migrations are internal; no authz-matrix entries).

## Which characters it changes

All of these must hold:

1. The sheet reads (an unreadable sheet is logged and skipped).
2. The sheet has Cloaked and no source marker for it (`conditionSources` empty). This makes it idempotent.
3. The sheet holds Vanishing Act (`owned(sheet)` includes `subclass:nightwalker:vanishing-act`: a Nightwalker at mastery).
4. The character's feed says this Cloaked is Vanishing Act's. Walking the newest 20 `actionLog` rows of the character
   (`by_character_at`, newest first, undone rows skipped), a row `"<name> uses Vanishing Act"` comes before both
   - a rest row (`kind: "rest"`, "Short rest" / "Long rest" / "Interrupted long rest"): that rest ended Vanishing Act's
     Cloaked (CB p.42: "until your next rest"), and
   - a row whose `before` sheet was not Cloaked: Cloaked was turned on another way since.

This is the stop-gap `cloakedByVanishingAct` that C2 removed from `convex/lib/combatMovement.ts`, with two changes: the
rest check, and the `before` read fixed. The stop-gap called `readSheet(row.before)`, but `before` is stored as JSON text,
so that read always failed and the stop-gap only looked for a Vanishing Act row among the newest 20. The migration parses
the JSON (`readSheet(JSON.parse(row.before))`).

## How to run it (orchestrator; not run against any deployment by this tracer)

After the deploy that carries C2 (the marker readers), once per deployment:

```
npx convex run migrations/run:run '{fn: "migrations/vanishingActMarker:addMarker", dryRun: true}'
npx convex run migrations/run:run '{fn: "migrations/vanishingActMarker:addMarker"}'
npx convex run --component migrations lib:getStatus --watch
```

Add `--prod` for production. It is idempotent, so a rerun or `reset: true` is safe. It is transient data: a rogue's
Vanishing Act Cloaked ends at the next rest anyway, so the migration matters only for rogues Cloaked right now.

## QUESTIONS

- **Telling the source apart (the safe default).** A Nightwalker at mastery can be Cloaked the ordinary way too (Hidden
  becomes Cloaked, CB p.42). The sheet cannot tell the two apart, so the migration reads the feed. When the feed does not
  show a Vanishing Act use as the latest way Cloaked was turned on (no use row among the newest 20, a rest since, or a
  later row turned Cloaked on), the Cloaked **stays bare (ordinary)**. Reason: a marker makes a Cloaked survive the attacks
  and moves that end an ordinary Cloaked, so a wrong marker gives a rogue an advantage the book does not. A wrong bare
  Cloaked costs a Stress at most (the player uses Vanishing Act again). Should a Nightwalker at mastery who is Cloaked with
  no traceable source get the marker anyway (the user's "simpler" option in dcm-3ias)? That is a one-line change: drop
  the feed check in `addMarker`.
- **A rest since the use.** Before C2 a rest did not end Vanishing Act's Cloaked, so a rogue may still be Cloaked after a
  rest that by the book ended it. The migration leaves that Cloaked bare (ordinary) rather than ending it; ending it is a
  gameplay change outside a source migration. Should such a stale Cloaked be cleared instead?
- **The feed limit.** Only the newest 20 rows are read (the stop-gap's limit, rule 5: `.take()`). A rogue with more than
  20 later rows that kept Cloaked stays bare.
- **The daily snapshot strip** (`cleanup.stripActionLogSnapshots`) removes old rows' `before`; such rows are skipped, so
  an older row that turned Cloaked on another way may be missed. The rows read are recent ones, where snapshots remain.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test` (`--maxWorkers=2 --testTimeout=120000`); `node scripts/tracer-guard.mjs
.omc/plans/lanes-2.yaml MG rebuild HEAD`.
