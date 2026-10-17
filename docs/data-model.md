# Data model (Convex)

Source of truth: `convex/schema.ts`. Every record is owned by the GM (`ownerId`)
or belongs to a campaign the GM owns; every public function calls `requireGm`.

| Table | Fields | Indexes | Notes |
|---|---|---|---|
| `campaigns` | `ownerId`, `frameId` (published frame id or `custom`), `name`, `nameKey`, `tier`, `level`, `custom?` (`pitch`, `tones`, `themes`, `touchstones`, `partySize`, `startingTier`, `background`), `createdAt`, `lastOpenedAt`, `deletedAt?` | `by_owner_lastOpened`, `by_owner_nameKey` | `nameKey = name.trim().toLowerCase()`; names are unique per GM among campaigns that are not deleted. Delete sets `deletedAt` (undo clears it); nothing is hard-deleted. JS `trim`/`toLowerCase` are slightly stricter than the old Postgres `btrim`/`lower`. |
| `campaignState` | `campaignId`, `fear` | `by_campaign` | Created with Fear 0 in the same transaction as the campaign. `fear.adjust` (±1) and `fear.set` (0–12) change it; both are idempotent. Fear is core. |
| `countdowns` | `campaignId`, `name`, `description`, `category` (threat/project/consequence/other), `startingValue` (1–20), `currentValue`, `status` (active/paused/completed/cancelled), `consequence`, `completedAt?`, `createdAt` | `by_campaign` | Legacy rules (`applyCountdownAction`): advance/reverse ±1 (blocked while paused), correction by any amount (allowed while paused), 0 completes, a completed countdown reopens only upward, cancelled is final and hidden. `completedAt` is set once per active lifecycle and cleared on reopen. **No event history** (user decision 2026-10-17). Countdowns are core. |
| `campaignTime` | `campaignId`, `week` (≥1), `cycle` (DAY/NIGHT), `cycleDay` (1–7) | `by_campaign` | Witherwild only (frames with `campaignTime`); created with the campaign at week 1 / DAY / 1. Month = ⌊(week−1)/4⌋+1 and the phase name are derived, never stored. `advance` moves one day (after day 7: week+1, other cycle); `setDay` sets a day in the current week and must change it. Every function throws `MECHANIC_DISABLED` for other frames. |
| `settings` | `ownerId`, `tableName`, `gmName`, `accent` | `by_owner` | One row per GM, created on first save. `accent` is one of the four palette colours. |
| `operations` | `scopeKey`, `idempotencyKey`, `kind`, `requestHash`, `result`, `campaignId?`, `createdBy`, `createdAt` | `by_scope_key`, `by_campaign` | Idempotency records (`convex/lib/operations.ts`). A replay with the same kind and normalised request returns `result`; anything else with the same key is `IDEMPOTENCY_MISMATCH`. Campaign create uses scope `owner:<id>`; Fear, countdown create and campaign time use `campaign:<id>`; countdown operations use `countdown:<id>`. With no event tables, these records are also the trail of applied changes. |

Convex Auth's `authTables` are included unchanged.
