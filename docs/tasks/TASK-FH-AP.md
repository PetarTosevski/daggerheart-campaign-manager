# TASK-FH-AP: per-ally picks answered on each ally's own screen

Plan `.omc/plans/finish-hud-lk.yaml`, tracer FH-AP (bead dcm-bxp.99.32.24). Board CmpPicking 'After the roll'
("Rousing Strike · each ally picks their own", "2 of 3 chose", "waiting…"). Status: Review.

## User decisions (2026-11-05)

1. Scope both: PC cards / features whose allies each choose become `choose` steps with `by`; adversary features that
   already carry `by` go to each targeted PC's screen.
2. The whole card / feature waits: nothing applies until every chooser answered (like a reaction window).
3. A chooser who doesn't answer: the GM answers that pick from the GM queue (the GM can answer any outstanding pick).
4. Only that chooser's player or the GM may answer (`permissionFor` through `loadCharacter` / the wrapper).
5. Undo of the use cancels outstanding picks; the encounter's end follows reaction windows: `closeEncounterRequests`
   declines every open request of the encounter, picks included.

## Cards and features changed (data)

| Entry | Text | Now |
|---|---|---|
| Rousing Strike (Valor 5, CB p.342) | "Once per rest, when you critically succeed on an attack, you and all allies who can see or hear you can clear a Hit Point or 1d4 Stress." | one `choose` `rousing`, `by: selfAndAllies` (every PC on the map), options clear a HP / clear 1d4 Stress on the chooser |
| Critical Inspiration (Valor 3, CB p.341) | "Once per rest, when you critically succeed on an attack, all allies within Very Close range can clear a Stress or gain a Hope." | one `choose` `inspiration`, `by: allies` (every PC within Very Close), options clear a Stress / gain a Hope |
| Maestro (Troubadour, CB p.28) | "When you give a Rally Die to an ally, they can gain a Hope or clear a Stress." | `choose` `benefit` with `by: triggerSubject`. The engine never fires `whenYouGiveDie` yet, so no pick opens for it today. |

Adversary features already written with `by` (now held for the PCs' picks): Locust Swarm (Harbinger of Pestilence),
Awesome Size (Gargantuan War Machine), Elemental Breath's Fire head (Dragon Mother Mitera). Money Talks' "pay instead"
is an `optional` with `by`: it was already the hit PC's own `gold` grant in their reaction window (no change).

## Server

- `combatRequests` kind `allyPick` (widened; payload `allyPickPayloadValidator`, `schemaVersion: 1`): the choosers
  (step, chooser id, character, name, options), the answers, and what runs afterwards: a PC rider (`rider`, its choices,
  the attack's roll, the attack's row) or an adversary feature use (`adversary`, `useFeature`'s arguments and the dice
  its first run rolled). No migration (a new union member; no existing rows change).
- `convex/lib/allyPicks.ts`: `riderHasOwnPicks`, `openRiderAllyPicks` (after a weapon attack, `convex/lib/combatActions.ts`,
  or a card attack's `post`, `convex/combatCards.ts`; the server names the allies from the `by` pick's range),
  `holdForAllyPicks` (adversary uses that are not attacks, `adversaryAction`; returns `picks: requestId`, logs a GM
  "waiting for …" row), `answerAllyPick` (the last pick runs the rider whole on the stored roll, or the feature again with
  `chooserOptions` and its dice replayed first, in the use's group).
- `allyPicks.answer` (keyed campaign mutation, view / owner, rate limit `roll`) and `allyPicksReads.open` (campaign
  query, `returns` validator; a player sees their characters' picks and their own waiting uses, the GM everything).
- Undo: `declineGroupHits` (`convex/lib/actionLog.ts`) declines open `allyPick` rows of the undone group. Encounter end:
  `closeEncounterRequests` (unchanged). A row whose group was undone or whose encounter ended is declined on answer.
- A rider whose choosers pick no longer shows its `by` choose in the Attack bar's rider options (`riderOptions`).

## HUD

- `hud/ally-picks/`: `HudAllyPicks` (players; mounted in the shell after the result panel): one card per own pick
  (chips, Choose, optimistic drop) and the actor's "n of m chose · waiting…" line with the names it waits on.
- GM queue (`hud/queue`): one card per outstanding pick (`kind: "allyPick"`, the same `AllyPickCard` on the GM tone).

## Tests

- `tests/convex/ally-picks.test.ts` (8): wait, ally answers, GM answers a no-show, refusals (other player FORBIDDEN,
  outsider NOT_FOUND, twice NOT_A_RESPONDER, wrong option INVALID), undo cancels, encounter end, no critical no pick,
  Awesome Size held and applied, its undo.
- `tests/convex/authz/ally-picks.entries.ts` (+ runner): both public functions.
- `tests/unit/hud/ally-picks.test.tsx`: model, the player's pick card, the actor's waiting line, the GM's queue card.
- `tests/e2e/live-ally-picks.spec.ts`: GM uses Awesome Size; the player answers on their own screen; the GM's queue
  card goes; Hope comes off.
- Updated: `tests/unit/card-effects/valor.test.ts`, `tests/unit/feature-effects/bard-wizard.test.ts`, the queue tests'
  mocked reads.

## Merge-time actions

- Regenerate `convex/_generated` (two new modules). `docs/data-model.md`: the `allyPick` request kind.
