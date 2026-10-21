# TASK-D12-H9: Authz matrix - world (maps, codex, scenes)

Plan `.omc/plans/d12-hardening.yaml`, tracer H9 (depends on H0). Harness API: `docs/tasks/TASK-D12-H0.md`.

## What landed

| File | Change |
|---|---|
| `tests/convex/authz/world.entries.ts` | 35 entries (13 codex, 21 maps, 1 scenes); `pending` is empty. |
| `tests/convex/authz/world.test.ts` | `runMatrix(area)` plus two content tests of the players' view of hidden data. |

## Access classes (read from the code)

| Functions | Class | Rows |
|---|---|---|
| `codex:create`, `codex:seed`, `codex:importPins` | `edit` (campaign wrapper `need: "edit"`) | class defaults: anon UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, **grantee ok**, gm ok |
| `codex:update`, `setPin`, `remove`, `imageUploadUrl`, `attachImage`, `setImageShown`, `setCover`, `removeImage` | `scoped` (`loadEntryForGm`: edit on the `codexEntry` resource) | anon UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, grantee ok, gm ok |
| `codex:list` | `scoped` (view on the campaign) | anon UNAUTHENTICATED, outsider NOT_FOUND, player/otherPlayer/grantee/gm ok |
| `codex:entryText` | `scoped` (`findEntry`, returns null without access) | on a secret entry: anon UNAUTHENTICATED, outsider null, **player and otherPlayer null**, grantee ok, gm ok |
| `maps:get` | `scoped` (`mapAccess` view) | anon UNAUTHENTICATED, outsider NOT_FOUND, every member ok |
| `maps:locations` | `scoped` (`mapAccess` view) | with a hidden location marker: **player and otherPlayer empty**, grantee ok, gm ok |
| the other 19 `maps:*` (markers, party, terrain, options, palette, map image, hex crawl) | `scoped` (`gmMap`/`gmCrawl`: edit on the `map` resource) | anon UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, grantee ok, gm ok |
| `scenes:end` | `gm` | class defaults |

The grantee holds `edit` on the campaign; `permissionFor` falls back from the `map` and `codexEntry` resources to
the campaign's grants, so the grantee acts as the GM on every map and codex change. `maps:placePartyHex` is filed
`own` in analysis 1.3 but is a GM crawl change (`gmCrawl`), so it is `scoped` here.

Arguments and setup: `nameHints.tokenId → null` (codex `setPin` takes a world-map marker number, not a combat
token); marker rows and codex images are inserted in the entry's `setup` the way the feature tests do; the five hex
crawl entries run on a `journey-to-horizon` world (`moveToHex` places the party on hex 0,0 first). Upload-URL
mutations (`codex:imageUploadUrl`, `maps:mapImageUploadUrl`) are covered for access only; the attach functions get a
file stored directly (`ctx.storage.store`, chosen with `w.use("_storage", id)`), no blob goes through an upload URL.

## Players' view of hidden data

- Matrix rows: `codex:entryText` on a secret entry → null for both players; `maps:locations` with a hidden location
  marker → empty for both players.
- `world.test.ts` content tests: a player's `codex:list` holds only known entries and no GM notes, and `entryText`
  of a secret entry is null; a player's (and the other player's) `maps:get` and `maps:locations` leave out a hidden
  marker the GM's include.

## Known bugs

None found: every row matched the expected access on the first run.

## Checks

- `pnpm vitest run tests/convex/authz/world.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`:
  189 passed (world 180 = 178 matrix rows + 2 content tests; guard 9).
- Area runtime: `world.test.ts` alone 17.5 s of tests (26 s wall with module loading) at load average about 40;
  under the 60 s budget.
- `pnpm typecheck` clean; `pnpm exec eslint` on both files clean.
