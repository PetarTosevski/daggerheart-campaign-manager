# TASK-D8-A2: Catalogue browser and stat block

Status: Review. Plan: `.omc/plans/d8.yaml`, tracer A2 (wave 2, depends on A0, A1). Board: `reference/designs/project/Adversaries.dc.html`
lines 19-129 (styles, list, stat block) and 407-441 (logic). User answers: all D8 defaults (`.omc/autopilot/d8-analysis.md`).

## Goal
The GM browses, searches and filters the catalogue in the board's look and reads any stat block on parchment; Hope & Fear and Weredragon
entries follow the campaign.

## What was built
- `src/lib/adversaries/catalogue.ts` (pure, relative imports, no SRD data import):
  - `normalizeSearch`: lower case, accents dropped (NFD), curly quotes and dashes folded to ASCII, whitespace collapsed. Core text has
    straight apostrophes and H&F text curly ones (A1 note), so either kind in the query finds both.
  - `filterAdversaries(list, {query, tier, type, book})` over name, type, motives, description, feature names and text (haystack cached
    per entry in a WeakMap). The type filter compares `type` ("Horde (N/HP)" is `type: "Horde"` + `hordePerHp` in A1's data, so it
    counts as Horde). Book = `source` (Hope & Fear includes the three Weredragon entries).
  - `toggleChip` (the active chip clears its filter), `groupByTier` ("Tier N" + "Level 1 / Levels 2–4 / Levels 5–7 / Levels 8–10 · N
    adversaries", N = all of the tier's matches), `PAGE_FIRST` 40 / `PAGE_MORE` 60, `moreLabel` ("Show 60 more · N left"), `countLine`,
    and the stat block labels `typeLabel`, `thresholdsLabel` ("8/15", "5/None", "None"), `attackLabel` (number or "+2d4"),
    `experienceLabel`, `textBlocks` (feature text split into paragraphs and `- ` list items, the d6 move tables).
- `src/components/adversaries/catalogue/index.tsx` (`Catalogue`): visible set = `adversariesFor(ADVERSARIES, {hopeAndFear, frameId})`
  (leaf module import, CL9); count line; search; Tier / Type / Book chip rows (`role=group`, `aria-pressed`; Book only with H&F on, and a
  stale Book filter is ignored once the switch is off); tier-grouped list of buttons with name, H&F pill, motives, type tag and
  Diff / HP / Stress (hidden under 980 px); selected row `aria-current` + accent bar; the first match is selected by default; any filter
  change resets paging to 40; empty state text from the board. Under 980 px, picking a row scrolls the stat block into view
  (smooth unless reduced motion).
- `src/components/adversaries/catalogue/stat-block.tsx` (`StatBlock`, `StatBlockAdversary`, `HopeFearPill`, exported for A3-A5): name,
  H&F pill, "Tier N Type", italic description, Motives & Tactics, Difficulty / Thresholds / HP / Stress (`<dl>`; Stress "None" when null),
  dark attack bar, Experience line, features with kind badges (Passive, Action, Reaction, Evolution), a "Fear N" badge when `fearCost`
  is set, a countdown badge when `countdown` is set (string from SRD, number from a custom row: "Countdown (N)"), list items as `<ul>`,
  and the H&F source line "Hope & Fear · p. N" ("Hope & Fear · Reign of the Weredragon · p. N" for frame entries). Props `actions`
  (in the head; the page's `renderActions(selected)` goes there) and `tracker` (above Features, where the board drew its pips). The
  prop type is structural so a custom adversary row (A5) or an instance snapshot (A4) fits.
- `catalogue.css`: the board rules on A0's `--adv-*` tokens, `adc-` prefix.

## Board bugs not ported
- `.ad-list` had `overflow:hidden` after `overflow-y:auto`, clipping the list at 640 px so "Show more" was unreachable: the list now
  scrolls inside its 640 px panel (`overscroll-behavior: contain`) and "Show more" sits at its end (e2e test clicks it: 40 → 100 rows).
- At 390 the board's rows overlapped (flex items shrinking in the height-limited flex column): the list is a block container, rows keep
  their height.
- The per-name pip tracker is not ported (encounters own HP/Stress; A4 passes `tracker`).

## Deliberate deviations
- Chips are 44 px high (board 34 px) for the touch-target rule; the search box is the board's 46 px.
- Count line sits above the search box in the catalogue slot, not in the page header: the header belongs to A0/A5 (`page.tsx`), whose
  placeholder line stays. A5 may move it into the header (QUESTIONS).
- Count line counts the campaign's visible set: "129 adversaries" (Witherwild), "264 adversaries · 129 core, 135 Hope & Fear" (Castle
  High), "267 … 138 Hope & Fear" only in a Reign of the Weredragon campaign with H&F on; "N of M shown" while filtered.
- Source line: "Features summarized; see the book for full wording." is dropped (A1 holds the verbatim text, Q1). Core entries show no
  source line, as on the board.
- The stat block panel is sticky at desktop (top 16 px, max-height 880 with its own scroll) so it stays beside a scrolled list.
- The stat block is an `<article aria-label="<name> stat block">` inside the board's `aside aria-label="Stat block"`; its name is an h2,
  tier headings in the list are h3.

## Acceptance evidence
- `tests/unit/adversary-catalogue.test.ts`: 14 tests (search fields, case/accent/apostrophe folding, blank query, tier/type/book
  filters, Tier 2 + Horde, chip toggle, groups and their counts, paging labels, count lines, stat block labels, text blocks).
- `tests/e2e/adversary-catalogue.spec.ts`: 6 tests — search "burrower" → Acid Burrower selected, stat block Difficulty 14, Thresholds
  8/15, HP 8, Stress 3; Tier 2 + Horde (only Tier 2 heading, all tags "Horde (N/HP)"), second click clears the chip, empty state;
  "Show 60 more · 89 left" reachable and adds 60 rows, keyboard selection (focus + Enter); Witherwild: no Book row, no H&F entries;
  Castle High: 264 count, Book filter "135 of 264 shown", Ahuizotl with pill and "Hope & Fear · p. 62", no Weredrake; 390 px: stat block
  below the list, scrolled into view on pick, scrollWidth ≤ 390.
- `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test --maxWorkers=4 --testTimeout=60000`: 115 files, 1193 tests passed.
- `E2E_VISUAL=1 pnpm test:e2e tests/e2e/adversary-catalogue.spec.ts tests/e2e/visual/A2.spec.ts`: 7 passed.

## Visual (app vs board)
App shots `test-results/visual/A2/<region>-<width>.png` (Castle High, H&F on); board shots
`test-results/visual/board/adversaries-<region>-<width>.png` (`node scripts/board-shots.mjs adversaries:<region>`).

| Region | App | Board | Verdict |
|---|---|---|---|
| Page | page-1440, page-390 | adversaries-page-1440, -390 | Match: two columns (list, 560 px parchment) at 1440, one column at 390 with the stat block after the list; A0's header and tabs above (A0 deviations). |
| Filters | filters-1440, -390 | adversaries-filters-* | Match: search with icon and placeholder, Tier / Type / Book rows, accent-filled "All"; chips 44 px (deviation). |
| List | list-1440, -390 | adversaries-list-* | Match: tier head "Tier 1 · Level 1 · 86 adversaries", rows with pill, motives, type tag, numbers (hidden at 390), accent bar on the selected row; at 390 rows no longer overlap (bug fixed). |
| Stat block | statblock-1440, -390 | adversaries-statblock-* | Match: parchment head with red rule, stat grid, dark attack bar, Experience, feature badges; no pip tracker (not ported). |
| Empty | empty-1440, -390 | adversaries-empty-* | Match: board text centred in the list panel. |
| Filtered (Tier 2 + Horde) | filtered-1440, -390 | (analysis shot adv-filtered-*) | Match: one Tier 2 group of Hordes, first one selected. |

## QUESTIONS
- The count line lives in the catalogue slot; should A5 (owner of `page.tsx` in wave 3) move it into the header in place of A0's
  placeholder? Reversible either way.
