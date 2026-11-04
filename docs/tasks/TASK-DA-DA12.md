# TASK DA12: server-decided uses: Warden's Protection rolls 1d4 before the pick, Charge moves the token after a success

Plan `.omc/plans/drawer-answers.yaml`, tracer DA12 (beads dcm-d95, dcm-bxp.99.19.36, dcm-bxp.99.19.16). Builds on DA0
(`upTo.rolledFirst`, `rollTargetCount`, the `intoMelee` move). Book pages are printed pages (CB = Core Book).

Status: Review (implemented and tested in the worktree; the drawer UI is not in DA12's `owns`, see "Not built").

## Rules and answers

- CB p.31, Warden's Protection: "Once per long rest, spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close
  range." User 2026-10-29 (dcm-d95, D3): the server rolls the 1d4 first, then the player picks that many allies.
- CB p.59, Firbolg, Charge: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with
  one or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range." User
  2026-10-29 / 2026-10-30 (dcm-bxp.99.19.16): roll first. Before rolling, the PLAYER picks the Melee square next to the
  target. On a success the server moves the token there; on a failure there is no move. Not the nearest free square.
- CB p.103, Defined Ranges: Melee 1 square, Very Close 3, Close 6, Far 12, Very Far 13+.

## What was built

| Piece | Where | What |
|---|---|---|
| Warden's entry | `src/lib/srd/feature-effects/druid-sorcerer.ts` | `count: upTo 1d4, rolledFirst: true`. |
| Roll the count | `featurePrompts.rollCount` (keyed campaign mutation, `view` + edit on the character) | Checks ownership (`pickFeature`), a `rolledFirst` use, the limit (FEATURE_EXHAUSTED once used this long rest); rolls with `rollTargetCount` and stores an open `combatRequests` row of the new kind `targetCount` (count, `expiresAt` = now + 30 min). A second roll of the same character, feature and use is INVALID while the first is open and unexpired; an expired one is declined by the next roll. The client never sends the count. |
| Read the count | `featurePrompts.targetCount` (campaign query, `view` + edit) | The open, unexpired roll (`requestId`, `count`, `expiresAt`) or null, for the drawer after a reload. |
| The use | `combatFeatures.useFeature` → `resolveFeatureUse` (convex/lib/featureRunner.ts) → `spendTargetCount` (convex/lib/featurePrompts.ts) | Before anything is written: without an open, unexpired roll, or with more targets than it shows, COMBAT_TARGET_INVALID (the mutation writes nothing); otherwise the row is resolved and the public row's notes say "rolled N targets". The GM's approval of an out-of-range use goes through the same check. |
| Runner count | `pickFeature` (`rolledTargetCount?`) | `pickFeature` has no database access, so the pure runner gets `MAX_CARD_TARGETS` (20) as its ceiling and the stored roll is enforced by `resolveFeatureUse` above (combatFeatures.ts, which builds the pick, is outside DA12's `owns`). A caller that has the roll can pass it. |
| Charge's entry | `src/lib/srd/feature-effects/ancestry-core.ts` | Agility Roll against the GM's Difficulty; `targets` every enemy in Melee range (count all); on a success the `intoMelee` move and the optional Stress for 1d12 physical to those targets. The "situation" check box is gone: the server checks the ranges. |
| Charge | `featurePrompts.charge` (keyed campaign mutation, `view` + edit) | Args: `targetTokenId`, `square {x, y}`, `stress`, `roll` (with `difficulty`, required). Before the roll: the target is an enemy token at Far or Very Far range of the Firbolg's token; the square is on the map, free of other tokens, in Melee range of the target (1 square) and not behind a blocked way (`checkMove`; the GM may pass, as `combatTokens.move`). The token is put on the square, the run is built from there (`buildRun`: the targets are the enemies the Firbolg sees in Melee there, the picked target among them) and rolled. Success: the token stays on the square, the Stress damage (if taken) hits every one of those targets, and an open `serverMove` row keeps the square it left. Failure (or a refusal or a missing choice): the token goes back to where it stood, nothing moves. One actionLog group, as every feature use. |
| Undo | `declineGroupOffers` (convex/lib/combatRequests.ts), called by `actionLog.undo` for a group with a `combat` row | Also puts the token of an open `serverMove` row of the group back on its square (and facing) and declines the row. The character's next server move resolves the older row (`openServerMove`), so a character holds at most one. |
| `useFeature` and Charge | `pickFeature` (`serverMove?`) | A use with an `intoMelee` move is refused (INVALID) unless the caller makes the move itself, so `useFeature` can't run Charge without its square. |
| Prompts | `resolveFeatureUse` | A move the server makes (`server: true`) is not returned as a move prompt. |

Validators (widen only, convex/lib/validators/combatRequests.ts): request kinds `targetCount` and `serverMove`, payloads
`targetCountPayloadValidator` and `serverMovePayloadValidator` (schemaVersion 1), `tokenSquareValidator`. No change to
convex/schema.ts. For docs/data-model.md (orchestrator): the two kinds and their payloads.

Cleanup (rule 8): resolved and declined rows are swept by the existing `expireCombatRequests` cron. An open `targetCount`
row that is never used stays open until the next roll declines it (one per character, feature and use); an open
`serverMove` row until the next server move, its undo, or the encounter's end (`closeEncounterRequests`, it carries the
target's encounter); the campaign purge removes both.

## Public functions (authz: tests/convex/authz/prompts.entries.ts)

- New `featurePrompts.rollCount`, `featurePrompts.targetCount`, `featurePrompts.charge` (all `view` + edit on the
  character: the player or the GM; another player FORBIDDEN; outsider NOT_FOUND; anonymous UNAUTHENTICATED).
- Changed behaviour: `combatFeatures.useFeature` (Warden's Protection needs the stored roll; Charge is INVALID),
  `actionLog.undo` (restores a Charge's square).

## Tests

- tests/convex/feature-prompts.test.ts: Warden's Protection refused before the roll (nothing paid); roll stored, second
  roll INVALID, two allies on a roll of 1 refused with nothing written; a roll of 2 lets two allies clear 2 HP each, 2
  Hope paid, the row resolved, `targetCount` null, the next roll FEATURE_EXHAUSTED; an expired roll refused by the use
  and declined by the next roll; the GM rolls for the player's character; a non-rolled-first feature INVALID. Charge with
  known dice: success (Hope 9, Fear 3, Agility 2 = 14 vs 12) moves the token to the picked square, marks the Stress and
  deals the 1d12 (7, Major: 2 HP) to both Bears in Melee there, no move prompt; undo puts the token back and restores the
  Stress and the Bears; failure (7 vs 12) leaves the token, no Stress, no damage, no `serverMove` row; refusals (square out
  of Melee INVALID, occupied MOVE_BLOCKED, a target in Close range INVALID, no Difficulty INVALID); `useFeature` with Charge
  INVALID.
- tests/unit/feature-effects/druid-sorcerer.test.ts: the entry is `rolledFirst`, `rollTargetCount` rolls the 1d4, the run
  takes the server's count and refuses more allies or a missing count with no die rolled.
- tests/convex/authz/prompts.entries.ts (+ prompts.test.ts): rows for the three new functions.

## Not built

- **The drawer UI** (Roll 1d4 → pick that many allies; Charge's target and square pick on the map before the roll) is not
  in DA12's `owns` (no src/components file). The server API is ready: `rollCount` / `targetCount` then `useFeature`, and
  `charge`. Until the drawer is wired, Warden's Protection and Charge can't be used from the drawer (useFeature refuses
  both without the new step). Needs a follow-up tracer (SD7 owns src/components/combat-map/drawer/use/**).
- Cloaked: a Charge move does not call `uncloakAfterMove` (DA3): its feed row would be newer than the Charge and make the
  Charge's undo stale. A Firbolg rogue's Cloaked is left to the GM after a Charge.
- tests/e2e/combat-movement.spec.ts was run as the acceptance names (see the report); no e2e spec covers Charge, since
  there is no UI for it yet.

## QUESTIONS

1. **When does a rolled 1d4 expire?** The user said "until it is used or expires" without a time. Built: 30 minutes
   (`TARGET_COUNT_TTL_MS`), after which the use is refused and a new roll is allowed. A player could wait it out to reroll
   a low count. Should it instead last until the scene or the encounter ends, or never expire (only the GM clears it)?
2. **Which enemies Charge's Stress damage hits.** CB p.59: "deal 1d12 physical damage to all targets within Melee range".
   Built: every enemy the Firbolg *sees* in Melee range of the new square (the card path's "all targets", CB p.104: "if
   you can see the target"), with the token facing the way it ran, so an enemy behind the token's vision cone is not hit.
   Should every enemy in Melee be hit regardless of sight and facing?
3. **"from Far or Very Far range".** Built: the picked target must be at Far or Very Far range (7+ squares) of the token
   before the Charge. Should the check be against *any* of the targets in Melee of the new square, or is the picked
   target right?
4. **The Charge path.** Built: the way to the square must not be blocked for a player (as a normal move, D3/D4); difficult
   terrain does not stop it. The GM may Charge through a blocked way. OK?
