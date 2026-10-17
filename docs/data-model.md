# Data model (Convex)

Source of truth: `convex/schema.ts`. Every record is owned by the GM (`ownerId`)
or belongs to a campaign the GM owns; every public function calls `requireGm`.

| Table | Fields | Indexes | Notes |
|---|---|---|---|
| `campaigns` | `ownerId`, `frameId` (published frame id or `custom`), `name`, `nameKey`, `tier`, `level`, `custom?` (`pitch`, `tones`, `themes`, `touchstones`, `partySize`, `startingTier`, `background`), `createdAt`, `lastOpenedAt`, `deletedAt?` | `by_owner_lastOpened`, `by_owner_nameKey` | `nameKey = name.trim().toLowerCase()`; names are unique per GM among campaigns that are not deleted. Delete sets `deletedAt` (undo clears it); nothing is hard-deleted. JS `trim`/`toLowerCase` are slightly stricter than the old Postgres `btrim`/`lower`. |
| `campaignState` | `campaignId`, `fear` | `by_campaign` | Created with Fear 0 in the same transaction as the campaign. Fear controls arrive in D2. |
| `settings` | `ownerId`, `tableName`, `gmName`, `accent` | `by_owner` | One row per GM, created on first save. `accent` is one of the four palette colours. |
| `operations` | `scopeKey`, `idempotencyKey`, `kind`, `requestHash`, `result`, `campaignId?`, `createdBy`, `createdAt` | `by_scope_key`, `by_campaign` | Idempotency records (`convex/lib/operations.ts`). A replay with the same kind and normalised request returns `result`; anything else with the same key is `IDEMPOTENCY_MISMATCH`. Campaign create uses scope `owner:<id>`. |

Convex Auth's `authTables` are included unchanged.
