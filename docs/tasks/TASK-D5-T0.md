# TASK-D5-T0: D5 foundation

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T0 (wave 1). Every later D5 tracer builds on the contracts below; each file named here has a header comment with a usage example.

## Contracts

| Contract | Where | Used by |
|---|---|---|
| Action log and undo: `logAction`, `newGroupId`, `undoEntry`; public `actionLog.undo` | `convex/lib/actionLog.ts`, `convex/actionLog.ts`, table `convex/tables/actionLog.ts` | every D5 state change; T1 feed |
| Fear undo: `revertFear` (floor 0, cap 12, history action `undo`) | `convex/lib/fear.ts` | undo |
| Sheet helpers moved out of `characters.ts`: `readSheet`, `storedSheet`, `saveSheet`, `findCharacter`, `loadCharacter`, `editable`, `assertCanAct` | `convex/lib/characterSheet.ts` (re-exported from `convex/characters.ts` for old importers) | every D5 mutation |
| D5 sheet fields (defaulted, no `SHEET_VERSION` bump) | `src/lib/validation/characters.ts`, mirrored as optional in `convex/lib/validators/characters.ts` | all |
| `hopeMax(scars, hopeSlotBonus)`, `applyResourceDelta` (Hope cap, Unconscious cleared by an HP clear) | `src/lib/domain/characters/index.ts` | sheet, party card, T9 |
| `expire(sheet, shortRest\|longRest\|session\|hit)` | `src/lib/domain/characters/expiry.ts` | T3, T5, T8a |
| `withEffects(sheet)` (+ `attackBonus`, `damageBonus`) | `src/lib/domain/characters/effects.ts` | T1, T6, sheet |
| `dualityOutcome`, `actionOutcome`, `RollRecord` | `src/lib/domain/duality.ts` (`convex/lib/validators/actionLog.ts` fails typecheck if the stored roll drifts) | T1, T4, T8a |
| Class-feature hooks: `ClassFeatures`, `FeatureMeta.use`, `rollOptions`, `weaponOverrides`, `afterDualityRoll`, `onRest`, `onSessionStart`, `onSessionEnd`, `hopeFeature`, `classActions`, `findFeature`; empty registry | `src/lib/domain/class-features/{types,hooks,index}.ts` | T1, T3, T5, T8a-c |
| Error modules (`as const`, one per domain): actionLog (`UNDO_STALE`, `CHARACTER_UNAVAILABLE`), dice (`DICE_RULE`), levelUp (`LEVEL_UP_RULE`), rests (`REST_RULE`), death (`DEATH_MOVE_RULE`), wither (`WITHER_RULE`), classFeatures (`CLASS_FEATURE_RULE`, `NOT_ENOUGH_HOPE`), photoImport (`PHOTO_IMPORT_RULE`, `PHOTO_IMPORT_UNAVAILABLE`). `AppErrorCode` takes `keyof` each, so a tracer adds codes only in its own module. | `src/lib/errors/*.ts` | all |
| Slots: `SlotProps` / `CampaignSlotProps`; stubs that render nothing | `src/components/party/slots.ts`, `src/components/party/<feature>/index.tsx` | feature tracers |

Slot mounts: sheet header `LevelUpButton`, sheet end `DeathMoveModal` (sheet.tsx); `SheetDiceBox`, `FeaturesPanel`, `RestPicker`, `WitherCounter` (page-one.tsx); `RollFeed`, `SessionButtons`, `RestLauncher` (dashboard); `LevelUpCardBadge`, `DeathCardBadge`, `WitherCardBadge` (party card); `PartyLevelUpButton`, `ImportButton` (party page header); `LevelUpRosterBadge` (roster card).

## Schema

- New tables: `actionLog` (indexes `by_campaign_at`, `by_campaign_visibility_at`, `by_character_at`, `by_campaign_group`), `rests` (`by_campaign_status_started`, `by_campaign_started`), `restChoices` (`by_rest_character`, `by_campaign`). All campaign-scoped (schema-guard), purged by `convex/cleanup.ts`.
- `characters.status` widens with `away`, plus optional `away {reason infirmary|sentHome, note?}`; `setStatus` still takes active|dead|retired. `files.kind` widens with `photoImport`. `campaignState.sessionStartedAt` (optional).
- `convex.config.ts`: optional env `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`. `RATE_LIMITS`: `roll` (60/min, capacity 120), `photoImport` (10/hour).
- Frames: exclusive mechanic `witherTokens` on Witherwild.
- Dependencies: `three@0.160.0`, `cannon-es@0.20.0`, `@types/three@0.160.0`; nothing imports them yet (T1b).

## Undo rule

A row is undone by its actor or the GM (`permissionFor` on the campaign; a player never sees a `gm` row: NOT_FOUND). It and every row of its group must be undoable and not undone, and for each character in the group the character's newest row that is neither undone nor `undoable: false` must belong to the group; otherwise `UNDO_STALE`. Undo restores each character's oldest `before` in the group, reverts the summed `fearDelta` through `revertFear`, and stamps `undoneAt`/`undoneBy` on every row.

## Book references (re-checked)

- CB 18 and CB 90: Hope "to a maximum of 6". CB 40 (Ranger companion), Light in the Dark: "Use this as an additional Hope slot your character can mark." → `hopeSlotBonus` 0..1, `hope` max 7.
- CB 95: matching Duality Dice are a critical success.
- CB 105, "Refreshing features during downtime": features usable a number of times per rest refresh on a short or long rest; per long rest ones on a long rest → `expire` table.
- CB 106, Avoid Death: the character drops unconscious and can't act until "an ally clears 1 or more of their marked Hit Points or" the party finishes a long rest; the Hope Die at or under the level gives a scar.
- CB 261, Witherwild: "Any time a PC takes Severe damage from a Withered adversary or environment, gain a Wither token" → `witherTokens`, `wither` 0..99 (no per-PC cap; the pool of about 20 tokens is reference only).
- HF 127, A Less Lethal Campaign: a character can end up "in the infirmary for a few weeks or being sent home for the semester" → `away.reason`.

## Follow-ups

- dcm-c26: actionLog snapshot retention (strip old `before` snapshots by cron?).

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test` (new: `tests/convex/action-log.test.ts`, `tests/unit/sheet-d5-fields.test.ts`, `tests/unit/expiry-effects.test.ts`; extended: schema-guard, cleanup, convex-errors), local push with `--typecheck=enable`, and the full e2e suite.
