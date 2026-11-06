# TASK-GLASS-G1: glass buttons outside a campaign and in the app bar

Plan `.omc/plans/glass-buttons.yaml`, tracer G1; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.2.
Built on G0 (`docs/tasks/TASK-GLASS-G0.md`) and the briefs' default answers (Q1-Q9 = a). Outside a campaign there is
no `data-viewer`, so confirm is Hope gold and cancel Fear purple (Q2 a). The app bar sits inside the campaign shell and
takes the viewer's colours (tools have no side, so they look the same for both).

## Buttons per file

| File | Button | Role | Was |
|---|---|---|---|
| `src/app/signin/password-form.tsx` | Sign in / Create account / Verify email / Send code / Set password (submit) | confirm | solid |
| `src/app/signin/google-sign-in-button.tsx` | Sign in with Google | neutral (second sign-in way: two confirms side by side, only the main one is confirm) | outline |
| `src/app/signin/e2e-sign-in-form.tsx` | Test sign-in (test builds only) | neutral | shadcn `ui/button` outline (no longer imported here) |
| `src/app/(gm)/settings-dialog.tsx` | Show backup, Restore from pasted backup | neutral | `DATA_BUTTON` |
| | Reset settings… | danger (`ml-auto` kept) | hand-styled red outline |
| | Reset confirm: Cancel | cancel | hand-styled |
| | Reset confirm: Reset | danger | hand-styled red fill |
| | Sign out | neutral | outline |
| `src/app/(gm)/join-dialog.tsx` | Cancel | cancel | outline |
| | Join | confirm (lg) | primary |
| `src/app/(gm)/join/[code]/join-by-link.tsx` | Not now (link) | cancel | outline |
| | Join campaign | confirm (lg) | primary |
| `src/app/(gm)/new/create-campaign.tsx` (name dialog) | Cancel | cancel | outline |
| | Start campaign | confirm (lg) | primary |
| `src/app/(gm)/new/frame-select.tsx` | Back (link) | cancel | outline |
| | Start campaign | confirm (lg; `px-8` dropped) | primary |
| | Preview full frame (link) | neutral | outline |
| `src/app/(gm)/new/custom-frame-form.tsx` | Tone chips | neutral + `aria-pressed` (on = gold glass) | hand-styled pills |
| `src/app/(gm)/frames/[frameId]/frame-intro.tsx` | Choose this Frame | confirm (lg) | primary xl |
| | Overview, View full art (`ml-auto` kept), Show details | neutral (lg) | pill + colour / padding utilities |
| `src/app/(gm)/campaigns/chronicle.tsx` | Resume Campaign (link) | confirm (lg; `px-7` dropped) | solid |
| | Delete / Leave (band) | danger (lg) | danger |
| | Confirm delete / leave: Keep it | cancel | outline + border colour |
| | Confirm delete / leave: Delete / Leave | danger | dangerSolid |
| | Deleted row: Restore | confirm | outline + brand colour |
| | Deleted row: Delete permanently | danger | danger |
| | Confirm permanent delete: Keep it | cancel | outline + border colour |
| | Confirm permanent delete: Delete … forever | danger | dangerSolid |
| | Deleted toast: Undo | cancel (sm) | outline + brand colour |
| | Empty list: Create a campaign (link) | confirm | solid |
| `src/components/route-error.tsx` (every `error.tsx`, `global-error.tsx`) | Try again | confirm (lg) | solid |
| | Back to the main menu / dashboard (link) | cancel (lg) | outline |
| `src/components/brand/brand.tsx` | `BackLink` (header back arrow on menu boards and the campaign shell) | tool, icon | hand-styled 44 px square |
| `src/components/app-bar/index.tsx` | Back to main menu (link) | tool, icon | `.ab-back` |
| | Full screen: hide the app bar | tool, icon | `.ab-ic` |
| | Show the app bar (floating, full screen) | neutral, icon (visible over the map; `.cab-show` wrapper keeps only the position and fade) | `.cab-show` |
| `src/components/app-bar/account.tsx` | Campaign settings gear | tool, icon | `.ab-ic` |
| | Popover: Players | neutral (`w-full`) | `.ab-pop-btn` |
| `src/components/uploads/upload-notice.tsx` | Dismiss ✕ | neutral, small icon (44 px on touch) | hand-styled 20 px |

Glass icons in the app bar are 44 × 44 (they were 36 px on desktop, 44 px on tablet); the 56 px bar holds them.

## Classes deleted

- `settings-dialog.tsx`: `DATA_BUTTON`, the Reset settings / Cancel / Reset class strings.
- `app-bar.css`: `.ab-back` (+ hover, tablet sizes), `.ab-ic` (+ hover, tablet sizes), `.ab-pop-btn` (+ hover, tablet
  min-height), the look of `.cab-show` (size, background, shadow, focus outline; only position and fade remain).
- Dead call-site utilities on glass buttons: `px-7`, `px-8`, `px-5 text-[15px]`, border / background colours, `!size-4`
  on icons (`.gb svg` sizes them), `PageHeader`'s translucent BackLink colours.

## Left alone, and why

- `title-menu.tsx` `ITEM` rows (Continue, Create, Load, Join, Settings): menu rows, per the briefs.
- `frame-select.tsx` `KindCard` (radio cards) and `FrameListItem` (list rows that select a frame): rows.
- `custom-frame-form.tsx` background swatches: art tiles.
- `settings-dialog.tsx` accent swatches (radios), the Classic / Sprites `role="switch"` slider, "Use each frame's
  default" (text link).
- `password-form.tsx` `LINK` buttons (Resend code, Forgot password?, …): plain text links.
- `frame-intro.tsx` Special Mechanics / Inciting Incident: text links into the Tome.
- `chronicle.tsx` band header (expands a campaign: a row) and the jump dots (nav).
- `app-bar/nav.tsx` section links (page nav), the Lorekeeper pill (`.ab-lk`, the board's gold pill with the sigil:
  not an icon tool) and the avatar (`.ab-ava`, a portrait).
- `campaign-shell.tsx` passes `border-white/25 bg-black/30` to `BackLink`; they no longer apply. The shell is G2's.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest (`--maxWorkers=1 --testTimeout=120000`): touched areas (`signin-password-form`, `app-bar`, `route-error`,
  `auth-session-ended`, `tests/unit/brand`) 54 passed; full suite 519 files, 11051 passed, 1 expected fail.
- e2e, servers started by hand on 3845 / 3945, `E2E_REUSE_SERVERS=1`, `--workers=1`:
  - `visual/GLASS-G1` (`E2E_VISUAL=1`): 4 passed (roles, 44 px at 1024 / 390, axe hovered).
  - `auth`, `auth-session-ended`, `signup`, `a11y-signin`, `a11y-entry`, `campaigns`, `campaign-delete-permanently`,
    `settings-backup`, `app-bar`, `error-boundary`, `unauthenticated`, `glass-foundation`: 56 / 58 on the first run;
    the two failures were the 5 s post-sign-in redirect timing out on a loaded machine (`toHaveURL("/")` still on
    `/signin`). Both passed on rerun; the rerun hit the same timeout once in another `a11y-entry` test, which then
    passed alone.

## Shots

`tests/e2e/visual/GLASS-G1.spec.ts` (`E2E_VISUAL=1`), copied to `/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g1/`:

- `signin-*`, `menu-*`, `settings-reset-*`, `join-*`, `new-frame-*`, `new-custom-*`, `new-name-*`, `frame-intro-*`,
  `join-link-*`, `chronicle-delete-*`, `chronicle-purge-*` at 1440 / 1024 / 390;
- `app-bar-{gm,player}-*` at 1440 / 1024 / 390 (a phone has the art header, no bar), `app-bar-*-hidden`,
  `app-bar-gm-settings-popover`;
- hovered: `signin-hover-confirm`, `settings-hover-{reset,cancel}`, `join-hover-confirm`, `frame-intro-hover-choose`,
  `chronicle-hover-{resume,delete}`, `app-bar-*-hover-full-screen` (each with axe run hovered);
- keyboard focus: `signin-focus-google`, `join-focus-cancel`, `frame-intro-focus-overview`, `chronicle-focus-keep`,
  `app-bar-*-focus-back`.
