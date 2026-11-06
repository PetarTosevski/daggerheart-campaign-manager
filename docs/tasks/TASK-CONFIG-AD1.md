# TASK-CONFIG-AD1: App admin shell

Plan `.omc/plans/config.yaml` (Part B, wave 5), bead dcm-jh6d.34, design `reference/designs/config/Admin.dc.html`.

## What changed

- `/admin` (`src/app/(gm)/admin/page.tsx` + `error.tsx`): the app owner's page under `(gm)`, so a signed-out visitor
  goes to `/signin?next=%2Fadmin` through `src/proxy.ts` like every other page. The error page uses neutral words
  ("Something went wrong") because it can show before the owner check has answered.
- `src/components/admin/shell/index.tsx`: the owner gate, the header (back to the main menu, the wordmark, 'Owner
  only'; kicker 'Whole app · every campaign', H1 'App admin', the sub line, 'Saved · changes apply right away'), the
  five tabs and the tab panel.
  - Gate: `useAppOwner()` loading shows a status line; `null` or `{ isOwner: false }` shows 'Not allowed' ('This page
    is for the app owner.', 'Back to the main menu'; Q17 changed); only `{ isOwner: true }` renders the frame. No tab
    mounts for anyone else, so no admin query runs for them. This gate is cosmetic (CF22); AD0's `appOwner*` wrappers
    are the real check.
  - Tabs: ARIA tabs (`tablist` 'Admin sections', vertical, arrows on both axes, Home / End, roving tabindex), drawn as
    the design's side nav (`.anav` / `.sn`). URL state `?tab=overview|accounts|lorekeeper|features|maintenance`
    (absent or bad = Overview; Overview removes the param; other params stay), written with `history.replaceState`.
  - Only the selected tab is mounted, inside its own `SlotBoundary` (CL1) with an alert fallback; the boundary is keyed
    by the tab id, so moving to another tab clears a failure.
- `src/components/admin/slots.ts`: the tab contract (owner tracers AU1-AU5, `AdminTabProps = { onTab }`), the URL
  helpers and the board's text.
- `src/components/admin/{overview,accounts,lorekeeper,features}/index.tsx`, `maintenance/index.tsx`: stubs that render
  nothing (`OverviewTab`, `AccountsTab`, `LorekeeperTab`, `FeatureSwitchesTab`, `MaintenanceTab`).
- `src/components/admin/admin.css`: the shell's styles and the shared tab classes (`adm-card`, `adm-card-h`,
  `adm-row`, `adm-row-t`, `adm-muted`).

## AD0 stub (swap at merge)

`src/components/admin/shell/owner.ts` `useAppOwner()` returns `{ isOwner: false }` for everyone until AD0's
`convex/appAdmin.ts` (`appAdmin.me`) exists, so the page shows 'Not allowed' to all. At merge, replace its body with
`return useQuery(api.appAdmin.me);` (the comment in the file has the exact code). Nothing else changes. The unit test
mocks this module, so it keeps passing after the swap except the one case that pins the stub ("until AD0 merges, the
owner stub says nobody is the owner"), which should be deleted with the swap.

## Decisions

- Design vs plan: the plan says "kicker 'Owner only'"; the design has 'Owner only' as the header badge and 'Whole app ·
  every campaign' as the kicker. Both are rendered as the design draws them.
- The design's side nav is the ARIA tablist (the plan asks for ARIA tabs); no avatar menu in the header (the avatar
  popover needs a campaign; AU6 adds the App admin link to Preferences).
- Buttons: the back link and 'Back to the main menu' use the glass buttons (`brandButton`, cancel / confirm).

## Tests

- `tests/unit/admin/shell.test.tsx`: gate (loading, non-owner `false` / `null`: 'Not allowed', no tablist, no tab
  mounted; owner header), tabs (order, default, `?tab=`, bad value, click keeps other params, Overview removes the
  param, keyboard), only the selected tab mounts, a failing tab's alert, stubs render nothing, URL helpers.
- `tests/e2e/admin-shell.spec.ts`: signed-in non-owner 'Not allowed' + axe + link back; signed-out redirect to sign-in.
  The owner's frame in a browser waits for AD0 (AX's superadmin spec).
- `tests/unit/route-error.test.tsx` (existing) covers the new `error.tsx`.
