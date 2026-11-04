# TASK-LN2-E5: checks, limits, numbers, passives (lanes-2, wave 8)

Plan `.omc/plans/lanes-2.yaml`, tracer E5, label `lane:w1-e5-checks-limits-numbers`, branch `lane2-e5`.
Round 1: `docs/tasks/TASK-LN-E5.md`. V2 triage: `docs/tasks/TASK-LN-V2.md`.

## What landed

Pure domain logic only; no Convex function, args or validator changed (no authz entries).

| Bead | State | Where |
| --- | --- | --- |
| dcm-nsqo / dcm-k4x5 `targetCount.which: "markedHp"` (+ `severity`) | E5 half done | `numbers.ts`: `NumberEnv.targetResults` (`TargetResult { id, hpMarked, severity? }`), counted after the window; E7 fills it (dcm-ehgy) |
| dcm-b77 `NumberSource recorded` | E5 half done | `numbers.ts`: `NumberEnv.recorded`; E7 / E3 fill it from the condition's `record` |
| dcm-346 `creatureCount.chain` | E5 half done | `numbers.ts` `chainCount`: breadth-first links of at most `chain` range from the actor (or the target with `of: "target"`), `MapCreature.at` footprint via `tokenDistance`; E7 fills `at` (dcm-8rh / dcm-e16o) |
| dcm-qw4f `optionRemoved` | E5 half done | `availability.ts`: `StateFacts.removedOptions`, `removedOptions(mods)`, `optionIsRemoved`; check undefined until the fact is filled (E7) |
| dcm-5kxg can't spend Hope / can't clear | E5 half done | `availability.ts`: `PayerState.flags` refuses Hope costs (`hopeBlocked`), `clearBlocked(track, flags)`; callers: dcm-hgvx (E3 run.ts, feature run.ts, adversary window) |
| dcm-eut Defensive stance buy-off | E5 half done | `passives.ts`: gated `disadvantageAgainst` (`from`, `buyOff`, `situation`) kept in `PassiveMods.guarded` / versus mods; `gateHolds`; `versusMods` returns `buyOff` for the attacker's pay prompt and drops paid ones (`CreatureInfo.paidOff`). E7 builds the prompt |
| dcm-cqwm Feed's passive use | done | `passives.ts` `activePassives`: passive uses read on any feature; before-roll toggles stay with passive features |
| dcm-c75 Words of Discord whole-campaign memory | partly | `availability.ts`: `CAMPAIGN_UNTIL`, `RESET_LABEL.campaign`, exhaust order, `USED_ON_EVER` used by `recordUsedOn` without `since`. Stored as `session` until the validator widen: dcm-pg8x |
| dcm-u4pq Codex-Touched swap | model half done | `hand/model.ts`: `UseForm.swapWithVault`, `needsDialog`; the dialog sending `swapWith` is dcm-aw16 (E1) |

Tests: `tests/unit/lane-e5-round3-numbers-passives.test.ts` (18).

## Follow-ups

- dcm-pg8x (new): add `"campaign"` to `FEATURE_USE_UNTIL`, flip `USED_ON_EVER` to `CAMPAIGN_UNTIL`, confirm expiry never ends it.
- dcm-hgvx (new): fill `PayerState.flags` at the `unaffordable()` callers; clear steps / rests use `clearBlocked`.
- Existing other-lane halves: dcm-ehgy (targetResults), dcm-b77 (recorded), dcm-346 / dcm-8rh (footprints), dcm-qw4f
  (removedOptions from instance mods), dcm-eut (attacker's pay prompt), dcm-aw16 (Hand dialog swapWith): E7 / E3 / E1.

## Data switches for wave 9

None needed: the data already uses the V2 terms; these were engine fallbacks (0 / undefined) that now resolve once the
callers fill the env fields.

## QUESTIONS

1. **Shield Wall line of one.** CB p.212: "If additional Bladed Guards are standing in a line alongside the first, and
   each is within Melee range of another guard in the line, the Difficulty increases by the total number of guards in
   that line." Read: a guard with no linked guard is no line (+0); with a line, the count includes the first guard.
2. Round-1 QUESTIONS 1 and 3 (TASK-LN-E5.md) are still open; QUESTION 2 (Words of Discord) is answered (whole campaign).
