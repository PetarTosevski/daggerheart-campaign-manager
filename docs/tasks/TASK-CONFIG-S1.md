# TASK-CONFIG-S1: Campaign settings panel and Preferences popover shell

Plan `.omc/plans/config.yaml`, wave 1, tracer S1; briefs `.omc/plans/config-briefs.md` (S1 block, "User answers
2026-11-04", "Revision 2026-11-05"); bead dcm-jh6d.4. Design `reference/designs/config/Settings.dc.html`. Mode: add.
No server change, no codegen. Built on the recommended defaults; no open question (N1-N11) touches the shell.

## What landed

- **Two buttons, one component each, in two places.** `CampaignSettingsButton` and `PreferencesButton` in
  `src/components/app-bar/account.tsx` replace HUD H9.A's placeholders. They keep the same export names, so
  `app-bar/index.tsx` is unchanged. The art header (`campaign-shell.tsx`) renders the same two after the nav (and
  after the Players button, which stays until SX).
  - The gear (`aria-label` 'Campaign settings', `aria-haspopup="dialog"`, `aria-expanded` from the URL) shows for
    `campaign.role === "gm"`, so the creator and, after G1, co-GMs get it.
  - The avatar ('Your preferences', the design's and H9.A's name) shows for everyone, with H9.A's face: 'GM', or the
    player's own character portrait / initial.
  - Both are glass tools (`BrandButton` / `brandButton({ variant: "tool", icon, round })`, which since GLASS-G0 is
    `glassButtonClass({ role: "tool" })`). In the art header they are 40 px dark discs on the art (`.cfg-acct`); in
    the bar they stay 44 px touch targets.
  - Gone: H9.A's interim Players popover on the gear and both 'on the way' notes. The bar still passes `onPlayers`;
    the gear ignores it (prop kept optional so `index.tsx` is untouched).
- **Campaign settings slide-over** (`config/shell/panel.tsx`, design `.setp`).
  - A native modal `<dialog>`, 640 px on the right: focus trapped, Escape and the backdrop close it, focus returns to
    the gear. There is no slide with `prefers-reduced-motion`, and none under `[data-reduce-motion]` once U6b sets
    it.
  - Contents: kicker '<campaign name> · GM only', H2 'Campaign settings', the side nav 'Settings sections' (Table /
    House rules / Players / Lorekeeper / Sessions, the current one `aria-current="true"`, focused on open), the
    section's H3 ('At the table', 'House rules', 'Players', 'Lorekeeper', 'Sessions') over its slot, and the footer
    'Changes save as you make them and reach every player at once.'.
  - On a phone (≤ 640 px) it takes the full width, and the nav becomes a scrolling row.
  - Mounted once per page by `ConfigMounts`, for the GM only. A player with `?settings=` in the URL gets nothing.
- **URL state.** `?settings=table|rules|players|lorekeeper|sessions`. A bad value opens Table; closing removes the
  param and keeps every other param (the Journal's `tab`, `s`, `sv`, ...). The shell writes it with
  `history.replaceState`, which Next 16 syncs into `useSearchParams` with no server round trip and no history entry.
  Readers sit in a `Suspense` (the gear's fallback is the closed gear).
- **Preferences popover** (`config/shell/preferences.tsx`, design `.pm-pop`).
  - A native `popover="auto"` with `role="dialog"`: light dismiss, Escape, top layer (so the art header's
    `overflow: hidden` doesn't clip it). It is placed under the avatar on click.
  - Contents: the face, the account name (else 'You'), 'Game Master' / 'Player' · campaign, the label 'Saved to your
    account · follows you to every device', the `PreferenceRows` slot, the `AppAdminLink` slot (renders nothing),
    'Campaign settings' (GM; it closes the popover and opens the panel) and 'Sign out' (the existing
    `useAuthActions().signOut` then `/signin`, as the main menu's Settings dialog does).
  - The body renders only while the popover is open, so its queries run only then. The campaign name comes from the
    shell's own `campaigns.get` subscription (same args, deduplicated).
- **Slots** (`src/components/config/slots.ts`, documented like `journal/slots.ts`): file, owning tracer, export and
  props for every slot, the panel / popover layout, the URL state and the slot rules. Each stub keeps its name and
  props and renders nothing:
  - `sections/{table,rules,players,lorekeeper,sessions}/index.tsx`: `TableSection`, `HouseRulesSection`,
    `PlayersSection`, `LorekeeperSection`, `SessionsSection`, all with `SettingsSectionProps = { campaign }`.
  - `prefs/index.tsx`: `PreferenceRows`. `prefs/admin-link.tsx`: `AppAdminLink`. Both take `{ campaignId, isGm }`.
  - `presence-beat.tsx`: `PresenceBeat`, mounted once by `ConfigMounts`.
  - `spotlight-ping.tsx`: `SpotlightPing`, mounted once by `ConfigMounts`.
- **Error boundaries (CL1).** Every slot, the panel, the popover body, the account line and the face sit in their own
  `SlotBoundary`. A section's boundary is keyed by the section id (not live content), so a failed section resets on
  switch.
- **CSS.** `src/components/config/config.css` holds the shell plus shared row classes for the slots (`cfg-row`,
  `cfg-row-t`, `cfg-hint`, `cfg-lbl`, `cfg-muted`, `cfg-sw` switch, `cfg-seg` segmented). In
  `app-bar/app-bar.css`, H9.A's `.ab-ava` and `.ab-pop*` rules are removed.

## Decisions

- **The side nav is not glass.** It keeps the design's own look (`.sn`, gold current), like page tabs (G0 note: tabs
  stay as they are). Every button inside the panel and popover is glass: ✕ cancel, footer buttons neutral.
- **The avatar's name stays 'Your preferences'** (design, H9.A, existing specs). The acceptance says 'Preferences';
  role queries for 'Preferences' still match it.
- **The 'Player' chip in the art header stays** for players (not in S1's scope to remove).
- **The section H3 is the shell's**, so empty stubs still show where they go. Slots render the rows and the board's
  hint line under it.
- **The callout** 'Settings and Preferences live here' is not built (acceptance).

## Files

| File | Change |
|---|---|
| `src/components/app-bar/account.tsx` | Real gear and avatar (same exports); placeholders, Players popover, notes gone. |
| `src/components/app-bar/app-bar.css` | `.ab-ava`, `.ab-pop*` rules removed (the buttons are glass, faces in config.css). |
| `src/app/(gm)/campaigns/[campaignId]/campaign-shell.tsx` | Gear + avatar after the nav in the art header; `ConfigMounts` once. |
| `src/components/config/slots.ts` | New: slot contract, URL helpers, text constants, prop types. |
| `src/components/config/config.css` | New: shell and shared row styles. |
| `src/components/config/shell/{index,panel,preferences,avatar,url}.ts(x)` | New: mounts, slide-over, popover body, face, URL state. |
| `src/components/config/sections/*/index.tsx`, `prefs/index.tsx`, `presence-beat.tsx`, `spotlight-ping.tsx` | New stubs. |
| `src/components/config/prefs/admin-link.tsx` | New stub. **Outside S1's owns** (see below). |
| `tests/unit/config/s1-shell.test.tsx` | New: URL parsing, panel open / switch / close / Escape / bad value, sections, mounts, popover GM / player. |
| `tests/unit/app-bar.test.tsx` | Gear opens `?settings=table`; avatar faces; placeholder tests replaced. |
| `tests/e2e/config/helpers.ts` | New: locators and openers for the config specs. |
| `tests/e2e/config-shell.spec.ts` | New: GM and player, art header and app bar, 1440 / 1024 / 390, keyboard, axe, shots. |
| `tests/e2e/app-bar.spec.ts` | The gear opens Campaign settings; the player's popover shows the account label. |

## Out of owns

- `src/components/config/prefs/admin-link.tsx` (new stub): AU6 owns only this file and must render "in S1's App admin
  slot", and S1 owns only `prefs/index.tsx`. So the stub has to exist before AU6, and no other owner could create it.
  It is 15 lines and renders nothing. `tracer:guard` flags it.
- Not edited, but they need a change: `tests/e2e/visual/GLASS-G1.spec.ts` (E2E_VISUAL only) clicks the bar's gear and
  expects H9.A's 'Players' button in the popover. The gear now opens Campaign settings, so that shot step needs
  `settingsPanel` instead. `visual/HUD-H9.A.spec.ts` still passes (it only expects a 'Campaign settings' dialog).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest: `tests/unit/config/s1-shell.test.tsx` (10) and `tests/unit/app-bar.test.tsx` (9) pass. Full suite
  (`--maxWorkers=1 --testTimeout=120000`): 520 files, 11061 passed, 1 expected fail.
- e2e on ports 3901 / 4001, `--workers=1`:
  - `config-shell.spec.ts` passes, both managed and with `E2E_REUSE_SERVERS=1`.
  - With reused servers, 28 passed across `app-bar`, `combat-map-shell`, `dashboard`, `players`, `a11y-smoke`,
    `glass-foundation`, `lorekeeper-shell` and `sprite-packs-shell`.

## Shots

`test-results/config-s1/` and `/mnt/c/Users/Petar/Downloads/dcm-screens/config-s1/`: `gm-dashboard-header-1440`,
`gm-settings-table-1440`, `gm-preferences-1440`, `gm-combat-settings-1440`, `gm-combat-preferences-1440`,
`gm-combat-settings-1024`, `gm-settings-390`, `gm-preferences-390`, `player-preferences-1440`,
`player-combat-preferences-1440`, `player-preferences-390`.

## Notes for the next tracers

- U1-U5: fill your section's export and render rows with the `cfg-row` classes. The H3 is already there. Read
  settings from `props.campaign` (live).
- U6a: fill `PreferenceRows`. The account label is the shell's.
- U3p / U6d: fill `PresenceBeat` / `SpotlightPing`. They are already mounted once, inside a boundary.
- SX (N9 a): to open the Players section from the header's Players button, call `openSettings("players")` from
  `@/components/config/shell`.
- AU6: fill `AppAdminLink` (rendered after the rows, inside its own boundary).
