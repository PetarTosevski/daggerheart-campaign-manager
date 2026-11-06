# TASK-CONFIG-P2: Account UI state and drafts server

Plan `.omc/plans/config.yaml`, tracer P2 (bead dcm-jh6d.8). Server only (Q15 b: every value the browser kept moves to the
account). U6e / U6f build the UI on it; IMP calls the two imports. No UI changes.

## API

**`convex/uiState.ts`**: the caller's own `userUiState` rows only (`ctx.user`), one row per key.
- `uiState.get` (userQuery, `{}`): the resolved `UiState` (`resolveUiState`: the saved value when it fits the key, else
  the default). One bounded read of `by_user_key` (`take(14)`, 7 keys).
- `uiState.set` (userMutation, `{ change }`): a single-field union, one member per key (`tokenNames`, `rangeRings`,
  `adversarySort`, `environmentSort`, `rollFeedCollapsed`, `gmRollFormCollapsed`, `freeRollFormOpen`). Upserts that key's
  row and returns null. `rangeRings` replaces the list whole (it is one key's value). More than 50 ids, a repeated id, or
  an empty id or one over 64 characters is `INVALID`.
- `uiState.importLegacy` (userMutation, `{ uiState }`: any subset of the keys, the shape of `readLegacyPrefs().uiState`):
  writes only keys that have no row yet. Range circles are cleaned (bad ids dropped, the newest 50 kept), never refused.
  Returns null. Running it again writes nothing.

**`convex/drafts.ts`**: the caller's own `userDrafts` rows only.
- `drafts.get` (userQuery, `{ kind, campaignId? }`): `{ schemaVersion, data, updatedAt } | null`. A `characterWizard`
  draft needs `campaignId` (`INVALID` without it) and view on that campaign through `campaignAccess` / `permissionFor`
  (`NOT_FOUND` if the campaign is missing, deleted or not visible). A `customFrame` draft takes no campaign (`INVALID`
  with one).
- `drafts.save` (userMutation, `{ kind, campaignId?, schemaVersion, data }`): the same campaign rule. `data` must be
  JSON text of an object, at most `DRAFT_MAX_BYTES` (64 KB, UTF-8), and `schemaVersion` an integer of at least 1; anything
  else is `INVALID`. Upserts on `by_user_kind_campaign` and returns null.
- `drafts.clear` (userMutation, `{ kind, campaignId? }`): deletes the caller's own row if there is one and returns null.
  It does no campaign check: it can only touch the caller's own row and reveals nothing, so a player who left a campaign
  can still clear their draft.
- `drafts.importLegacy` (userMutation, `{ drafts: { kind, campaignId?: string, data }[] }`: the shape of
  `readLegacyPrefs().drafts`): saves each draft the account has none of, as `DRAFT_SCHEMA_VERSION`. A draft is skipped,
  never refused, when its campaign id is malformed (`normalizeId`), missing or not visible to the caller, or its data is
  too large or not a JSON object. It looks at the first 100 drafts. Returns null. Running it again saves nothing.

**`convex/draftsRetention.ts`** (rule 8): `expire` (internalMutation) deletes drafts with `updatedAt` older than 90 days
(`by_updated`), at most 200 per run. It reschedules itself (`runAfter(0)`) while a run deleted a full batch.
`crons.ts` runs it daily as "expire old drafts" at `31 4 * * *`. `schema-guard.test.ts` lists `userDrafts` in
`ALSO_RETENTION`.

## Out of owns

- `convex/tables/campaigns.ts`: one additive index `userDrafts.by_updated` (`["updatedAt"]`). The expiry needs an indexed,
  bounded read (rule 5), and S0's table had no `updatedAt` index. The orchestrator approved it (2026-11-04). No field
  changed.
- `tests/convex/unauthenticated-sweep.test.ts`: `uiState:get` joins `STRANGER_OWN`. It returns the caller's own
  defaults, which the "stranger shows nothing" check would otherwise flag. Both imports return null instead of a count,
  so they need no entry there. Reported to the orchestrator.

## Decisions

- Range-circle ids are opaque strings (token ids), checked only for shape (non-empty, at most 64 characters, no repeats):
  a stale id is harmless and the UI drops it.
- Neither import ever throws for a value. `uiState.importLegacy`'s validator still types the values; the IMP client
  sends the parsed `readLegacyPrefs` result, which matches it.
- The mutations take no rate limit: each writes one small row of the caller's own.
- The archived-campaign guard (G1) is on the campaign wrappers. Drafts are account rows, so saving a wizard draft for an
  archived campaign is not blocked here. Q9 a makes the campaign read-only, so the wizard UI won't offer it.

## Questions used

Q15 b. N3 / N4 take their defaults (a); IMP is not built here.

## Checks

- Focused vitest: `ui-state`, `drafts` (including the cron schedule, batch and reschedule), `authz/config-uistate`,
  `schema-guard`, `authz-matrix`.
- The full vitest suite (`--maxWorkers=1 --testTimeout=120000`): 524 of 525 files passed. The only failures were the
  stranger rows of `unauthenticated-sweep` (fixed by the sweep line and the null imports above, then rerun green with
  the focused set).
- `pnpm lint` and `pnpm typecheck`.
- `npx convex codegen` was run locally; `_generated` is not committed.
