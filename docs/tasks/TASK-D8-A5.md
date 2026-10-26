# TASK-D8-A5: Custom adversaries

Status: Review. Plan: `.omc/plans/d8.yaml`, tracer A5 (wave 3, depends on A2, A3). User answer to open question 6: yes (default:
"Duplicate & edit" any stat block, or start a blank one from CB p.208 "Improvised Statistics by Tier"; saved per campaign, GM-only,
usable in encounters).

## Goal
The GM duplicates any SRD stat block or starts a blank one (improvised statistics by tier prefilled), edits it in a parchment form, finds
it under "Custom adversaries" with a "Custom" pill and adds it to encounters.

## What was built
- **`src/lib/adversaries/custom.ts`** (pure, relative imports; bundled into Convex):
  - `IMPROVISED` (CB p.208 table), `blank(tier, type)` ("New adversary", improvised attack modifier, Difficulty, thresholds, damage =
    the low end of the tier's dice range; HP and Stress = median of the core SRD blocks of that tier and type, since the table has none;
    Minion: 1 HP, thresholds None, flat "1 phy"; Horde: 2 per HP), `withImprovisedStats(draft, tier)` (the book's "replace its existing
    statistics" re-tier: modifier, Difficulty, thresholds; Minions keep None).
  - `fromSrd(def)`: a copy with `basedOn`. Nothing is lost where the custom row is narrower: Stress None → 0; a dice attack bonus
    ("+2d4", Outer Realms Abomination) → modifier 0 and the bonus kept in the attack name; a countdown other than "Countdown (N)"
    (Loop, Decreasing, dice, Long-Term) is kept at the start of the feature text, "Countdown (N)" becomes the numeric `countdown`.
  - `validateCustom(draft)`: trimmed copy or `RuleError("ENCOUNTER_RULE")` naming the field: name 1..80, tier 1..4, hp 1..30,
    stress 0..20, Difficulty 1..40, thresholds null or 1..200 with Severe > Major, attack modifier −10..20, name 1..80, range one of
    Melee/Very Close/Close/Far/Very Far, damage ≤ 40, ≤ 6 Experiences (name 1..60, bonus −10..20), ≤ 20 features (name 1..80, text
    ≤ 2000, Fear cost 1..12, countdown 1..100), description and motives ≤ 2000; drops `hordePerHp` off a non-Horde.
  - `changedFields(prev, next)`: the fields an edit sends (CL3).
- **`convex/customAdversaries.ts`** (GM wrappers only; `args` and `returns` validators on all four):
  - `list` (gmQuery): the campaign's customs by name (`by_campaign_name`, `.take(100)`).
  - `create` (keyedGmMutation): `{adversary, basedOn?}`; validated with `validateCustom`; `basedOn` must be an SRD id
    (else ADVERSARY_UNKNOWN); CUSTOM_ADVERSARY_LIMIT at 100.
  - `update` (gmMutation): `{customId, patch}` with only the changed fields (each optional; `hordePerHp: null` clears it; features and
    experiences as whole lists); the merged block is validated, then the row is replaced (so a dropped `hordePerHp` goes away).
  - `remove` (gmMutation): ENCOUNTER_RULE while the running encounter has an instance of it (reads the one running encounter's ≤ 60
    instances); draft/ended instances keep their snapshot and A3's builder shows "deleted custom adversary".
  - Another campaign's or a malformed id: NOT_FOUND (normalizeId + campaign check).
- **UI** (`src/components/adversaries/custom/`, CSS in `custom.css`, `adx-` prefix, on A0's tokens; the list rows and stat block reuse
  A2's `adc-` rules and `StatBlock`):
  - `CustomAdversaries` (Catalogue tab, under the catalogue): heading "Custom adversaries" with the "Custom" book pill, count line, "New
    adversary"; empty state; list of customs (name + "Custom" pill, motives, type tag, Diff/HP/Stress) and the selected block on
    parchment with "Custom" pill, "+ Add to encounter", "Edit", "Duplicate & edit", two-click "Delete" (refusal shown in an alert).
  - `DuplicateAdversary`: the "Duplicate & edit" button for the catalogue stat block (page `renderActions`); the saved copy is selected
    in the custom section and scrolled into view.
  - `CustomEditor`: native `<dialog>` via `Modal` (1180 px wide): a parchment form with the stat block's sections as inputs (Name and
    type, Statistics, Attack, Experiences, Features with kind, Fear cost, countdown, move up/down, remove) and a live `StatBlock`
    preview beside it (below it under 980 px). The improvised values of the chosen tier are printed under Statistics with a "Use Tier N
    improvised statistics" button; on a new blank block still on its prefilled numbers, changing Tier or Type re-prefills them.
    Client-side `validateCustom` shows the first error before any request (`noValidate` so the server's message wording is used); an edit
    sends `changedFields` only.
  - `AddCustomToEncounter`: an "Add to encounter" dialog sending a `custom` source to `encounters.addAdversary` (encounter picker or a
    new one, how many or the Minion group size, Summoned).
- **`page.tsx`**: the catalogue's `renderActions` renders A3's `AddToEncounter` and `DuplicateAdversary`; the tab holds the selected
  custom id; the header count line is A2's `countLine` ("129 adversaries", "264 adversaries · 129 core, 135 Hope & Fear") in place of
  A0's placeholder.

## Book page re-checked
CB p.208 (printed; PDF page 209), "Improvised Statistics by Tier": "Attack Modifier +1 +2 +3 +4 / Damage Dice 1d6+2 to 1d12+4, 2d6+3 to
2d12+4, 3d8+3 to 3d12+5, 4d8+10 to 4d12+15 / Difficulty 11 14 17 20 / Damage Thresholds Major 7/Severe 12, Major 10/Severe 20, Major
20/Severe 32, Major 25/Severe 45". "You can quickly adjust a stat block to a different tier by replacing its existing statistics with
those listed on the Improvised Statistics by Tier table … you can even improvise a completely new adversary using these statistics."
"Minion: Give them a flat damage value for their standard attack, usually between 1 and 5".

## Deliberate deviations
- **Customs are not inside A2's catalogue list.** `CatalogueProps` (A0's `slots.ts`) has no custom entries and the catalogue is A2's
  file, so customs live in their own section under the catalogue on the same tab, with the "Custom" pill on each row and the stat
  block, and a "Custom" book pill on the section heading instead of a Book filter chip. Folding them into the catalogue list (Book
  chip "Custom") needs `slots.ts` + `catalogue/index.tsx` (see "Needed outside owns").
- **Own add dialog for customs.** A3's `AddAdversaryDialog` takes SRD ids only; `AddCustomToEncounter` repeats its fields for a custom
  source rather than editing `builder/`.
- **Feature text ≤ 2000, not 1500.** A0's `MAX_FEATURE_TEXT` is 1500 but Gobstalker's Tentacle Rays is 1534 characters, so a duplicate
  of it could never be saved; every SRD block now duplicates and saves (unit test over all of them, Convex test for Gobstalker).
- **Header count line** shows the whole catalogue; A2's line inside the catalogue slot still shows the same text until filtered ("N of M
  shown"), so both read the same when nothing is filtered.
- **Tracker pips:** A4 (tracker) runs in parallel and the tracker is a stub here, so the e2e checks the 9 HP snapshot in the builder row
  ("HP 9") and through `encounters.get` (`stats.hpMax` 9) — the value the tracker draws its pips from.

## Verification
- `pnpm lint`: 0 problems. `pnpm typecheck`: clean.
- `pnpm test --maxWorkers=4 --testTimeout=60000`: 120 files, 1293 tests passed, including
  - `tests/unit/custom-adversaries.test.ts`: 26 tests (CB p.208 table, blank per tier/type incl. Minion/Horde, re-tier, fromSrd
    copy, dice bonus / Stress None / special countdowns kept, every SRD block valid, 16 refusals, trims, changedFields).
  - `tests/convex/custom-adversaries.test.ts`: 9 tests — anonymous UNAUTHENTICATED / outsider NOT_FOUND / player FORBIDDEN / GM ok for
    all 4 functions; another campaign's and malformed ids NOT_FOUND; duplicate with origin + blank, by-name list; create idempotent per
    key, unknown origin ADVERSARY_UNKNOWN; 14 invalid blocks ENCOUNTER_RULE, Gobstalker ok; CUSTOM_ADVERSARY_LIMIT at 100; update of
    sent fields only, hordePerHp cleared (type change and null), merged block checked; add to an encounter (9 HP snapshot) and another
    campaign's custom → ADVERSARY_UNKNOWN via `encounters.addAdversary`; remove refused while running, allowed after end, snapshot kept.
- Local backend: `E2E_CONVEX_PORT=3374 node scripts/convex-e2e.mjs dev --once --typecheck=enable` (functions ready).
- `E2E_VISUAL=1 pnpm test:e2e tests/e2e/custom-adversaries.spec.ts tests/e2e/visual/A5.spec.ts tests/e2e/adversary-catalogue.spec.ts
  tests/e2e/encounter-builder.spec.ts tests/e2e/adversaries.spec.ts`: 12 passed, 1 failed — A0's `adversaries.spec.ts` asserts the
  custom stub text "Custom adversaries arrive with the next update." (see "Needed outside owns").
  - `custom-adversaries.spec.ts` (2 tests): duplicates Bear → "Cave Bear", HP 9 (live preview shows 9) → selected under Custom
    adversaries with the pill → Edit sends one field → Add to encounter (new "The bear cave") → Encounters tab row "Cave Bear", "HP 9",
    `encounters.get` hpMax 9 → Delete while running shows the refusal and the API gives ENCOUNTER_RULE; blank Tier 2 (Difficulty 14,
    thresholds 10/20, attack +2), a Fear 1 feature in the preview, HP 0 refused before saving, saved block "Tier 2 Standard", no
    horizontal scroll at 390.

### Visual (no board counterpart; judged on the board's tokens)
App shots: `test-results/visual/A5/` (`E2E_VISUAL=1 pnpm test:e2e tests/e2e/visual/A5.spec.ts`).

| Region | App | Verdict |
|---|---|---|
| Custom section | section-1440.png, section-390.png | Match to tokens: Cinzel heading, "Custom" pill in the H&F pill shape (accent), list rows and selected-row bar as the catalogue, parchment stat block beside it (below it at 390). |
| Custom stat block | statblock-1440.png, statblock-390.png | Match: A2's parchment block; head actions as parchment buttons, Delete in the rule red. |
| Editor dialog | editor-1440.png, editor-390.png | Match to tokens: parchment form with red top rule, Cinzel section legends in the rule red, inputs on light parchment; live preview on the right (below at 390); no horizontal scroll at 390. |

## Needed outside owns (for the orchestrator)
- `tests/e2e/adversaries.spec.ts` (A0), line 55: replace the stub assertion with
  `await expect(panel.getByRole("region", { name: "Custom adversaries" }).getByRole("button", { name: "New adversary" })).toBeVisible();`
- `docs/data-model.md`: no schema change (A0's `customAdversaries` table); new functions `customAdversaries.list/create/update/remove`.
- Optional: `src/components/adversaries/catalogue/index.tsx` (A2) could show its count line only while filtered now that the header
  carries the total.

## QUESTIONS
- Should customs join A2's catalogue list (a "Custom" Book chip) instead of their own section? Needs `slots.ts` (custom entries prop)
  and `catalogue/index.tsx`; reversible.
- Feature text cap 2000 instead of A0's 1500 (Gobstalker); or keep 1500 and let a duplicate of Gobstalker fail until shortened?
- Blank HP/Stress use the median of the core blocks of that tier and type (the book's table has no HP or Stress); say if fixed values
  are wanted. Blank damage is the low end of the tier's range (Minion "1 phy").
