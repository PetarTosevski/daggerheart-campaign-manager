# TASK-CONFIG-AX: Part B close (superadmin e2e, docs from env to admin, dcm-cd8)

Plan `.omc/plans/config.yaml`, tracer AX (bead dcm-jh6d.61), Part B. Not waiting for AD14 / AU9 (Q28 suspend and
delete need a design, N11). Answers used: Q16 a, Q17 changed, Q19 a, Q27 b, N1 changed.

## Specs

- `tests/e2e/admin-superadmin.spec.ts`: a fresh GM (fresh per run: limit requests are rate-limited per GM per day) and a
  player of their campaign.
  - Every `appOwner*` function, called directly by each of them, is refused with `FORBIDDEN`. The list of calls is
    compared with a source scan of `convex/` (`export const X = appOwnerQuery|Mutation|Action`), so a new admin
    function fails the spec until it is listed. The arguments are valid (real campaign, user, storage and limit-request
    ids, made in the spec) and chosen so that a leak still changes nothing that matters (out-of-range numbers, the
    default sign-up mode, an inert feature, read-only off).
  - Both get 'Not allowed' at `/admin` with no tab list and no tab panel.
  - The owner sees the five tabs in order, each with its first card loaded, no alert and no serious axe finding.
  - The owner opens the campaign from Overview, sees the read-only banner and no gear; `campaigns.get` says
    `ownerView`, and a Fear change is refused (NOT_FOUND / FORBIDDEN / OWNER_VIEW_READ_ONLY) and changes nothing.
  - `finally` declines the limit request, puts 'Let GMs ask for higher limits' back as it was and deletes the test file
    (the GM's `campaignBooks.add` refuses a text file and deletes it).
- `tests/e2e/a11y-admin.spec.ts`: every tab by its `?tab=` link at the two tablet sizes: axe and no sideways scroll.
  Read-only.

## One owner for every spec (`tests/e2e/owner.ts`)

`E2E_OWNER_EMAIL` (`e2e-owner@example.test`), `setAppOwner()` (the documented `adminSetup:setOwner` through
`scripts/convex-e2e.mjs`) and `openFromOverview(page, name)`. Every owner spec (read-only-mode, owner-view and the two
above) uses the same account, so a spec never hands the role away from another and nothing has to put a previous owner
back; `playwright.config.ts` already runs one worker. Specs restore any app-wide setting they change in `finally`.

`openFromOverview` clicks 'Show more campaigns' until the row shows: `adminOverview.campaigns` pages
`by_deletedAt_archivedAt` descending, so every archived campaign on the shared backend lists before every live one
(bead dcm-jh6d.65).

## Docs

- `docs/deploy.md` › 4a "App admin": naming the owner (`npx convex run adminSetup:setOwner`), what moved from env /
  code to which tab and the fallbacks, read-only mode, keys and backups, what the export contains and excludes, the
  owner's read-only view (N1 changed: everything), suspend / delete not built, the e2e owner. The env table marks the
  three `LOREKEEPER_*` numbers as fallbacks; rollback and smoke test mention App admin.
- `docs/lorekeeper.md`: shared books and campaign books, PDF uploads (owner and GM) and their limits (20 MB, 300 pages,
  no count limit, printed first page), limits read admin → env → default, the at-limit modes, the owner's exemption,
  limit requests, retention of campaign books and requests, and the owner's view in Privacy.

## dcm-cd8

Closed: Q19 a says the campaign-wide 50 stays as the abuse bound and the bead closes with the per-player cap, which
AD5b enforces (`assertCharacterCap`, default 5, set in Accounts).

## Outside edits (approved: fixes to the unrun specs)

- `tests/e2e/owner.ts` (new shared helper, above).
- `tests/e2e/read-only-mode.spec.ts`: the shared owner; the export row locator (the XPath
  `ancestor::div[contains(@class,'adm-row')][1]` matched the text block `.adm-row-t`, so Export was never found and the
  click waited until the test timed out); the owner's token is kept outside the page so `finally` turns read-only off
  even after a timeout (it left the backend read-only, which then failed session-opens-on).
- `tests/e2e/owner-view.spec.ts`: the shared owner and `openFromOverview`.

## Results

Run with `E2E_PORT=3751 E2E_CONVEX_PORT=3752`, one worker, servers started by hand (`E2E_REUSE_SERVERS=1`):
admin-superadmin, a11y-admin, admin-shell, read-only-mode, owner-view, config-campaign-books, config-legacy-import,
session-opens-on, live-config, a11y-config and campaign-archive pass. The full e2e suite was not run here (the
orchestrator runs it after the merge).

## Open

- The comment on `MAX_CHARACTERS_CREATED_PER_CAMPAIGN` (`convex/lib/characterSheet.ts`) still says it drops to 10 when
  testing ends; per Q19 a it stays 50. Not in AX's owns.
- `campaignMonthlyUsd` (the per-campaign monthly budget) has no App admin control (AU3's decision); only its env var or
  a direct `adminLorekeeper.setLimit` call sets it.
