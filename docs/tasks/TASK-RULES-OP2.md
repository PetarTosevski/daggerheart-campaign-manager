# TASK-RULES-OP2: Conflict between PCs, the UI and the GM's range sanction

Plan `.omc/plans/rule-switches.yaml`, tracer OP2 (wave 13, bead dcm-bxp.134), after OP (`docs/tasks/TASK-RULES-OP.md`,
its "Not done" items 1 to 4). Rule `pcConflict` (CB p.168, optional, off by default). Off: nothing below shows or changes.

## What landed

| Piece | File |
|---|---|
| GM **Contest** button in the dock (between Dice and Player view) and its pop-over: instigator and target (the PCs on the map, `combatHud.party`), a trait and a modifier (whole number, -20..20) each; "Roll the Contest" calls `combatActions.contest` (a fresh idempotency key per click, `useIntent`) and shows who succeeds and both rolls ("Reaction · Bryn: 12", "Action · Ash: 15 vs 12, success with Hope"). Shown only while `ruleSettings.get` has `pcConflict` on and `canEdit` (GM / co-GM). Client state of the dock's own: opening it closes the open HUD panel; any HUD panel hides it. Inside a `PartBoundary`; errors in an `aria-live` region | `src/components/combat-map/hud/dock/contest.tsx`, `index.tsx`, `dock.css` |
| `combatRequests.sanction` re-checks the targets with `checkAttackTargets` and passes `pcTargets` to `resolveAttack`: an approved sanction naming another PC rolls against their Evasion and opens their incoming-hit window, as the direct attack does. Rule turned off meanwhile: COMBAT_TARGET_INVALID, the request stays open (the GM can decline) | `convex/combatRequests.ts` |
| `openSanction` and `openAfterRoll` take an optional `encounterId` (`LooseWhere`; the row's field was already optional, `encounterRunning` counts a row without one as running) | `convex/lib/combatRequests.ts` |
| Tests: sanction approval / decline / rule-off on a seeded encounter-less sanction; the Contest panel's pure helpers | `tests/convex/rules-pc-conflict.test.ts` |

## Not done here (outside OP2's files)

1. **The attack still refuses an out-of-range PC** (`convex/combatActions.ts` `attack`, OP's branch "an attack on a PC
   never waits for the GM's range sanction"). To make it wait like an adversary target, replace that branch: drop the
   `pcs.length > 0` refusal, add the PCs out of range to `bands` (`{ tokenId, band: p.check.band }`), and give
   `openSanction` `encounterId: targets[0]?.encounter._id` (spread only when defined). The R2 "refuse" setting should
   then refuse PC targets out of range too (`refuse && far.length > 0`). The approval side is ready (this tracer).
2. **OP's direct insert of a held attack** (`convex/lib/combatActions.ts` `resolveAttack`, "OP: an attack on PCs only
   belongs to no encounter"): now `openAfterRoll(ctx, { ...where, ...(encounterId !== undefined ? { encounterId } : {}) })`
   replaces both branches. The file is OE2's in wave 13.
3. **Classic map attack bar** (`src/components/combat-map/actions/attack/**`): no such bar exists any more (it went with
   the HUD cut-over, plan combat-hud H8.1; the folder holds helpers only). The HUD's attack picker already lists the PC
   targets `combatActionsReads.targets` returns (OP, `conflictRows`). Nothing to do.
4. **Party panel**: `src/components/combat-map/hud/party/` does not exist; the Contest lives in the dock only.
5. A unit test of the dock with the rule on (Contest button shown, pop-over toggles) belongs in
   `tests/unit/hud/dock.test.tsx` (not in OP2's owns).
