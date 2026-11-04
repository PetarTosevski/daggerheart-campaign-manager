# TASK-LN3-V3: vocabulary widen 3 (plan lanes-2, wave 9)

Branch `lane3-v3`, lane `w3-vocabulary`. Types only, widen only, no behaviour change.

## What landed

- `src/lib/domain/adversary-effects/types.ts`: `AdversaryTrigger` gains
  `{ kind: "pcEscapes"; name?: string; condition?: ConditionRef; within?: Range }` (dcm-j63t). It answers a card
  `tokens.escape` (Encumber, CB p.218; Drain and Multiply spawns a Minion per bramble token removed). The event's token
  count is `trigger.amount` (read with the `triggerAmount` number source).
- `ADVERSARY_TRIGGER_KINDS` lists `"pcEscapes"`. It sits after `"situation"`, **before** V's four kinds, because
  `tests/unit/card-effects/types-widen.test.ts` (not owned) checks that V's kinds are the last four.
- `tests/unit/card-effects/types-widen-3.test.ts`: fixtures for every narrowing and Drain and Multiply written as an
  `auto` use (`summon`, count `triggerAmount`), plus a check on the kind list.
- `card-effects/types.ts` and `feature-effects/types.ts`: unchanged (nothing else was asked for).

## Beads

- dcm-j63t: the vocabulary half is done. The bead stays open until E7.3 adds the `matchesTrigger` case and the escape
  roll's server sends the event (wave 10, lane `w1-e7-adversary-engine`).

## Breaks an exhaustive switch outside owns (reported, not edited)

`pnpm typecheck` on this branch fails with exactly one error:

```
src/lib/domain/adversary-actions/features.ts(439,83): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
```

`matchesTrigger` switches over every `trigger.kind` and has no `pcEscapes` case. E7.3 owns that file in wave 9. When the
orchestrator merges V3, it should add the case in the same merge so `rebuild` typechecks. The smallest fix keeps today's
behaviour (the GM fires the reaction by hand):

```ts
    case "pcEscapes":
      // V3 (dcm-j63t): matched by E7.3 in wave 10.
      return false;
```

What E7.3 will need for the real match: the event (`AdversaryEvent` pcEscapes) carries `condition?: string`, but the
trigger carries `condition?: ConditionRef`. Either widen the event to `ConditionRef` or compare by name. A sketch:
`nameOk(trigger.name, e.name) && within(e.band, trigger.within) && (condition check)`.

## Follow-ups

- dcm-0hlq (lane `w1-e7-adversary-engine`, wave 10 E7.3; discovered from dcm-j63t): the `matchesTrigger` pcEscapes case, the event's `condition` type, and the
  escape roll's server sending the event (amount = tokens). This is dcm-j63t's open half.

## Data switches ready for wave 10

- Tangle Bramble Swarm's Drain and Multiply (CB p.218) can be written as `auto` on `{ kind: "pcEscapes", name: "bramble" }`
  once E7.3 matches it. Until then it keeps its manual reminder (dcm-s9md).

## QUESTIONS

- None.

## Checks

- `pnpm lint`: clean.
- `pnpm typecheck`: one error, the `features.ts` switch above (expected; outside owns).
- `pnpm test --maxWorkers=1 --testTimeout=120000`: 393 files, 9579 passed, 1 expected fail.
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml V3 rebuild HEAD`: OK.
