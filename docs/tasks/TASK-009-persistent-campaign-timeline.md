# Task 009 — Persistent Campaign Timeline

## Status

Complete — implemented and verified on 2026-07-21. See "Implementation and
verification" below.

## Objective

Create a shared authenticated application shell with a persistent top-center crescent timeline.

## Phase definitions

### Day

1. Dawn
2. Sunrise
3. Morning
4. Forenoon
5. Midday
6. Afternoon
7. Civil Twilight

### Night

1. Nautical Twilight
2. Astronomical Twilight
3. Evening
4. Night
5. Midnight
6. Dead of Night
7. Pre-Dawn

## Scope

Implement:

- Shared authenticated root layout.
- Persistent navigation.
- Seven-icon responsive crescent timeline.
- Current, completed, and upcoming states.
- Week, cycle, and phase text.
- Reduced-motion support.
- Refresh after Task 008 advancement.
- Accessibility and responsive tests.

## Structure

```text
AuthenticatedLayout
├── PrimaryNavigation
├── GlobalHeader
│   └── CampaignTimeline
└── RoutedPageContent
```

## Requirements

- Timeline remains mounted across route navigation.
- No fake Week 1 state during loading.
- All 14 phase combinations render correctly.
- Timeline contains no advancement logic.
- Login and unauthenticated routes do not show campaign state.
- Current phase uses `aria-current`.
- State is not communicated by color alone.

## Acceptance criteria

- One persistent authenticated shell exists.
- Timeline stays visible on every authenticated route.
- Canonical state renders accurately.
- Advancement refreshes the timeline.
- Mobile, accessibility, and reduced-motion checks pass.

## Implementation and verification

Implemented on 2026-07-21. The authenticated shell lives in the `app/(app)/`
route group at `app/(app)/layout.tsx` — a persistent shared layout, not a
per-page or per-segment one. The route group adds no URL segment, so
`/dashboard` is unchanged, and the dashboard route now lives at
`app/(app)/dashboard/`. Next.js preserves a shared layout across navigation
between routes that share it, so the navigation and timeline mount once and are
never remounted when the route changes. Any future authenticated route (Task
010+) placed under `app/(app)/` inherits this same shell automatically without
recreating it. The dashboard page's former inline header was moved into the
shell.

### Components added

- `components/layout/primary-navigation.tsx` — client component; app identity,
  primary nav with `aria-current="page"` on the active route, and sign-out.
- `components/layout/global-header.tsx` — server component; the region that
  hosts the timeline.
- `components/campaign-timeline/campaign-timeline.tsx` — display-only server
  component. Exports `CampaignTimeline`, plus `CampaignTimelineFallback`
  (neutral loading, no fabricated Week 1) and `CampaignTimelineEmpty`
  (no active campaign). All phase and status values are derived from
  `lib/domain/campaign-time`; the component contains no advancement logic and
  never mutates state.

### Files changed

- Added the three components above.
- `lib/data/campaign-time.ts` — added `getCampaignTimelineState`, a focused
  canonical-state read (no history) for the shell.
- `app/(app)/layout.tsx` — the persistent authenticated shell (route-group
  layout): auth guard, navigation, global header, and the timeline behind its
  own `Suspense` boundary.
- Moved the dashboard route into the group: `app/dashboard/*` →
  `app/(app)/dashboard/*` (URL unchanged). `app/(app)/dashboard/page.tsx`
  dropped its inline header and unused session read; the shell owns that chrome.
- Updated the nine `@/app/dashboard/*` server-action import paths (five
  components, four test mocks) to `@/app/(app)/dashboard/*`.
- Tests: `tests/unit/campaign-timeline.test.tsx`,
  `tests/unit/primary-navigation.test.tsx`, `tests/e2e/timeline.spec.ts`.

### Migrations and RLS

None. Task 009 introduces no schema and no policy changes; it reads canonical
state established by Tasks 003, 007, and 008.

### Accessibility verification

- Each phase indicator has an explicit `aria-label`
  (`Day N, <phase>, <status>`); the current phase carries `aria-current="step"`.
- Status is conveyed by shape and text (completed check badge, "Now" marker,
  outlined upcoming) and by the accessible name, never by color alone.
- Primary navigation exposes a `navigation` landmark and visible keyboard focus
  (`focus-visible` ring) on links.
- The timeline is display-only, so it contains no focusable controls; this is
  asserted by test.

### Responsive verification

- The week, cycle, and current phase summary is visible at every breakpoint,
  including mobile, so campaign information is never removed on small screens.
- Phase labels are hidden on mobile, condensed on tablet (`md`), and full on
  desktop (`lg`); the crescent arc offsets apply from `sm` upward.

### Reduced motion

Transitions are gated behind Tailwind's `motion-safe:` variant and the loading
skeleton uses `motion-reduce:animate-none`, so users who prefer reduced motion
see no animation.

### Verification commands (2026-07-21)

- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `RUN_SUPABASE_DB_E2E=1 pnpm test`: 20 files, 107 tests passed (9 added).
- `pnpm build`: passed. The only warning is the pre-existing Next.js
  middleware-to-proxy deprecation.
- The live Playwright timeline spec (`tests/e2e/timeline.spec.ts`) is gated
  behind `RUN_SUPABASE_E2E=1` like the existing suites and was not run in this
  pass.
