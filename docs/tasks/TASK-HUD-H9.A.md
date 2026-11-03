# TASK-HUD-H9.A: the Combat Map app bar

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 10, batch A, tracer H9.A (boards Main, GMDesktop, GMTablet,
PlayerTablet; HANDOFF "App bar"). Questions Q1, Q2, Q3 answered 2026-11-04 (`.omc/plans/combat-hud-v2-delta.md`,
"User answers"). Mode: replace. No server change, no codegen.

## What landed

- **The bar, on the Combat Map only (Q2 c).** `campaign-shell.tsx` renders `CombatAppBarFrame`
  (`src/components/app-bar/`) on `/campaigns/<id>/combat-map` and the tall art header everywhere else (the sprite
  packs page included). The bar: back ('Back to main menu'), the DAGGERHEART wordmark, the campaign nav, then on the
  right the Lorekeeper pill, a full-screen button, the GM's gear and the avatar. 56 px on desktop, 52 px at tablet
  width (761-1180 px, the HUD's breakpoints) with the wordmark hidden, the Lorekeeper icon only and every control a
  44 px touch target. A phone (<= 760 px) keeps today's art header and gets no bar.
- **`--app-bar-h`.** The frame sets it to 56 px / 52 px / 0 (phone, or bar hidden) for H9.0's
  `calc(100dvh - var(--app-bar-h, 0px))` HUD height. Until H9.0 merges, the HUD is still 100dvh under the bar (the page
  scrolls by the bar's height, less than under the old header).
- **Nav (Q1 a).** One `CampaignNav` (moved from the shell to `app-bar/nav.tsx`, same idle full prefetch) draws both the
  header and the bar from `CAMPAIGN_SECTIONS` (no list of its own, so Journal JX1's change flows through), `gmOnly`
  respected, accessible name 'Campaign sections'. The bar leaves out the Lorekeeper section (it is the pill), marks the
  current page gold (`aria-current="page"`) and puts the green live dot (and a screen-reader '(live)') on Combat Map
  while a map is live (GM: any map in `combatMaps.list` is live; player: `combatMaps.live` is not null: the same
  subscriptions `useCurrentMap` already holds on this page, so no new query).
- **Lorekeeper pill.** 'Ask the Lorekeeper' (gold pill, sigil + text; icon only on tablet). It opens the existing
  drawer through a small store (`app-bar/lorekeeper-store.ts`; the drawer reads it, and re-exports
  `openLorekeeperDrawer` from `lorekeeper/drawer/index.tsx`); focus returns to the pill on close. While
  `lorekeeper.available` loads or is false it is a link to the Lorekeeper page instead. The drawer's floating pill is
  no longer rendered on the Combat Map at any width (it was hidden at <= 1180 px before); on a phone the art header's
  nav still links to the Lorekeeper page. The store lives in `app-bar/`, not in the drawer module, because the drawer
  imports the shell and the shell imports the bar.
- **Full screen (Q2 c).** 'Full screen: hide the app bar' removes the bar (and asks the browser for full screen where
  it can; a refusal changes nothing). The way back: a small floating button top-left, 'Show the app bar' (32 px, 44 px
  at tablet width, focused when the bar hides), or Escape (ignored while a dialog or popover is open, so Escape
  closes that first). Leaving browser full screen also brings the bar back. Focus returns to the full-screen button.
- **Gear and avatar (Q3 c).** `app-bar/account.tsx` holds the two placeholders config S1 replaces
  (`CampaignSettingsButton`, `PreferencesButton`). Choice (the less throwaway one): the GM's gear opens a small native
  popover 'Campaign settings' with a **Players** button (today's Players dialog: the art header's Players button is not
  on the Combat Map, so the GM keeps it) and the note 'More campaign settings are on the way.' The avatar ('Your
  preferences') shows 'GM' for the GM and the player's own character's portrait (the first `partySummary` row they can
  edit; uploaded image or design art through next/image, else the initial); it opens 'Your preferences are on the
  way.'

## Files (owns)

| File | Change |
|---|---|
| `src/app/(gm)/campaigns/[campaignId]/campaign-shell.tsx` | The art header is a value; on the Combat Map it goes to `CombatAppBarFrame` (shown on a phone only, art not preloaded there). `CampaignNav` / `useAfterIdle` moved to `app-bar/nav.tsx`. `openPlayers` callback. |
| `src/components/app-bar/index.tsx` | New: `CombatAppBarFrame`, the live nav, Lorekeeper pill, full-screen state. |
| `src/components/app-bar/nav.tsx` | New: `CampaignNav` (`variant: "header" \| "bar"`), `navSections`. |
| `src/components/app-bar/account.tsx` | New: the S1 slots (gear, avatar) as placeholders. |
| `src/components/app-bar/lorekeeper-store.ts` | New: the drawer's open state, shared with the pill. |
| `src/components/app-bar/app-bar.css` | New: board `.abar` / `.ab-*` sizes and colours, tablet and phone rules, popovers, floating button. |
| `src/components/lorekeeper/drawer/index.tsx` | Open state from the store; no floating pill on the Combat Map; re-exports `openLorekeeperDrawer`. |
| `tests/unit/app-bar.test.tsx` | New: nav order / gmOnly / current / live dot, pill and store, full screen and Escape, gear and avatar. |
| `tests/e2e/app-bar.spec.ts` | New: GM and player, keyboard pill and full screen, gear Players, axe at 1440x900, 1024x768 and 390x844, touch targets at 1024. |
| `tests/e2e/visual/HUD-H9.A.spec.ts` | New: shots (E2E_VISUAL=1). |
| `tests/e2e/combat-map-shell.spec.ts`, `tests/e2e/lorekeeper-shell.spec.ts` | Unchanged (their nav assertions hold: same accessible names). |

## Checks

- `pnpm lint` (touched files), `pnpm typecheck`, `vitest tests/unit/app-bar.test.tsx`.
- e2e (ports 3689 / 3789, `--workers=1`): `app-bar.spec.ts`, `combat-map-shell.spec.ts`, `lorekeeper-shell.spec.ts`,
  `sessions-hub.spec.ts` (nav order), `hud-phone-sheets.spec.ts` (pill hidden on a phone).
- Shots: `test-results/visual/HUD-H9.A/` (`gm-bar-1440.png`, `gm-bar-1024.png`, `player-bar-1440.png`,
  `player-bar-1024.png`, whole pages, settings popover, full screen, phone).

## Notes for the orchestrator

- H9.0 sizes the HUD with `--app-bar-h`; this tracer sets it.
- Config S1: replace `CampaignSettingsButton` / `PreferencesButton` in `app-bar/account.tsx`; the bar imports only
  those names. Journal JX1: edit `CAMPAIGN_SECTIONS`; both navs follow.
