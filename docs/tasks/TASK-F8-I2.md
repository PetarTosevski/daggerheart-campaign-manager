# TASK I2: Adversary side-effect flash for PCs

Plan `.omc/plans/followups-8.yaml`, tracer I2 (wave 1, no dependencies). Bead `dcm-bxp.99.26`. Status: Review.

## User answer implemented (bead notes, 2026-10-23)

- "a PC whose sheet an adversary feature changed, without being a named target, also gets a target entry with tone
  'effect' and flashes. H3 retry timing (3 retries ~6 s) kept as built." (TASK-F7-H3 QUESTIONS 1 and 2.)

## What changed

| File | What |
|------|------|
| `convex/lib/adversaryActions.ts` | `publicTargets` adds, after the named creatures and the changed allies, the live map's token of every PC in `w.sheets` (each PC whose sheet the action changed: a picked or follow-up PC, a trigger's subject) with tone "effect". A named PC is already in the list and keeps its hit / miss / effect tone (entries dedupe by token id). PCs without a token on the live map are left out; no live map, no field, as in H3. |

Nothing else changed: the client (`newActionFlashes`, `HitFlashLayer`) already flashes a PC `effect` entry ("!") for
players and the GM, and `feed.list` already passes PC entries to players. No new public function, argument validator,
error code, index or migration. The retry timing of the incoming-hit prompt stays as built (user answer).

Not covered: automatic uses after a hit resolves (`afterHitTriggers`) write no public summary row, so they have no
`targets` to extend; their only target is the hit PC, who already flashed from the action's row.

## What a player receives (Q14)

A token id, `side: "pc"` and `tone: "effect"`; no number. Test checks the player's and the other player's feed rows
carry no `ROLL_KEYS`.

## Tests

- `tests/convex/adversary-actions.test.ts`, describe "the public row's target token ids (followups-7 H3)" (3 new):
  Minor Demon's All Must Fall (CB p.215) fired with no named targets and Ash as the trigger's subject: Ash loses a Hope
  and the public row carries `{ tokenId: ash, side: "pc", tone: "effect" }`, which both players' `feed.list` receive
  with no numbers; Ash named and changed is listed once; a changed PC without a token on the live map is left out.
- `tests/unit/adversary-panel.test.tsx` (1 new): a row naming nobody with a PC `effect` entry flashes "!" on that token
  for a player and for the GM.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 286 files, 7717 passed, 1 expected fail.
- `pnpm tracer:guard .omc/plans/followups-8.yaml I2`: OK.
- No e2e named by the plan entry; `convex/_generated` untouched (no new public module).
