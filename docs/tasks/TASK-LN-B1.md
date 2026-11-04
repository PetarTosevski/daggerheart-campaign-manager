# TASK LN-B1: server prompts - Warden expiry, Charge hits every enemy in Melee, drawer wiring

Plan `.omc/plans/lanes.yaml`, tracer B1 (lane `w0-b-server-prompts`). Beads dcm-bxp.99.19.55 items (1) and (2), and
dcm-bxp.99.19.56. DA13 (Cannonball) was merged into `rebuild` by the orchestrator (9c65630) before this tracer started.
Builds on DA12 (docs/tasks/TASK-DA-DA12.md). Book pages are printed pages (CB = Core Book).

Status: Review.

## Rules and answers

- CB p.31, Warden's Protection: "Once per long rest, spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close
  range." User 2026-10-30 (dcm-bxp.99.19.55 (1)): the rolled 1d4 stays valid until it is used or the scene ends, with no
  time limit.
- CB p.59, Charge: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or
  more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range." User 2026-10-30
  (dcm-bxp.99.19.55 (2)): the Stress's 1d12 hits every enemy within Melee range of the landing square, whatever the
  Firbolg's facing or sight. Blocked path, as built: walls and closed doors on the straight line refuse a player's
  Charge, the GM passes; creatures and difficult terrain don't block.

## What was built

| Piece | Where | What |
|---|---|---|
| Warden's roll lasts the scene | `convex/lib/featurePrompts.ts` | There is no scene record (`endScene` keeps no id), and `combatScenes.ts` and the payload validator belong to lane A1. So the roll's "scene id" is a mark on the roller's sheet: `rollAndStoreCount` adds the `featureUses` entry `rolledCount:<requestId>` until `scene`. Every scene end (End scene on the map, the Encounter tab or the dashboard, an encounter's end, a session's end) drops it through `expire(sheet, "scene" / "session")`, so no edit to those paths. The check is lazy: `liveTargetCount` takes the roll whose mark is on the sheet. No TTL: `expiresAt` is written as `TARGET_COUNT_NO_EXPIRY` and not read. A roll whose mark is gone is declined by the next roll, which also drops stale marks. |
| The use spends the mark | `convex/lib/featureRunner.ts` `resolveFeatureUse` | `spendTargetCount` checks against the use's sheet and returns the row. The mark leaves the sheet with the use. Undo of the use puts the mark back, but the row stays resolved, so nothing is reopened. The mark ends with the scene. |
| Charge hits every enemy in Melee | `convex/featurePrompts.ts` `charge` | `buildRun` gets `sightless(scene)`: no sight blockers, no cover objects, enemy vision tokens counted as seen. The entry's "all enemies in Melee range" then lists every enemy within Melee range of the square, behind the token or not. Every other use keeps `buildRun`'s usual checks (cardRunner.ts is lane A1's file and is not changed). With no cover there is also no cover disadvantage on the Agility Roll. |
| Blocked path | `squareProblem` (shared by `charge` and `chargeOptions`) | Same rules as DA12, now in one function: on the map, free of tokens, in Melee range of the target, and `checkMove` not blocked unless the caller is the GM. |
| Drawer data | `featurePrompts.targetCount` (changed), `featurePrompts.chargeOptions` (new) | `targetCount` takes an optional `mapId` and returns `{ roll: { requestId, count } \| null, allies: [{ tokenId, name, inRange }] }`. The `allies` are the PCs on the live map, with whether each is within the use's range of the character's token. `chargeOptions` returns the enemies the Firbolg sees at Far or Very Far range: name, band, and the free squares in Melee range of each that `charge` would accept, labelled by compass side ("west"). Blocked ways are left out for a player. Names and squares only (U1). |
| Drawer UI | `src/components/combat-map/drawer/use/**` (`FeatureUse`, `model.ts`, `use.css`) | The list's Use button already opens `FeatureUse`, which until now rendered nothing (SD7). It now renders a panel for the two server-decided uses and nothing for any other use. **Warden's Protection:** "Roll the number of allies" (`rollCount`). Then "Rolled N: up to N allies within Close range. The roll holds until you use it or the scene ends." Ally check boxes: out-of-range allies disabled, at most N. Then "Use Warden's Protection" (`combatFeatures.useFeature`). An optimistic update drops the roll at once. **Charge:** "Charge at" (the target and its band), "Square in Melee range" ("West of Bear"), the Stress check box (on by default), and for the GM "Difficulty of the Agility Roll". Then "Roll Agility and charge" (`featurePrompts.charge`). The result line says Hit / Defeated by name, or "the Agility Roll failed, the token stays". A player sees "The GM sets the Difficulty of the Agility Roll: ask the GM to play Charge for you" (see QUESTIONS 1). Controls are 44 px high. Without a live map: "Needs the live map." |

## Public functions (authz: tests/convex/authz/prompts.entries.ts)

- New: `featurePrompts.chargeOptions` (view, then edit on the character: another player FORBIDDEN).
- Changed: `featurePrompts.targetCount` (optional `mapId`, new return shape), `featurePrompts.rollCount` (returns no
  `expiresAt`; writes the scene mark on the sheet), `featurePrompts.charge` (targets regardless of sight),
  `combatFeatures.useFeature` (Warden's roll checked against the scene mark).

## Tests

- `tests/convex/feature-prompts.test.ts` (13):
  - Warden's Protection: `targetCount`'s ally list (in range). A roll survives a 5-hour-old `createdAt` (no TTL). End
    scene removes it: the use is refused with nothing paid. Undoing the scene end brings it back. After another scene
    end, the next roll declines the stale row. The use takes the mark off the sheet.
  - Charge: a third Bear behind the token is hit too. This test fails on the old code: checked by building from the real
    scene. A painted wall on the way: the player gets MOVE_BLOCKED and the token stays; the GM charges through.
    `chargeOptions`: the Far Bears are listed, the Close one is not; the squares include (11, 10) "west" and (13, 9)
    "north-east"; the occupied square is excluded (7 of 8).
  - The DA12 tests are unchanged apart from the `targetCount` shape.
- `tests/unit/drawer-use.test.tsx` (8): the model (`serverUseOf`, `validAllies`, `squareLabels`, `chargeLine`); Warden's
  roll intent, the ally pick (out of range disabled, capped at the count), the use intent and its optimistic update;
  Charge's GM intent (target, square, Stress, Difficulty), the player's note, the empty state, and nothing rendered for
  another feature.
- `tests/convex/authz/prompts.entries.ts`: a `chargeOptions` row.

## Ownership

Files changed outside B1's `owns` (all tests; the orchestrator should accept them at the merge):
- `tests/convex/feature-prompts.test.ts`: its DA12 test pinned the 30-minute TTL ("an expired roll…") and
  `targetCount`'s old return. Both contradict the user's answer, so `pnpm test` can't pass without the edit.
- `tests/convex/authz/prompts.entries.ts`: the inventory guard fails `pnpm test` for a public function without a row.
- `tests/unit/drawer-use.test.tsx`: new, the drawer UI's tests.

## Not built

- **Charge ending Cloaked** (dcm-bxp.99.19.56): `uncloakAfterMove` is in convex/lib/combatMovement.ts (lane C1, which
  is rewriting it for DA18). It writes its own feed row, which would make the Charge's undo stale. Follow-up
  **dcm-bxp.99.19.59** (lane:w0-c-cloaked): give it a `groupId`; then `charge` calls it after a successful move.
- **The payload's `expiresAt`** is still required by `targetCountPayloadValidator` (lane A1's file), and its comment
  names the removed TTL. Follow-up **dcm-bxp.99.19.60** (lane:w0-a-drawer-engine): widen to optional, migrate, narrow.
- No e2e spec: tests/e2e is outside `owns`, and the unit and convex tests cover the flow. An e2e spec like
  combat-cannonball.spec.ts (the GM plays Charge for a Firbolg, a player rolls Warden's count) would be a follow-up.
- The map pick of Charge's square (clicking the board) is not built: the drawer lists the squares by side instead. The
  map view is outside `owns`.

## Known edges

- The scene mark is written without a feed row (the roll writes none). Undoing an action logged before the roll
  restores that action's `before` sheet, which has no mark, so the roll is lost and the player rolls again. Undoing a
  scene end puts the mark, and the roll, back.
- Charge's results list every enemy in Melee range, so a player learns that an unseen adversary next to the square was
  hit. That follows from "regardless of sight". The result line names only the enemies the drawer listed and calls the
  others "Target".

## QUESTIONS

1. **Who sets the Difficulty of a player's Charge?** CB p.59 names no Difficulty for the Agility Roll. DA12 built
   `charge` to require the GM's `roll.difficulty`, so today only the GM (playing for the Firbolg) can Charge from the
   drawer, and a player is told to ask the GM. Should a player's Charge wait for the GM's Difficulty (a request the GM
   answers, as the sanction queue), or roll at once with the Difficulty the GM set earlier for the scene?
