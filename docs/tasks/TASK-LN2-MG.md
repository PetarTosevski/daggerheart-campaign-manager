# TASK LN2-MG: Vanishing Act source marker for rogues already Cloaked

Plan `.omc/plans/lanes-2.yaml`, tracer MG (lane `w0-c-cloaked`), wave 8. Beads: dcm-3ias (user answer 2026-10-31:
"write a migration").

## Change 2026-10-31 (MG2)

User answer on dcm-3ias: a rogue who used Vanishing Act, has **rested since**, and is still Cloaked (old code did not end
it on a rest; the book does: "until your next rest", CB p.42) has that Cloaked **removed** by the migration, not left as
an ordinary Cloaked. Everything else stands: a Cloaked with no traceable use in the newest 20 rows stays bare (user
confirmed), and a Cloaked turned on another way after the use (or after the rest) stays bare.

- `cloakSource` (was `cloakedByVanishingAct`) returns `"active"` (use, no rest since: marker added), `"rested"` (use,
  then a newer rest, no newer row turned Cloaked on: Cloaked removed with `withoutCondition`) or `null` (left bare).
- Each change logs its own line, so they count apart: `Vanishing Act marker added: character <id>.` and
  `Stale Vanishing Act Cloaked removed (a rest since the use): character <id>.` (`grep -c` each in the run's logs). The
  migration component's status counts rows processed, not changes. A dry run logs its one batch, then rolls it back.
- Still batched and idempotent: a sheet that is no longer Cloaked is skipped.
- Tests: the old "after a rest: untouched" case now expects removal (own test: dry run changes nothing, a `reset: true`
  rerun changes nothing, nothing else on the sheet moves); new untouched case: rest after the use, then Cloaked again the
  ordinary way.

The first two QUESTIONS below are answered (kept / changed). New (MG2): the removal writes no feed row, the same as the
marker addition (a migration repairs stored state; it is not a game action), so the player sees the Cloaked gone with no
"Cloaked ends (Vanishing Act)" line. Should the migration also write that feed line? *Answered (dcm-3wt4): yes. At merge the
orchestrator added it: each removal writes a public, not undoable `feature` row "<name>: Cloaked ends (Vanishing Act)";
the marker addition still writes none.*

## What landed

| File | What |
|------|------|
| `convex/migrations/vanishingActMarker.ts` | `addMarker`: a batched, idempotent `@convex-dev/migrations` migration over `characters`. It adds Vanishing Act's source marker (lane C2, `docs/tasks/TASK-LN-C2.md`) to a rogue Cloaked by Vanishing Act before C2's deploy. The marker is written by `writeSheetChanges` (`convex/lib/cardRunner.ts`, not edited) from the feature's own Cloaked step (`sourceEnds`: `duration: "rest"`, `endsOn: ["rollWithFear"]`), so it is exactly what a use writes today; only the sheet's `effects` change. Helper `withVanishingActMarker` is exported. |
| `tests/convex/lane-mg-vanishing-act-marker.test.ts` | 4 convex-test tests (3 before the 2026-10-31 change). Migrated: the effects after the migration equal the effects a real `combatFeatures.useFeature` wrote (marker stripped in between), nothing else on the sheet moves, and a dry run changes nothing. Not migrated: below mastery, Cloaked with no use in the feed, Cloaked again the ordinary way after the use's Cloaked ended or after a rest. Rested since the use: the Cloaked is removed. Run twice: a second run with `reset: true` changes nothing. |

No stored shape changed (the marker is an ordinary `effects` entry), so rule 7 needs no widening and no narrowing step. No
public function was added (migrations are internal; no authz-matrix entries).

## Which characters it changes

All of these must hold:

1. The sheet reads (an unreadable sheet is logged and skipped).
2. The sheet has Cloaked and no source marker for it (`conditionSources` empty). This makes it idempotent.
3. The sheet holds Vanishing Act (`owned(sheet)` includes `subclass:nightwalker:vanishing-act`: a Nightwalker at mastery).
4. The character's feed says this Cloaked is Vanishing Act's (marker added) or was Vanishing Act's and a rest since ended
   it (Cloaked removed, change 2026-10-31). Walking the newest 20 `actionLog` rows of the character
   (`by_character_at`, newest first, undone rows skipped), a row `"<name> uses Vanishing Act"` comes before
   any row whose `before` sheet was not Cloaked (Cloaked was turned on another way since). If a rest row (`kind: "rest"`,
   "Short rest" / "Long rest" / "Interrupted long rest") came after the use, the rest ended Vanishing Act's Cloaked
   (CB p.42: "until your next rest") and the Cloaked is removed; otherwise the marker is added.

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

- **Telling the source apart (the safe default).** *Answered 2026-10-31: keep it (untraceable Cloaked stays ordinary).* A Nightwalker at mastery can be Cloaked the ordinary way too (Hidden
  becomes Cloaked, CB p.42). The sheet cannot tell the two apart, so the migration reads the feed. When the feed does not
  show a Vanishing Act use as the latest way Cloaked was turned on (no use row among the newest 20, or a
  later row turned Cloaked on), the Cloaked **stays bare (ordinary)**. Reason: a marker makes a Cloaked survive the attacks
  and moves that end an ordinary Cloaked, so a wrong marker gives a rogue an advantage the book does not. A wrong bare
  Cloaked costs a Stress at most (the player uses Vanishing Act again). Should a Nightwalker at mastery who is Cloaked with
  no traceable source get the marker anyway (the user's "simpler" option in dcm-3ias)? That is a one-line change: drop
  the feed check in `addMarker`.
- **A rest since the use.** *Answered 2026-10-31: remove it (see "Change 2026-10-31").* Before C2 a rest did not end
  Vanishing Act's Cloaked, so a rogue may still be Cloaked after a rest that by the book ended it. The first version left
  that Cloaked bare (ordinary); MG2 removes it.
- **The feed limit.** Only the newest 20 rows are read (the stop-gap's limit, rule 5: `.take()`). A rogue with more than
  20 later rows that kept Cloaked stays bare.
- **The daily snapshot strip** (`cleanup.stripActionLogSnapshots`) removes old rows' `before`; such rows are skipped, so
  an older row that turned Cloaked on another way may be missed. The rows read are recent ones, where snapshots remain.

## Checks

MG2: `pnpm lint`, `pnpm typecheck`, `pnpm test` (`--maxWorkers=1 --testTimeout=120000`). No tracer guard (MG2 is an add-on,
not in `lanes-2.yaml`); the diff touches only the three owned files. Not run against any deployment.

MG:

`pnpm lint`, `pnpm typecheck`, `pnpm test` (`--maxWorkers=2 --testTimeout=120000`); `node scripts/tracer-guard.mjs
.omc/plans/lanes-2.yaml MG rebuild HEAD`.
