# TASK-EV1: Environment stat blocks as data and an Environment tab

Status: Review. Plan: `.omc/plans/environments.yaml`, tracer EV1. Bead: dcm-bxp.46. User 2026-10-18: "also add the
environment encounters here under a seperate tab called environment". No board exists for environments
(`grep -il environment reference/designs/project/*.dc.html` finds only adversary/rules text); the tab follows the adversary
catalogue (A2 and the orchestrator's later Order chips, label gutter, type legend, collapsible tiers, aligned stat block).

## What was built
- `scripts/srd/gen-environments.mjs` (Node, no dependency):
  `node scripts/srd/gen-environments.mjs --core <core.txt> --hf <hopefear.txt> [--check]`, the same book text as
  gen-adversaries.mjs (never committed; nothing in CI runs it). Writes `src/lib/srd/environments.ts` (committed).
  - Names, tiers and types from the books' lists (CB p.242, HF p.98), each block found by its all-caps heading above the
    "Tier N Type" line (CB pp.243-251, HF pp.99-112); the CB p.240 Raging River example is skipped (it repeats p.245).
    The list's tier and type are checked against every block's own line.
  - HF tier digits are private-use glyphs (U+E540+n) mapped to n. Two Core digits the text lost, read from rendered pages:
    Choking Ash "Countdown (Loop 6)" (CB p.248), Everything You Are This Place Will Take from You "Countdown (Loop 1d4)" (CB p.250).
  - Feature questions (italic in the book, no italics in the text): the shortest run of a feature's last lines that starts a
    sentence and holds only questions. Text: "• " bullets and "1. " items become "- " lines; after a list, a capitalised
    line after a short line starts a new paragraph (The Climb, Blasphemous Might).
  - A countdown printed at the start of a feature moves into `countdown` (as A1); `fearCost` uses A1's rule.
  - Potential adversaries parsed into entries/groups and linked to `src/lib/srd/adversaries.ts` by name, plural, the
    group's prefix ("Jagged Knife Bandits (Hexer)" -> Jagged Knife Hexer, "Outer Realms Monstrosities (Thrall)") or a
    sibling's prefix ("Jagged Knife Bandit, Lackey"); "Volcanic Dragon" links its first phase, Obsidian Predator
    (CB pp.237-238). The parsed line must rebuild the book's line exactly.
  - Name kept from the HF list: "Convergence, City of Portals" (the block heading reads "Convergence, the City of Portals").
- `src/lib/srd/types.ts`: `EnvironmentType`, `ENVIRONMENT_TYPES`, `EnvironmentFeatureKind`, `EnvironmentFeature {name, kind,
  text, fearCost?, countdown?, questions?}`, `EnvironmentAdversaryRef {name, adversaryId?, members?}`, `EnvironmentDef {id, name,
  tier, type, description, impulses, difficulty (number, or the printed "Special (see “Relative Strength”)"),
  potentialAdversaries, features, source, frameId?, page}`.
- `src/lib/domain/environments/index.ts` (pure, data-free): `environmentsFor` (the adversaries' visibility rule),
  `filterEnvironments` (name, type, description, impulses, potential adversaries, feature names/text/questions; the
  catalogue's `normalizeSearch`, so apostrophes fold), `groupEnvironmentsByTier` (the catalogue's `groupByTier`, "N
  environments"), `environmentCountLine`, `environmentTierLine`, `potentialAdversariesText`. Paging, `openCount`, `moreLabel`,
  `toggleChip`, `textBlocks` and `sortAdversaries` (A–Z / book order) are reused from `src/lib/adversaries/catalogue.ts`.
- `src/components/adversaries/environments/`: `EnvironmentCatalogue` (count line, search, Order / Tier / Type chips,
  "What do the types mean?" legend quoting CB p.241, Book chips only with Hope & Fear on, collapsible tiers with fresh
  paging, rows with impulses, type tag and Difficulty, Order remembered per device under `dcm:environment-sort`);
  `EnvironmentStatBlock` (parchment: name, H&F pill, tier line, description, Impulses, Difficulty / Potential Adversaries
  box, features with kind / Fear / countdown badges, bullet and numbered lists, italic questions, source line "Core
  Rulebook · p. N" / "Hope & Fear · p. N"); `OpenedAdversary` (Catalogue tab panel); `environments.css` (env- rules on
  catalogue.css, which it imports).
- `page.tsx`: third tab "Environment" (same WAI-ARIA tablist: arrows wrap, Home/End), behind its own SlotBoundary. A linked
  potential adversary switches to the Catalogue tab and shows its stat block (with "Add to encounter" / "Duplicate & edit")
  above the catalogue, with "Back to <environment>" (re-selects it; the selection lives in the page) and "Close". Links appear
  only for adversaries the campaign sees (Hope & Fear ones with the switch on). Header blurb mentions environments.

## Cross-checks
Generator output:
```
total 47 (core 19, hope & fear 28); unique ids 47
core list 19 { '1': 8, '2': 4, '3': 3, '4': 4 } blocks { '1': 8, '2': 4, '3': 3, '4': 4 } missing: none
hope & fear list 28 { '1': 8, '2': 8, '3': 8, '4': 4 } blocks { '1': 8, '2': 8, '3': 8, '4': 4 } missing: none
features 197; with questions 197; countdowns 17; Fear costs 47
potential adversary names 271; linked 199
texts with ligature splits or private-use characters: 0
```
PDF checks (pdfjs-dist, scratchpad only): the italic text runs of CB pp.243-251 and HF pp.99-112 were extracted with their
fonts. All 197 stored questions are among the italic runs, no italic question run is left unmatched, and no feature text ends
in italic text; every italic "Name - Kind:" heading is a stored feature (197). Rendered CB p.248 and p.250 for the two
countdown digits. No frame-exclusive environments exist in either book (none outside those pages), so `frameId` is unused.

## Acceptance evidence
- `tests/unit/srd-environments.test.ts` (11 tests): 47 = 19 + 28, none frame-exclusive; names/tiers/types equal both lists;
  ids; fields; Difficulty and the 3 "Special" events; Fear cost = `featureFearCost`, countdowns (incl. the two fixed digits);
  Raging River and Abandoned Mine verbatim; adversary links exist and group/prefix links; no ligature splits.
- `tests/unit/environment-catalogue.test.ts` (6 tests): visibility, search fields and folding, filters, tier groups and
  collapsed paging, orders, labels.
- `tests/e2e/environments.spec.ts` (5): tab + search; chips, clear, collapse, Book order, empty state; stat block (difficulty,
  badges, italic questions, countdown, source), adversary link to the Catalogue tab and back; Hope & Fear switch on/off via
  `campaigns.setOption` (47 count, Book row, H&F links); 390 px (stat block below, scrolled into view, 44 px targets, no
  horizontal scroll). `tests/e2e/adversaries.spec.ts` updated for three tabs.
- `pnpm lint`, `pnpm typecheck` clean; `pnpm test --maxWorkers=4 --testTimeout=60000`: 126 files, 1360 tests passed.
- `E2E_VISUAL=1 pnpm test:e2e` environments, adversaries, adversary-catalogue, custom-adversaries, encounter-builder,
  visual EV1 and A2: 19 passed.

## Visual
`test-results/visual/EV1/{page,filters,list,statblock,filtered,empty,opened}-{1440,390}.png` (Castle High). Same layout as
the adversary catalogue: list and 560 px parchment side by side at 1440 (stat block top at the search bar), one column at 390.

## Deliberate choices
- Potential adversary names are inline links in the book's sentence (WCAG 2.5.8 inline-target exception); their padding grows
  the hit area without overlapping the next line (a larger one made one link cover another).
- The opened adversary is a panel above the catalogue, not a selection inside it: selecting inside the catalogue needs a prop
  on `Catalogue` (`src/components/adversaries/catalogue/index.tsx`, `slots.ts`), outside EV1's owns.

## QUESTIONS
- Should a linked adversary instead be selected (and scrolled to) inside the catalogue list? Needs a `selectedId`/`focusId`
  prop on `Catalogue` and `CatalogueProps` (not owned by EV1); the panel is the reversible minimum.
- "Convergence, City of Portals" (list) vs "Convergence, the City of Portals" (heading): the list's name is kept.
