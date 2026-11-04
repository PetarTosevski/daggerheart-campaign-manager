# TASK LN2-E6: Effect endings and durations, round 2

Plan `.omc/plans/lanes-2.yaml`, tracer E6 (label `lane:w1-e6-endings-durations`, branch `lane2-e6`). Round 1:
docs/tasks/TASK-LN-E6.md. Priority: the endings the SRD data already writes but the server ignored. No types.ts file and
no SRD entry was touched; tests use fixture entries.

## What landed

| Piece | File | What |
|---|---|---|
| `endEffect` on instances | `convex/lib/cardRows.ts` `effectsAfter` / `instanceWrites` | An `endEffect` plan step on an enemy ends the modifiers and condition markers its card or feature made (narrowed to `option`), and the condition / tag a marker stood for. Every card and feature path already calls `instanceWrites`, so this is live everywhere (dcm-9z2z, dcm-8x8, dcm-5fc). |
| `stacking` on instances | same | `replace` ends the older copy of the label from that entry; `refuse` adds no second copy (Blight Seed, HF p.9; dcm-kkx). |
| `planEndsOnSheet` | cardRows.ts | The same on a PC sheet (C2 condition markers drop their condition via `lapsedConditions`). |
| `endPlanAreas` | cardRows.ts | An `endEffect` on the caster ends their live area of that card or feature. |
| `tokensGoneKeys`, `endOnTokensGone`, `endTokensGone` | expiry.ts, cardRows.ts | A use that leaves a `cardTokens` key at 0 ends that source's `tokensGone` effects on the caster and on allies (an ally's only when the caster is the one holder, round-1 Q3) and the caster's areas whose spec ends on `tokensGone` (Flight CB p.328, Invisibility CB p.334, Circle of Power HF p.16; dcm-erhv, dcm-u2wx (2)). Saved and logged in the use's undo group. |
| `applyUseEnds` | cardRows.ts | One call after a resolved use: sheet `endEffect` / `replace`, areas, tokens gone. |
| `afterFeatureUse` | `convex/combatFeatures.ts` | `useFeature` and the GM's `sanction` call `applyUseEnds` and then `placeAreasFromPlan` (dcm-u2wx (1)); walls and a `point` area without a square get a "place … by hand" note. |
| `useFeature` arg `point` | combatFeatures.ts | Optional `{x, y}` for a `point`-centred area (Dark Cloud, CB p.42). |
| companion | combatFeatures.ts `prepare` | Passes `companionNumbers(companionFor(...))` to `pickFeature` (dcm-b9hc (1)). |
| upgrades in the lookup | cardRows.ts `srdUses` / `SourceLookup` | The lookup returns the whole entry, so steps an upgrade adds (Reliable Backup's options, CB p.43) have their ends (dcm-i2tv). |
| `castsSpell` | cardRows.ts `isSpell`, `endOnSpellCast`, `endSpellCast`, `endCasterAreas` | A spell cast ends the caster's `castsSpell` effects, the effects they made on allies / instances that end on the caster's cast, and their areas with `endsOnCaster: ["castsSpell"]`, never the spell just cast (Through Your Eyes CB p.335, Veil of Night CB p.336; dcm-o44e). No caller yet (dcm-m48i). |
| `benefitGranted`, `sharedGrant` | cardRows.ts `endGrantedBenefit`, `endSharedGrants` | Forest Sprites (CB p.339), Bird's-Eye View (CB p.33; dcm-rao5). No caller yet (dcm-79v1). |
| `endFear` | expiry.ts `gmFearToEnd`, cardRows.ts `gmFearForEffect` / `gmFearForInstanceEffect` | The Fear a GM spend costs: `byTier` with the PC's tier (Marked for Death, HF p.8), default 1 (Slumber; dcm-8bv). |
| `endsOnCaster` on areas | cardRows.ts `endCasterAreas` | Hush (CB p.336; dcm-rx1k). Caller: incoming hits (dcm-8f51). |
| `gmTurn` / `day` / `week` | expiry.ts `ExpiryEvent`, `FEATURE_USES`, `EXPIRING_FEATURE_USES` | Feature uses with these periods end on their event; a GM turn also ends with any scene, session or rest end (dcm-55k, expiry half). |
| `needsChoiceValidator` | cardRows.ts | `choose.chooserId` and a `followUp` ask (dcm-sc54, validator half). |

## Beads

| Bead | State | Done / left |
|---|---|---|
| dcm-9z2z endEffect, replace | partly | Instances on every path; sheets and areas on the feature path. Card paths: dcm-m48i. |
| dcm-8x8, dcm-5fc | partly | As dcm-9z2z (Howling Rampage's Wolf Form ends now; Confusing Aura / Time Lock / Avatar of Terror wait on dcm-m48i). |
| dcm-kkx | partly | `replace` / `refuse` server side; featureRunner passing `effectsOn` is E8's. |
| dcm-erhv tokensGone | partly | Feature path live; card tokens (Flight, Invisibility) need dcm-m48i. |
| dcm-u2wx | done (server) | Areas placed from `useFeature`, `point` arg; area ends on tokensGone. Client sends `point`: UI follow-up (comment on the bead). |
| dcm-i2tv | done | Lookup walks the whole entry incl. upgrades. |
| dcm-o44e (castsSpell half) | partly | Engine done; caller dcm-m48i. |
| dcm-rao5, dcm-5yew | partly | Engine done; caller dcm-79v1. |
| dcm-rx1k (caster events half) | partly | `endCasterAreas`; caller dcm-8f51. |
| dcm-8bv | partly | `endFear` amount; the GM intent stays dcm-kmr (comment added). |
| dcm-b9hc | partly | (1) done; (2) run.ts is E3's, (3) characterExtras. |
| dcm-55k | partly | Expiry done; callers dcm-bc67. |
| dcm-sc54 | partly | Validator done; runCard mapping (E4) and the dialog left. |
| dcm-iedr | not (E6 half) | E7 carries the fields on the plan step; ending a stored PC condition on the caster's damage / bearer's roll belongs to the hit and roll callers (dcm-t8c, dcm-wn7). |
| dcm-0ey, 3ea, 4qv, awh, b77, cwh, ffk, utu, v17, wjv, kmr | unchanged | Round-1 state; they wait on dcm-wn7 / dcm-t8c / dcm-4xl / dcm-kmr callers. |

## Follow-ups filed

dcm-m48i (E1: card paths call `applyUseEnds`, `endSpellCast`, `placeAreasFromPlan`), dcm-79v1 (E1: roll paths call
`endGrantedBenefit` / `endSharedGrants`), dcm-8f51 (E2: incoming hits call `endCasterAreas`), dcm-bc67 (E5 / orchestrator:
fire gmTurn / day / week, store the period).

## R1 reminders

None of R1's reminders can go with this merge alone: Confusing Aura, Avatar of Terror, Time Lock (card `endEffect` on
self), Flight and Invisibility (card tokens) all run through the card paths (dcm-m48i). Rune Ward (dcm-a9c) and Breaking
Blow (dcm-yd5h) are not E6's. The instance half of `endEffect` is live, so an `endEffect` aimed at an enemy needs no
reminder.

## QUESTIONS

1. **A wall or a point area from a GM-approved feature use.** The sanction payload keeps no square, and walls can't be
   drawn yet; built: the feed note "place … on the map by hand". Agreed?
2. Round-1 questions Q1-Q6 stay open (docs/tasks/TASK-LN-E6.md).

## Merge-time actions

- `useFeature` args gained optional `point: {x: number, y: number}`: no new public function; the existing authz entry
  stays valid (the arg is optional).
- Regenerate `convex/_generated` (no new module).
