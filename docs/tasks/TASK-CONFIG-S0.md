# TASK-CONFIG-S0: Part A data foundation

Plan `.omc/plans/config.yaml`, tracer S0 (bead dcm-jh6d.3). Data, defaults, codes and the campaign summary only;
nothing in the UI changes and no public function was added.

## What changed

- **`campaigns` (widened, rule 7):** `tableSettings?`, a typed `v.object` of optional fields (`playersSeeFear`,
  `outOfRange` ask/refuse, `spotlightToPlayers`, `lorekeeperWeb`, `lorekeeperAsk` everyone/gm, `fearAtStart`
  carry/pcs, `sessionOpensOn` journal/combatMap, `autoSessionLog`); no clock field (Q4 d). `archivedAt?` (number).
  Validators `storedTableSettingsValidator` / `tableSettingsValidator` in `convex/lib/validators/campaigns.ts`.
- **`campaignMembers.role?` and `campaignInvites.role?`:** `v.literal("coGm")` (`memberRoleValidator`, Q8 b). Nothing
  reads them yet; G1 gives them meaning.
- **New tables** in `convex/tables/campaigns.ts` (composed by `schema.ts`, untouched): `userPreferences` (`by_user`),
  `userUiState` (`by_user_key`, one row per key), `userDrafts` (`by_user_kind_campaign`, `by_campaign`; `schemaVersion`
  + JSON text), `handFolds` (`by_user_character`, `by_campaign`). Field validators in
  `convex/lib/validators/preferences.ts`. No presence table (Q11 b, PR1).
- **`campaigns.get` / `campaigns.list`:** the summary gains `settings` (resolved) and `archived` (bool). The field is on
  the shared `campaignSummaryValidator`, so `list` carries it too (same `summarise`).
- **Cleanup:** `PURGE_STEPS` purge `handFolds` and `userDrafts` by campaign (bounded `take`). `schema-guard.test.ts`:
  `handFolds`, `userDrafts` campaign-scoped; `userPreferences`, `userUiState` bounded.
- **Pure modules (`src/lib/config/`):** `campaign-settings.ts` (`TABLE_SETTING_DEFAULTS`, `resolveTableSettings`, the
  choice lists the validators are built from); `preferences.ts` (`PREFERENCE_DEFAULTS`, `UI_STATE_DEFAULTS`,
  resolvers, `TEXT_SIZE_ZOOM` per Q12 a, `RANGE_RINGS_MAX` 50, `DRAFT_MAX_BYTES` 64 KB, `DRAFT_SCHEMA_VERSION`);
  `legacy-prefs.ts` (`readLegacyPrefs(storage)` for every browser key in the acceptance, `DEAD_KEYS` =
  `dcm:combat-hud`).
- **Errors:** `src/lib/errors/config.ts` (`CAMPAIGN_ARCHIVED`, `CO_GM_NOT_MEMBER`, `CO_GM_CREATOR_ONLY`,
  `SETTING_INVALID`, `LOREKEEPER_GM_ONLY`, `COMBAT_TARGET_OUT_OF_RANGE`), joined to `AppErrorCode` and the client
  message table (`src/lib/convex-errors.ts`).

## Out of owns

- `src/lib/errors/refusals.ts`: `COMBAT_TARGET_OUT_OF_RANGE` joins `SharedCode` and gets a `plain` REFUSALS row
  ("Out of range", the config message). The refusal-table inventory (`tests/unit/hud/refusals.test.ts`) fails for any
  `COMBAT_*` code in `src/lib/errors/**` without a row, and the acceptance fixes the code's name. R2 may restyle it.

## Decisions

- Preference defaults: `dice3d` on, `diceSound` off (today's dice defaults), `diceVolume` 60 and `spotlightPing` on
  (the board), `reduceMotion` off (Q13 a: follow the device), `textSize` medium.
- UI-state defaults: names off, no rings, sorts `name`, roll panels as today (feed open, GM form open, free form shut).
- `readLegacyPrefs` lists every app key it recognises in `keys` (valid or not) so IMP can remove it; an unfolded hand
  ("0") gives no row; a draft must be a JSON object under 64 KB; range circles keep the newest 50 (the browser kept
  200). Keys with malformed ids, Convex Auth's `__convexAuth*` and the sessionStorage level-up draft (N4 a) are not
  read.
- `userDrafts` is listed as campaign-scoped (wizard drafts go with their campaign); P2 adds the expiry cron and its
  `ALSO_RETENTION` note.
- No new public function, so no authz entry.

## Questions used

Q2 a, Q3, Q4 d, Q8 b, Q9 a, Q11 b, Q12 a, Q13 a, Q15 b; N3 / N4 defaults (a).

## Checks

`pnpm lint`, `pnpm typecheck`, focused vitest (config-defaults, config-legacy-prefs, config-foundation, cleanup,
schema-guard, campaigns), the full vitest suite (`--maxWorkers=1 --testTimeout=120000`). `npx convex codegen` run
locally (adds `lib/validators/preferences` to `api.d.ts`); `_generated` not committed. No e2e in the acceptance.
