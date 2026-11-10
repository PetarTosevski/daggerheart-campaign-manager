# TASK-NB3: client JS per route back down

Status: Review. Plan: `.omc/plans/next-batch-1110.yaml`, tracer NB3, bead dcm-xgbe. Branch `nb3-bundles` from master
079970bf.

## Goal

Client JS per route had regrown since PF11 (`docs/performance.md`, "Re-measure on an idle host"). Bring it down with
dynamic imports and lighter lookups, with no change in behaviour, and record `bundle.mjs` numbers before and after.

## Result (`node scripts/perf/bundle.mjs`, raw / gzip KB of initial JS)

| Route | PF11 | Before | After |
|---|---:|---:|---:|
| Dashboard | 1,153 / 430 | 1,375 / 518 | 1,281 / 491 |
| Party | 1,336 / 468 | 1,798 / 622 | 1,095 / 427 |
| Character sheet | 1,479 / 522 | 1,983 / 691 | 1,982 / 690 |
| Combat Map | | 2,588 / 903 | 2,547 / 887 |
| Adversaries | | 2,223 / 753 | 1,397 / 490 |
| Codex, World Map, Journal, Lorekeeper, packs, `[section]` | | | −153 raw each |

The full table and what is left are in `docs/performance.md`, section "NB3".

## Changes

- `src/lib/party/portraits.ts` (new): `PORTRAITS`, moved out of `src/lib/srd/art.ts`, which re-exports it.
- `src/components/party/portrait-source.ts` (new): `portraitSource`, `portraitAncestryId`, `fitWithin`;
  `party-display.ts` re-exports them. `portrait.tsx`, `codex/gallery.tsx`, and (outside owns) the shell's
  `config/shell/avatar.tsx` and `config/sections/players/roster.tsx` import from it.
- `src/components/party/level-up/party-button.tsx` (new): `PartyLevelUpButton`, re-exported by the level-up index.
- Party roster (`app/.../party/roster.tsx`, `page.tsx`): SRD leaf lookups instead of the barrel, the level-up badge and
  button from their own modules, a typed `"motherboard"` constant instead of `FRAME_OF` (zod), and Evasion in
  `party/roster-evasion.tsx` behind `next/dynamic` (preloaded when the roster module runs; "…" while it loads).
- Adversaries page: `EncounterTracker`, `EnvironmentCatalogue` and `OpenedAdversary` with `next/dynamic` (loading line
  "Loading…", the page's existing style), inside the existing boundaries.
- Combat Map page: `EditorLayer`, `EditToolsPanel` and `ScenePanel` with `next/dynamic`; `EditorStateProvider` static.
- Load Campaign (`chronicle.tsx`): "Resume Campaign" is `<Link prefetch>` (full prefetch of the dashboard's payload
  and code).

## Outside owns (minimal)

- `src/components/config/shell/avatar.tsx`, `src/components/config/sections/players/roster.tsx`: one import line each
  (`portraitSource` from `@/components/party/portrait-source`). Without it the shell keeps the subclass, ancestry and
  community lists on every campaign route.

## Tests

- New `tests/unit/party/lazy-boundaries-nb3.test.ts` (9 tests): the light modules' imports, the re-exports, the roster's
  dynamic Evasion and missing barrel, the Adversaries and Combat Map dynamic imports with their boundaries, the Resume
  prefetch.
- `pnpm vitest run --maxWorkers=2` on the touched areas: party-display, lazy-boundaries (1, 2, NB3), srd-data,
  sheet-helpers, party-card, level-up, tier-boxes, level-up-draft, sheet-render, config, app-bar, route-error,
  free-roll, dice-ui, dashboard, hud, combat-hand, adversary-panel, wizard-steps: 76 files, 911 tests pass.
- `pnpm lint`, `pnpm typecheck` pass. No e2e run (host load rule); `tests/e2e/character-sheet.spec.ts` reads
  `roster-evasion` with `toHaveText`, which waits for the lazy cell.

## Not measured

- Load → Dashboard timing (`measure.mjs --profile wan`, target 600 ms) needs the e2e stack; run it at merge.

## Follow-ups (outside owns)

- `src/lib/domain/dice/index.ts`: a leaf for the free-roll helpers and `OUTCOME_LABEL` without
  `feature-effects/owned.ts` (−73 KB on the dashboard).
- Config panel (`components/config/shell`): load `CampaignSettingsPanel` when the gear opens (about 60-75 KB on every
  campaign route).
- Character sheet: page two and three behind their tab, after the four sheet tests use `findBy`.
- Combat Map: lazy per-class card and feature effect registries in `src/lib/srd`, and `derived.ts` off the
  `@/lib/srd` barrel.
- Adversaries: a light catalogue list with stat blocks on open (`components/adversaries/catalogue`).
- `partySummary` could send class, subclass, ancestry and community names, so the dashboard drops those lists (75 KB).
