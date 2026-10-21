# TASK-D12-H20: Accessibility and tablet pass - entry flow, Settings, campaign shell and dashboards

Plan `.omc/plans/d12-hardening.yaml`, tracer H20 (depends on H1, H4, H17). User answers Q6 and Q7 (2026-10-21): zero
serious or critical axe findings on every page, as the GM and as a player, smaller findings listed and not fixed;
768x1024 and 1024x768 with no sideways scroll, the menu and main button visible, 44 px targets, screenshots for review.
Bead dcm-o95 (title-menu footer contrast) is fixed here.

## Spec: tests/e2e/a11y-entry.spec.ts (20 tests)

Axe (H1's `expectNoSeriousA11yViolations`, WCAG 2.0/2.1/2.2 A and AA tags), no `exclude` anywhere:

| Page or state | GM | Player |
|---|---|---|
| `/signin` (signed out) | 0 serious/critical | - |
| `/` title menu, **whole page** (H1's smoke spec scanned only the nav; dcm-o95) | 0 | - |
| Settings dialog open | 0 | - |
| Join a campaign dialog open | 0 | - |
| `/new` frame select (Witherwild picked) and the Custom frame form | 0 | - |
| `/frames/<id>` intro, all 10 published frames | 0 | - |
| Name your campaign dialog | 0 | - |
| `/campaigns` (Load Campaign, list loaded) | 0 | - |
| `/join/<code>` | 0 | - |
| Witherwild dashboard (shell, nav, hero, time arc, panels) | 0 | 0 |
| Tome open | 0 | 0 |
| Players dialog, New countdown dialog, Start the session? dialog | 0 | - |
| Dashboards of five-banners-burning, beast-feast, age-of-umbra, motherboard, colossus-of-the-drylands, castle-high, reign-of-the-weredragon, dark-heart-of-andaluria, journey-to-horizon, custom (11 with Witherwild) | 0 | - |

Moderate and minor findings: **none**. Every scan returned an empty list (no annotations in the JSON report).

Tablet, at 768x1024 and 1024x768 (`test.use({ viewport })`, so the layout is chosen at load):

- No sideways scroll (`expectFitsViewport`) on `/signin`, `/`, Settings, `/new`, `/frames/witherwild`, `/campaigns`,
  `/join/<code>`, and the dashboard as GM and as player.
- The page's primary control is visible once scrolled to (vertical scroll only) and at least 44x44 px: the sign-in
  button, Create New Campaign (and every menu item), Close settings, the frame radios, Start campaign, Choose this
  Frame, Back to main menu, Join campaign, Start Session (GM) and Open the Tome (player).
- Dashboard: the Campaign sections nav is in view without scrolling and every nav link is at least 44 px.
- Full-page screenshots for review: `test-results/visual/D12-H20/<page>-<w>x<h>.png` (signin, title-menu, settings,
  new, frame-intro, campaigns, join, dashboard-gm, dashboard-player; 18 files).

## Fixes (tokens and markup, the boards' look kept)

| Finding (axe rule / check) | Where | Fix |
|---|---|---|
| color-contrast: footer "Daggerheart Campaign Ledger", `--faint` #6f6880 on #0c0b11 = 3.7:1 (dcm-o95) | `globals.css` | `--faint` lifted to #817a93: 4.8:1 on `--ink`, 4.6:1 on `--ink-2`, 4.5:1 on `--panel`. The other `text-faint` uses in H20's files are input placeholders (settings, join, players, password, custom frame, create campaign) on `--ink` / #0f0d15, which get the same lift. No file outside H20's owns uses the token. |
| 44 px: Campaign sections nav links were 40 px tall | `campaign-shell.tsx` | `min-h-10` to `min-h-11` |
| color-contrast: tome "FOR THE GAME MASTER" and "FROM YOUR FRAME SETUP" labels, #7a5b2e on #e8d9b8 = 4.47:1 | `tome-book.tsx` | #6f5530 (4.99:1), same brown family |
| color-contrast: tome page numeral "— I —", #8a7350 on #efe3c8 = 3.55:1 | `tome-book.tsx` | #735a3a (5.07:1) |
| scrollable-region-focusable: the tome's chapter body scrolls but could not take focus | `tome-book.tsx` | `tabIndex={0}`, `role="region"`, labelled by the chapter heading |
| color-contrast: Journey to Horizon locked Doom Track tiers (`opacity-70`) put #9fb2b6 at 4.45:1 | `trackers/horizon.tsx` | `opacity-75` (4.91:1) |
| color-contrast: unlit Soul Echo numbers #6f8287 on #141e22 = 4.2:1 | `trackers/horizon.tsx` | #8fa3a8 (6.4:1) |
| color-contrast: Load Campaign's big dim roman numerals (#3f3a4e, aria-hidden decoration) | `campaigns/chronicle.tsx` | Drawn as generated content (`before:content-[attr(data-numeral)]`), so they are decoration, not text (WCAG 1.4.3 exempts pure decoration); same colour and size |

## Findings listed, not fixed

- **GM Fear spiral tokens below 44 px** (bead **dcm-hlj**): the CampaignHub board's spiral shrinks each token (15% to
  9.5% of a square of at most 330 px), so at both tablet sizes tokens 3-12 are 30-42 px. They meet WCAG 2.2 AA 2.5.8
  (24 px), which the spec asserts. 44 px needs a design change.
- No moderate or minor axe findings on any page in this list.

## Shared primitives reported by H21 and H22

H21 and H22 run in parallel; their task docs did not exist when H20 finished, so no `brand/**` or `ui/**` finding was
reported to land here. Anything they find goes to a follow-up bead.

## Verification

Backend (`scripts/convex-e2e.mjs`, port 3480) and the e2e Next build (`.next-e2e-3184`, port 3184) started by hand,
Playwright with `E2E_REUSE_SERVERS=1`:

- `tests/e2e/a11y-entry.spec.ts`: the final spec passed 20 of 20 twice in a row (65 s, 2.3 min); earlier versions also passed (50 s, 58 s).
- Specs on these pages: a11y-smoke, tome, campaigns, dashboard, players, auth, horizon, fear-render,
  unauthenticated, countdowns-flow, error-boundary: 37 passed. Visual (E2E_VISUAL=1) CV1, D10-S7, A0, A2: 4 passed.
- `pnpm lint`, `pnpm typecheck` clean; `pnpm test --maxWorkers=4 --testTimeout=60000`: 211 files, 5170 passed, 1
  expected fail.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H20` passes.

Note for local builds: a Turbopack build run inside the sandbox left a broken Google-font cache in
`.next-e2e-<port>` ("next/font/google queries have exactly one entry"). Deleting that directory and building outside
the sandbox fixed it.
