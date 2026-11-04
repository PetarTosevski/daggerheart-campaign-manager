# TASK LN2-R1: table reminders beside SRD-C1's new data (dcm-s9md)

Plan `.omc/plans/lanes-2.yaml`, tracer R1 (lane `w2-srd-data`), wave 8. User answer 2026-10-31: SRD-C1
(`docs/tasks/TASK-LN-SRD-C1.md`) switched some cards to data the server doesn't act on yet, so their reminder went
silent. Each card below keeps its new data and gets back a `manual` step with the card's words, next to it, marked in
the source with a `Lanes-2 R1 (dcm-s9md)` comment naming the engine bead whose merge lets it go (wave 9 removes them).

## What is shown today

`run.ts` turns a `manual` step, and the not-yet-run outcome steps (`exhaust`, `loadout`, ...), into a `prompt` with
`prompt: "manual"`; the Hand's card row shows those (`convex/lib/cardRows.ts` `promptsOf`). An `endEffect` step becomes
an `endEffect` plan step, which no server code applies yet and `promptsOf` doesn't show; a `tokens` step's `note` is not
a prompt either. So:

| Card (page) | File / use | Silent data | Reminder restored | Remove when |
|---|---|---|---|---|
| Confusing Aura (CB p.329) | arcana `confusing-aura` / `attacked`, the all-4-or-lower branch | `endEffect` | "All the results are 4 or lower: you take the damage and this spell ends (remove the Confusing Aura effect)." | dcm-9z2z (apply `endEffect`) |
| Flight (CB p.328) | arcana `flight` / `spend` | Flying `endsOn: ["tokensGone"]`; the token step's note | "If that was the last Flight token: after the action that spends the last token is resolved, you descend to the ground directly below you (end Flying)." | dcm-erhv (`tokensGone` for a card's sheet effect) |
| Time Lock (CB p.333) | codex `book-of-grynn` / `time-lock-maintain`, on a failure | `endEffect` | "Time Lock isn't maintained: the creature moves the object and the spell ends (remove the Time Lock effect)." | dcm-9z2z |

The Time Lock cast itself is not silent: its self effect "Time Lock" (until your next rest) is written on the sheet.

## Rune Ward: no step added (it would double)

Rune Ward's two `exhaust` steps carry the card's words as `note`, and run.ts's fallback shows an `exhaust` as a manual
prompt with that note (`case "exhaust"` in run.ts, until dcm-a9c writes it). The plan already holds exactly the text the
old manual step had, so a restored step would show it twice. The test pins the two texts.

Seen while checking: a card answered in the incoming-hit window (`convex/lib/incomingHits.ts`, `choice.kind === "card"`)
logs only "uses <card>" and its folds; unlike a feature answer it doesn't add `manualWords(plan)` to the line. That was
true before SRD-C1 too (the old Rune Ward manual step was equally unseen there), and the file isn't this tracer's: it is
for the orchestrator to file or fold into dcm-a9c.

## Not done here: files outside this tracer's `owns`

Three cards of dcm-s9md live in files this tracer doesn't own (`owns` lists arcana, codex and blade; blade has none of
the cards):

| Card | File | Silent data | Engine bead |
|---|---|---|---|
| Avatar of Terror (HF p.181) | `src/lib/srd/card-effects/dread.ts` | `endEffect` | dcm-9z2z |
| Breaking Blow (CB p.331) | `src/lib/srd/card-effects/bone.ts` | the mark's `attackedRider` | dcm-yd5h |
| Invisibility (CB p.334) | `src/lib/srd/card-effects/grace.ts` | Invisible `endsOn: ["tokensGone"]` | dcm-erhv |

They need a tracer that owns those files (and their tests): follow-up bead dcm-ky8b (lane:w2-srd-data).

## Tests

- `tests/unit/card-effects/arcana.test.ts`: Flight's spend shows the one reminder; Confusing Aura's broken aura shows
  the `endEffect` and the one reminder, a holding layer none; Rune Ward on an 8 shows exactly the two exhaust notes.
- `tests/unit/card-effects/codex.test.ts`: Time Lock's failed maintain shows the `endEffect` and the one reminder; a
  held one neither.
- `coverage.test.ts` passes (3 more manual steps).

## Checks

`pnpm lint`, `pnpm typecheck`; `pnpm vitest run tests/unit/card-effects/` (627/627) and
`tests/convex/combat-cards.test.ts` with `tests/convex/adversary-actions.test.ts` (73/73); full `pnpm test` as reported
in the handoff.
