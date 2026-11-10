# TASK-BG2: undo of a paid spotlight take restores the adversary's spotlight count (dcm-iukg)

Plan `.omc/plans/p2-bugs-perf4.yaml`, tracer BG2.

- `convex/lib/validators/actionLog.ts`: `adversaryBeforeValidator` widened with optional `spotlights` and
  `spotlightTurn` (rule 7: widen only; no existing field changed).
- `convex/lib/spotlight.ts` `takeWithFear`: when the paid take marks the running encounter instance spotlit, the GM row
  carries `adversaryBefore` (the instance before the mark: `instanceId`, `hp`, `stress`, `defeated`, `spotlights`,
  `spotlightTurn`). Doc comment updated.
- `convex/lib/actionLog.ts` undo: restores `spotlights` / `spotlightTurn` when the snapshot has them. Rows without the
  fields undo as before (Fear only). The usual `UNDO_STALE` guard applies (an instance changed after the take blocks it).
- `docs/data-model.md`: the `adversaryBefore` shape lists the two fields.
- Tests (`tests/convex/rules-spotlight-undo.test.ts`): paid take on an adversary in a running encounter, then undo →
  Fear back, `spotlights` / `spotlightTurn` exactly as before, and the adversary's attack asks Fear again
  (`confirmFear`) as it did before the take; a row stripped of the new fields undoes the Fear only.

Not changed: `encounterTracking.spotlight` (the tracker's Spotlight button counting another spotlight after a paid
take); that is an open rules question for the user.
