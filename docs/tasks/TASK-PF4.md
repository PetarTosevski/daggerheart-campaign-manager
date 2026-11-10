# TASK-PF4: Convex speed pass 4 (dcm-uh6r)

Status: Review. Plan `.omc/plans/p2-bugs-perf4.yaml`, tracer PF4. Branch `perf/PF4` from `rebuild` (a3d02ec0).
Orchestrator: regenerate `convex/_generated` (new modules `combatRidersReads`, `lib/fileClaims`, `lib/settingsRow`).

## How it was measured

`node scripts/perf/convex-bundles.mjs` (new, committed): bundles each Convex entry with the Convex CLI's esbuild
settings (one entry at a time, no chunk splitting, so a file holds everything that entry loads), prints the size, and
with `--runs N --baseline <dir>` the paired median of N cold `import()`s of each bundle in a fresh node process
(baseline bundle and new bundle alternate, so host-load drift hits both). `--top N` lists the largest inputs, `--why
<file>` the shortest import chain. A CPU profile of single imports (scratch script, not committed) split the time into
compile (grows with bytes), zod schema construction and the rest.

## What the profile showed

A cold import of a hot HUD read spent its time in three places: compiling the bundle (about 20 ms per MB on this
machine), building zod schemas at module load (25-45 ms whenever the bundle held the character sheet schema, even for
a call that never parses a sheet), and evaluating eager data literals (the 427 KB SRD adversary table about 9 ms; a
function-wrapped literal is only pre-parsed, about 1 ms). Pass 4 attacked all three.

## Changes (no behaviour, validator, wrapper or returns change)

1. **Character sheet schemas built on first parse.** `src/lib/validation/character-schemas.ts` builds them inside
   `characterSchemas()` (cached); `./characters` keeps every export (it calls the factory, so app code is unchanged);
   `convex/lib/characterSheet.ts` calls the factory inside `readSheet` / `storedSheet`. Photo-import limits moved to
   zod-free `src/lib/import/photo-types.ts` (`convex/lib/files.ts` used to load the draft schema for them).
2. **SRD adversary table built on first use.** `adversaryTable()` in `src/lib/srd/adversaries.ts` (generator
   `scripts/srd/gen-adversaries.mjs` emits the same shape); `ADVERSARIES` stays as a `/* @__PURE__ */` const for app
   code; Convex callers and `srdAdversary` use the function.
3. **`combatActionsReads.riders` -> `combatRidersReads.riders`.** `targets` needs the vision scene and the adversaries'
   riders, `riders` the cards' and features' effects; apart each loads its own half. Callers, unit mock and authz
   entry renamed.
4. **Fear helpers out of entry modules.** `fearValueValidator`, `seesFear`, `hideFearNumbers` moved to
   `convex/lib/fearVisibility.ts` (campaigns.ts / feed.ts re-export). Importing them from `./campaigns` loaded every
   function of campaigns.ts.
5. **Beastform and stance feature tables lazy** (`beastformEffects()`, `stanceEffects()`), the Beastform state schema
   in its own re-exported module, so bundles that load the Beastform helpers build no schema.
6. **Upload helpers and the settings row out of heavy modules.** `convex/lib/fileClaims.ts` (claimFile, isClaimed,
   isAllowedImage, deleteOwnFile, deleteFilesOf) and `convex/lib/settingsRow.ts`; `lib/files.ts` / `settings.ts`
   re-export. `lib/files.ts` registers internal functions and imports the sheet, codex and world-map code, and
   `settings.ts` its schemas, so combatMaps and charactersReads loaded all of it.

## Before / after (hot HUD reads)

Bundle size (Convex esbuild settings, minified identifiers) and paired cold node-import median (9 runs, load 2.2-2.7).
"Before" is `rebuild` at a3d02ec0; `combatRidersReads` before = `combatActionsReads` (riders lived there).

| Module | MB before | MB after | ms before | ms after |
| --- | ---: | ---: | ---: | ---: |
| combatHud | 1.48 | 1.44 | 50 | 32 |
| combatVision | 1.44 | 1.44 | 41 | 30 |
| combatTokensReads | 0.77 | 0.80 | 32 | 14 |
| combatRequestsReads | 1.31 | 1.32 | 41 | 25 |
| combatCardsReads | 1.39 | 1.39 | 41 | 27 |
| combatFeaturesReads | 1.08 | 1.09 | 42 | 28 |
| charactersReads | 0.30 | 0.26 | 34 | 10 |
| restsReads | 1.09 | 1.01 | 43 | 23 |
| combatActionsReads (targets) | 2.46 | 2.26 | 58 | 41 |
| combatRidersReads (riders) | 2.46 | 1.45 | 57 | 30 |
| adversaryActionsReads | 2.65 | 2.68 | 54 | 38 |
| featurePromptsReads | 2.20 | 2.23 | 56 | 40 |
| hitKeywordsReads | 0.30 | 0.30 | 27 | 15 |
| cloakPromptsReads | 0.25 | 0.25 | 22 | 9 |
| allyPicksReads | 0.12 | 0.12 | 5 | 5 |
| combatAreas | 0.86 | 0.86 | 33 | 16 |
| combatMaps | 0.35 | 0.17 | 36 | 7 |
| combatSpotlight | 0.33 | 0.33 | 26 | 12 |
| ruleSettings | 0.15 | 0.15 | 5 | 5 |
| feed | 0.34 | 0.15 | 22 | 6 |
| deathMoves | 1.06 | 0.97 | 44 | 19 |
| combatEffects | 0.95 | 0.95 | 37 | 23 |
| combatMapStyle | 0.15 | 0.15 | 7 | 7 |
| combatScenes | 0.35 | 0.35 | 29 | 15 |
| **Sum of medians** | | | **841** | **477** |

A few sizes grew by 0.01-0.03 MB: the function-wrapped tables gained indentation (the Convex bundler keeps
whitespace). A call that does parse a sheet still builds the schemas, once, on its first `readSheet`; the saving is for
the many HUD calls that do not (prompt queries with nothing open, map, spotlight, scene, feed).

## Targets the plan named, and what the numbers said

- **adversaryActionsReads / featurePromptsReads / combatActionsReads (2.2-2.7 MB).** The views are not light: `hitView`
  and `rebuildWindow` replay the reaction window (card and feature runners, adversary stat blocks), `allyRolls` resolves
  visible enemies through `Creatures` (stat blocks) and the vision scene, `targets` reads adversary riders. No light
  subset exists to split out; the bytes are data tables those paths can reach. What paid: lazy adversary table and
  sheet schemas (-12 to -18 ms each), and splitting `riders` from `targets`.
- **combatHud.** party / scene alone would be 1.13 MB vs 1.48 (about 13 ms of compile), but `partyMemberOf` alone is
  0.96 MB (derived thresholds, condition markers), and moving `sheet` means renaming about 30 references (optimistic
  updates, 15 test files, 5 e2e specs). Not done; the Fear and schema changes took combatHud 50 -> 32 ms instead.
- **combatVision.** Its reads need `loadScene` (1.15 MB: sprite manifest for glow, areas) and `buildView`; a reads-only
  module would drop about 0.1 MB. Not worth the move.

## What is left

- Remaining eager zod schemas in hot bundles (each a few ms): `src/lib/frames/extras/motherboard.ts` (combatHud,
  combatFeaturesReads, combatVision), `src/lib/domain/combat-map/spec.ts` and `src/lib/sprite-packs/manifest.ts`
  (combatVision, combatActionsReads, featurePromptsReads), `src/lib/domain/rest/frame-hooks/index.ts` (restsReads).
  Same fix as here: a cached factory or an own module re-exported, where the hot path does not parse.
- Remaining eager SRD literals: `DOMAIN_CARDS` (109 KB), `TIERED_WEAPONS` / `TIERED_ARMOR` (120 KB), equipment,
  subclasses, classes, heritage, `FEATURE_CLASSIFICATION`: about 0.5 MB evaluated at load in most heavy reads
  (about 5-10 ms). Needs `srd/index` lookups built from functions, like `adversaryTable()`.
- Compile time still grows with bytes (about 20 ms/MB here); the 2+ MB reads are data the replay paths can reach.
  Cutting them further means data tables that compile cheaply (function-wrapped or JSON strings parsed on first use).

## Checks

- `pnpm lint` 0 errors, `pnpm typecheck` clean, vitest (maxWorkers=2) 677 files / 14154 tests pass,
  `pnpm tracer:guard .omc/plans/p2-bugs-perf4.yaml PF4` OK.
- e2e (ports 3105 / 3322, 1 worker, load about 2-3): `hud-sheet.spec.ts` 3/3 pass (`:17`, `:90`, `:146`).
  `combat-actions-flow.spec.ts:176` failed twice, at different steps (line 255, then 339): a card's Use button is
  disabled with "The GM has the spotlight · reactions only". A roll with Fear hands the GM the spotlight, and since rule
  switch RS2 (1c016da1, 2026-11-06) players then wait, so the spec breaks whenever the dice give Fear before a card
  step. A spec problem from RS2, not load: the local backend logged no "maximum duration" (1 s) timeout in either run
  (0 of all calls; pass 2 counted 10 in 12196).
