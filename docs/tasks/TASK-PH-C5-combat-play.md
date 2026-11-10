# TASK-PH-C5: combat map play (player)

Tracer C5-combat-play. Branch `phone/C5-combat-play` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c5-combat-play`,
branched from `phone/A1-on-master`. Not committed.

## What changed

The phone combat map **play slot** replaces the stub for players whose
`combatVision.playerView` is `ok` on the live map:

- Move and turn the player's own token (`combatTokens.move`, `combatTokens.turn`).
- Pick a visible enemy target, play loadout cards that fire without a dialog
  (`combatCards.hand`, `combatCards.useCard`), and attack with equipped weapons
  (`characters.get`, `combatActions.attack`).
- Answer incoming hits (`adversaryActions.pending`, `adversaryActions.respond`),
  reusing the sheet incoming-hit UI.

GM-only combat functions are not subscribed or called (harness + `scanGmFunctions`).

## Queries (play slot, player)

| Subscribes |
| --- |
| `combatCards.hand` |
| `characters.get` |
| `adversaryActions.pending` |

Screen-level queries (`campaigns:get`, `combatMaps.live`, `combatVision.playerView`)
are unchanged from C4.

## Tests

- `apps/mobile/test/features/combat-play/play.roles.test.tsx`
- `apps/mobile/test/features/combat-play/token.test.tsx`
- `apps/mobile/test/features/combat-play/hand.test.tsx`
- `apps/mobile/test/features/combat-play/attack.test.tsx`
- `apps/mobile/test/features/combat-play/reactions.test.tsx`

## Validation

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` (Node v24.22.2, `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`) | ESLint (warnings only, pre-existing in `combat-view/view.roles.test.tsx`) and `tsc --noEmit` pass. Jest: **242 tests pass**; `test/features/world/view.roles.test.tsx` **fails to load** (RNGH + reanimated mock, pre-existing). `combat-play/*`, `combat-view/*` pass. Exit 1 only because of the world suite load failure. |
| `pnpm test tests/convex/codex.test.ts` | Vitest runs; **1 test failed** (`codex.list` image URLs assertion at line 392). File not edited. |

## Not done

Cards that need the website dialog, map dice, and minion picks stay on the website.
