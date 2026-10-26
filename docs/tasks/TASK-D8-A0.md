# TASK-D8-A0: D8 foundation

Status: Review. Plan: `.omc/plans/d8.yaml`, tracer A0 (wave 1, no dependencies). Analysis: `.omc/autopilot/d8-analysis.md`
(user answers 2026-10-18: "lgtm, default all", so custom adversaries are in and the `customAdversaries` table is used by A5).

## Goal
The encounter tables exist and go with their campaign's purge; the Fear spend helper and the encounter error codes are wired; the GM opens
`/campaigns/<id>/adversaries` to a board-look page with Catalogue and Encounters tabs (stubs); players see no nav item and a GM-only panel.

## Scope
- `convex/tables/encounters.ts`, `convex/lib/validators/encounters.ts`, `convex/lib/encounters.ts` (loaders, caps), `convex/schema.ts`, `convex/cleanup.ts`.
- `spendFear` in `convex/lib/fear.ts` (history action `spend`, `FEAR_EMPTY`), CB p.154.
- `src/lib/errors/encounters.ts` wired into `AppErrorCode` and `src/lib/convex-errors.ts`.
- Route shell, `adversaries.css` tokens, `slots.ts`, four stub folders; `gmOnly` nav for players.
- Visual tooling: `openAdversaries` helper, `scripts/board-shots.mjs adversaries:<region>`.

No public Convex function is added (the first ones come with A3), so there is nothing new for the authz matrix.

## What was built
- **Tables** (typed validators, no blob, no `v.any()`):
  - `encounters` {campaignId, name, status draft|running|ended, pcs, adjustments (easy|twoSolo|dmg|lowTier|noBig|hard), gmTurn, notes?,
    createdAt, updatedAt, startedAt?, endedAt?}, index `by_campaign_status_updated` [campaignId, status, updatedAt].
  - `encounterAdversaries` {campaignId, encounterId, source (srd {adversaryId} | custom {customId}), label, order, summoned, minionCount?,
    stats {difficulty, major|null, severe|null, hpMax, stressMax}, hp, stress, defeated, conditions (hidden|restrained|vulnerable|distracted),
    tags, spotlights, spotlightTurn, note?, updatedAt}, indexes `by_encounter_order` [encounterId, order] and `by_campaign` [campaignId].
  - `customAdversaries` {campaignId, name, tier, type (10 types), hordePerHp?, description, motives, difficulty, thresholds {major|null,
    severe|null}, hp, stress, attack {modifier, name, range, damage}, experiences [{name, value}], features [{name, kind
    passive|action|reaction|evolution, text, fearCost?, countdown?}], basedOn?, createdAt, updatedAt}, index `by_campaign_name`.
- **Caps and loaders** (`convex/lib/encounters.ts`): MAX_INSTANCES 60, MAX_ENCOUNTERS 200, MAX_CUSTOM 100 and the string/count caps
  (name 80, notes 2000, pcs 1..12, label 60, tag 30 × 6, instance note 500, minions 30, custom name 80, custom text 2000, experiences 6,
  features 20, feature text 1500); `assertTextLength` / `assertWholeInRange` (ENCOUNTER_RULE); `loadEncounter` / `loadInstance`
  (normalizeId, NOT_FOUND for a malformed id, a missing row or another campaign's row); `assertRunning` (ENCOUNTER_NOT_RUNNING);
  `countInstances` (`by_encounter_order` `.take(MAX_INSTANCES + 1)`).
- **Purge**: `convex/cleanup.ts` deletes `encounterAdversaries` (by_campaign), then `encounters`, then `customAdversaries` by their campaign
  indexes; schema-guard lists the three as CAMPAIGN_SCOPED; the cleanup test seeds a row in each (an SRD and a custom instance).
- **Fear**: `spendFear(ctx, campaignId, amount, reason)`: amount a whole number 1–12 (else FEAR_RANGE), FEAR_EMPTY when GM Fear < amount,
  patches `campaignState.fear` and writes one `history` row {kind fear, action "spend", before, after, by caller}. `reason` is one of
  `FEAR_SPEND_REASONS` (interrupt, move, feature, experience) and is returned, because `history` has no reason field (see QUESTIONS).
- **Errors**: `src/lib/errors/encounters.ts` (as const) ENCOUNTER_RULE, ENCOUNTER_FULL, ENCOUNTER_LIMIT, ENCOUNTER_RUNNING,
  ENCOUNTER_NOT_RUNNING, ADVERSARY_UNKNOWN, CUSTOM_ADVERSARY_LIMIT, FEAR_EMPTY; joined into `AppErrorCode` and `convex-errors`.
- **Route** `C/adversaries/page.tsx` ('use client', `<title>Adversaries</title>`): board header (H1, count line, blurb), tablist
  "Adversary views" (Catalogue, Encounters; arrow keys, Home, End), each slot in its own error boundary with "Try again". Catalogue tab:
  `Catalogue` + `CustomAdversaries`; Encounters tab: `EncounterBuilder` (activePcs from `characters.listByCampaign`, status active) +
  `EncounterTracker` (encounterId set by the builder's `onOpenEncounter`, fear from the campaign summary). `error.tsx` with retry.
  `adversaries.css`: the board tokens of analysis section 1 as `--adv-*` custom properties on `.adv-root` (accent = app `--brand`),
  fonts from the root layout (Cinzel, EB Garamond, IBM Plex Sans), plus the shell classes.
- **slots.ts**: CatalogueProps {campaignId, hopeAndFear, frameId, renderActions(adversary: {id, name})}, BuilderProps {campaignId,
  activePcs, onOpenEncounter}, TrackerProps {campaignId, encounterId: string | null, fear}, CustomProps {campaignId}; campaignId is
  `Id<"campaigns">`. Stubs are typed consts rendering one placeholder line.
- **Players**: `campaign-sections.ts` marks Adversaries `gmOnly` (`visibleToPlayers`); `campaign-shell.tsx` hides it for players; the
  page shows "Only the GM can see adversaries and encounters." and mounts no slot, so no adversary or party query is made.
- **Visual tooling**: `openAdversaries(page, frame)` in `tests/e2e/visual/helpers.ts`; `scripts/board-shots.mjs adversaries:<region>`
  (page, header, filters, list, statblock, empty, or `adversaries:all`) shoots the board from disk at 1440 and 390 into
  `test-results/visual/board/adversaries-<region>-<width>.png` (prefixed so they never overwrite the Party board's `header`).

## Book pages re-checked
CB p.154 (SRD text, digits lost in extraction): "You can never have more than [12] Fear at one time … Spend a Fear to: • Interrupt the
players to steal the spotlight and make a move • Make an additional GM move • Use an adversary's Fear Feature • Use an environment's Fear
Feature • Add an adversary's Experience to a roll". `FEAR_SPEND_REASONS` "feature" covers both Fear Feature lines.

## Deliberate deviations
- Board back button: the app's campaign nav replaces it (analysis section 1).
- The board has no tabs; they use the board's chip look (pill, accent fill when selected) at 44 px height.
- Count line: a placeholder ("Core Rulebook" / "Core Rulebook and Hope & Fear" by the campaign's switch) until A2 can show counts.
- Blurb: the board's "Hope & Fear entries are summarized" no longer holds (Q1: verbatim), so the blurb names the sources and says the page is GM-only.

## Verification
- `pnpm typecheck`: clean. `pnpm lint`: 0 problems.
- `pnpm test --maxWorkers=4 --testTimeout=60000`: 112 files, 1138 tests passed (includes tests/convex/fear-spend.test.ts 3 tests,
  cleanup.test.ts, schema-guard.test.ts, tests/unit/convex-errors.test.ts with the new D8 codes test).
- Local backend push: `E2E_CONVEX_PORT=3490 node scripts/convex-e2e.mjs dev --once --typecheck=enable` added the 4 new indexes.
- `E2E_VISUAL=1 pnpm test:e2e tests/e2e/adversaries.spec.ts tests/e2e/visual/A0.spec.ts`: 3 passed.
- `pnpm test:e2e tests/e2e/codex.spec.ts tests/e2e/dashboard.spec.ts tests/e2e/players.spec.ts`: 9 passed (unchanged specs).

### Visual (app vs board)
| Region | App (test-results/visual/A0/) | Board (test-results/visual/board/) | Verdict |
|---|---|---|---|
| Header | header-1440.png, header-390.png | adversaries-header-1440.png, adversaries-header-390.png | Match: Cinzel 900 30 px H1, 13 px muted count line, right-aligned blurb (left under 980 px), bottom rule; no back button (deviation above). |
| Tabs | tabs-1440.png, tabs-390.png | (none; chip tokens) | Match to tokens: `.ad-chip` look with accent fill, 44 px targets. |
| Page | page-catalogue-*.png, page-encounters-*.png | adversaries-page-1440.png, adversaries-page-390.png | Shell only: same page background, 1344 px max width, 48/16 px gutters; slots are stubs until A2-A5. No horizontal scroll at 390. |
