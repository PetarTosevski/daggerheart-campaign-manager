# TASK-D8-A4: Live encounter tracker

Status: Review. Plan: `.omc/plans/d8.yaml`, tracer A4 (wave 3, depends on A2, A3). Analysis: `.omc/autopilot/d8-analysis.md`
(user answers 2026-10-18: "lgtm, default all": Q2 Stress overflow marks 1 HP and full Stress = Vulnerable; Q3 no Massive Damage; Q4 Minion
defeats suggested, the GM confirms; Q5 spotlight counter warns, never blocks, End GM turn resets, Fear only via "Spend Fear").

## Goal
During a running encounter the GM marks damage by thresholds, HP and Stress per adversary, Minion and Horde rules, conditions, spotlights
per GM turn and Fear spending (which lowers the dashboard's GM Fear), and rolls adversary attacks into the hidden GM roll feed.

## What was built
- **`src/lib/domain/encounters/damage.ts`** (pure, shared by server and optimistic updates): `damageTaken` (resistance halves, rounded
  down), `damageSeverity` / `hpForDamage` (0 at ≤ 0, 1 below Major, 2 at Major, 3 at Severe; a None threshold is never reached; None/None
  = "defeat", every remaining HP; no Massive Damage), `markHp`, `markStress` (past a full track marks 1 HP instead, however much
  overflowed), `isDefeated`, `vulnerableFromStress`, `hordeHalved` (marked ≥ ceil(hpMax / 2)), `minionDefeats(amount, X, remaining?)`
  = 1 + floor(amount / X), capped by Minions left; `applyMark`, `applyCondition` (the instance updaters).
- **`src/lib/domain/encounters/spotlight.ts`** (pure): `spotlightLimit` (1, X for Relentless (X), "X" for a variable X, which never
  warns), `spotlightsThisTurn` (a count stored for an older GM turn reads 0), `spotlightStatus` ("Spotlight n/limit", `over` warning),
  `applySpotlight`.
- **`convex/encounterTracking.ts`**: keyed GM mutations, each with `args` + `returns`, ENCOUNTER_NOT_RUNNING unless the encounter runs,
  NOT_FOUND for another campaign's ids: `markHp`, `markStress` (delta −30..30), `applyDamage` (0..999, `resistant`; returns {taken,
  severity, marked, suggestedDefeats, hp, defeated}; a Minion group marks nothing and returns the suggestion), `defeatMinions` (group
  only, else ENCOUNTER_RULE; marks group HP, so `minionCount` and the Battle Points stay the group's size), `toggleCondition`,
  `setTags` (trimmed, deduplicated, ≤ 6 × 30), `setNote` (≤ 500, blank clears), `spotlight` (counts for the encounter's `gmTurn`),
  `endGmTurn` (gmTurn + 1, no write to instances), `spendFear` (amount 1..12, reason, optional instanceId of this encounter) through A0's
  `spendFear` (FEAR_EMPTY, FEAR_RANGE, history action "spend"). Plus one gmQuery `customBlocks(encounterId)`: the custom stat blocks the
  encounter's instances use (for the tracker's parchment block; SRD blocks ship with the client).
- **Tracker UI** (`src/components/adversaries/tracker/`, CSS `tracker.css` on A0's tokens, prefix `trk-`):
  - `EncounterTracker` (the slot): the encounter the builder opened, or with `encounterId` null the campaign's running encounter;
    notices for none running, a draft, an ended or a deleted encounter.
  - `TopBar`: name, status chip, "GM turn N", "End GM turn", 12 Fear tokens live from the campaign (`fear` prop) + "Spend Fear" dialog
    (native `Modal`: amount stepper, reasons Additional GM move / Fear feature / Experience / Interrupt), Battle Points meter "Spent X of
    Y BP" from A3's `battlePoints`.
  - `InstanceCard`: name button (selects; aria-pressed), "×N" for Minion groups, type tag, Defeated badge + strike-through, Difficulty;
    HP and Stress rows of the board's 22 px pips (aria "Mark Hit Point k of n" / "Mark Stress k of n"; clicking a marked pip clears down
    to it) with − / + steppers; damage box (amount, Resistant toggle, Apply, result "Major: 2 HP marked (halved to 7)"); Minion groups:
    "N of M Minions left · Minion (X)", after a hit "Suggested: defeat N" and a confirm "Defeat N" with ± to change it; "Horde halved:
    its attack now deals X"; condition chips Hidden / Restrained / Vulnerable / Distracted (aria-pressed; × when on clears) plus
    "Vulnerable · Stress full" while Stress is full; tags with remove buttons and an input; spotlight counter (red with "Past the limit
    for this GM turn" when over) and "Spotlight".
  - `SelectedBlock`: A2's `StatBlock` with `actions` = "Roll attack" (d20 + ATK, or d20 + dice for "+2d4"), "Roll damage" (the Horde (X)
    damage once halved; flat damage is shown, not rolled), and on a natural 20 "Critical damage" (dice maximum added to the modifier,
    CB p.148), all through `rolls.gmRoll` labelled "<instance>: attack" (hidden until revealed); `tracker` = "Spend Fear" buttons for
    Fear-cost features ("Spend N Fear: <feature>") and Experiences ("<name> +N, 1 Fear").
  - `useTracker`: the mutations with optimistic updates on `encounters.get` (pips, Stress, conditions, spotlight, GM turn) and on
    `campaigns.get` (Fear), using the pure updaters above; one idempotency key per click.
  - `rules.ts`: stat block + Relentless / Minion / Horde values (A1's parsers for SRD, the same feature-name parsing for custom blocks),
    `attackRoll`, `damageRoll`, `isNatural20`.

## Book references (re-checked, printed pages, `core.txt` extraction)
- CB p.91: "Severe damage is equal to or above your Severe threshold; you mark 3 HP. • Major damage is equal to or above your Major
  threshold but below Severe; you mark 2 HP. • Minor damage is anything below your Major threshold; you mark 1 HP. If you ever reduce
  incoming damage to 0 or less … you don't mark any HP." Massive Damage is an "OPTIONAL RULE" (not used, Q3).
- CB p.92: "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead mark 1 Hit Point … If you
  would take 2 Stress from an enemy and you have 1 Stress left, you would mark 1 Stress and 1 Hit Point." (applied to adversaries, Q2)
- CB p.99: "When a creature has resistance to a damage type, they halve damage of that type before comparing it to their damage
  thresholds. For example, when your character deals 26 physical damage … the creature only takes 13 physical damage."
- CB p.148: "If you critically succeed on an attack roll, you also deal extra damage. Start with the highest possible value the damage
  dice can roll, and then make a damage roll as usual, adding it to that value."
- CB p.153: "you can't typically spotlight the same adversary more than once during your turn." CB p.195: "Relentless (X) - Passive:
  This adversary can be spotlighted up to X times per GM turn."
- CB p.154: Spend Fear to interrupt, make an additional GM move, use a Fear Feature, add an adversary's Experience to a roll.
- CB p.178: "an adversary or PC becomes Vulnerable while their Stress slots are full". CB p.199 Horde (X); CB p.201 Minion (X); CB p.208
  "When an adversary marks their last Hit Point, they are defeated" (quotes in the analysis, section 2, unchanged).

## Deliberate deviations and interpretations
- **Fear reasons** are A0's `FEAR_SPEND_REASONS` (interrupt, move, feature, experience), not the plan's "spotlight|feature|experience|
  interrupt|other": "move" is the additional GM move (the spotlight shift), and `history` has no reason field anyway.
- **Feature / Experience Fear buttons** sit in the stat block's `tracker` slot above Features (A2's StatBlock has no per-feature slot and
  is A2's file), not beside each feature.
- **Minion defeats** mark the group's HP (1 per Minion) instead of shrinking `minionCount`, so the Battle Points of the encounter do not
  change mid-fight; the card shows "N of M Minions left".
- **Pips** are 22 px inside a 30 × 44 px hit area (44 px high; 44 px wide would wrap a 7-HP track at 390); the ± steppers are 44 × 44.
- **Shared updaters** live in the pure domain files (damage.ts, spotlight.ts) instead of `src/lib/optimistic/*`, which A4 does not own.
- **No shared `<Loading>`** component exists in the repo; loading states are `<p role="status">` like A2/A3.
- **Tracker placement**: below the builder on the Encounters tab (A0's page layout).

## Verification
- `pnpm lint`: 0 problems. `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 120 files, 1286 tests passed, including
  - `tests/convex/encounter-tracking.test.ts` 11 tests: anonymous UNAUTHENTICATED / outsider NOT_FOUND / player FORBIDDEN / GM ok for all
    11 functions; another campaign's ids NOT_FOUND; a draft encounter ENCOUNTER_NOT_RUNNING for every mutation (Fear unchanged); damage 7
    / 8 / 15 on 8/15 marks 1 / 2 / 3, resistant 15 marks 1, 0 marks none, 1000 ENCOUNTER_RULE; defeat and clamping; Stress overflow
    marks HP (Q2); 6 Lackeys with Minion (3) hit for 7 suggests 3, defeatMinions(3) leaves 3, capped suggestion, non-group refused;
    conditions, tags and notes with caps; spotlights 1..4 past Relentless (3) never refused, endGmTurn resets without touching the
    instance; spendFear lowers Fear and writes one history "spend", FEAR_EMPTY / FEAR_RANGE, other encounter's instance NOT_FOUND;
    double markHp with one key applies once; customBlocks.
  - `tests/unit/encounter-damage.test.ts` 17 tests: every rule above, roll helpers (d20 + ATK / + dice, 2d8+2 crit → modifier 18, flat
    damage), Relentless / Minion values, and RTL with an in-memory optimistic store: double click "+" → two +1 intents and 2 HP shown,
    the next pip click sends +1; spotlight counter 2/1 with the warning; condition toggle; Vulnerable shown at full Stress.
- Local backend: `E2E_CONVEX_PORT=3312 node scripts/convex-e2e.mjs dev --once --typecheck=enable`: functions ready.
- `pnpm test:e2e tests/e2e/encounter-tracker.spec.ts`: 2 passed (Bear: damage 9 → "Major: 2 HP marked", Stress pip, Vulnerable, Spend
  Fear → tracker and dashboard 3 → 2, spotlight 1/1 → 2/1 with warning, End GM turn → "GM turn 2" and "Spotlight 0/1", Roll attack →
  "hidden" row in the GM feed, absent from the player's feed until the GM clicks Reveal; 390 px no horizontal scroll, every button ≥ 44 px
  high).
- `pnpm test:e2e tests/e2e/encounter-builder.spec.ts tests/e2e/adversary-catalogue.spec.ts`: 8 passed. `tests/e2e/adversaries.spec.ts`
  (A0's): 1 of 2 fails only because it asserts the tracker stub text (see "Needed outside owns").

### Visual
App shots: `test-results/visual/A4/<region>-<width>.png` (`E2E_VISUAL=1 pnpm test:e2e tests/e2e/visual/A4.spec.ts`, 1 passed). The board
has no tracker, so regions are judged against the Adversaries board's tokens.

| Region | App | Board counterpart | Verdict |
|---|---|---|---|
| Top bar | top-bar-1440, top-bar-390 | none (list panel tokens) | Match to tokens: list-panel background and border, Cinzel name, Running chip in A3's green, Fear tokens in the H&F purple, BP bar in accent/exact/over colours; wraps to 4 rows at 390. |
| Card fresh / damaged / defeated | card-fresh-*, card-damaged-*, card-defeated-* | board stat block pips (adv-statblock-1440) | Match: 22 px pips (HP square #b8322a, Stress round #4a2a7a, empty #f6ecd6), board chips (accent fill when pressed), selected card with the list's selected background and 3 px accent bar; defeated struck through and dimmed. |
| Minion group | minion-group-* | none | Match to tokens; "4 of 6 Minions left · Minion (3)". |
| Stat block | statblock-* | adversaries-statblock-* | Match (A2's component): Roll buttons in the head, Spend Fear row above Features. |
| Page | page-1440, page-390 | adversaries-page-* | Two columns (cards, 560 px parchment) like the catalogue; one column at 390 with the stat block after the cards; no horizontal scroll. |

## Needed outside owns
- `tests/e2e/adversaries.spec.ts` (A0) line 61 asserts the tracker stub "The live encounter tracker arrives with the next update.".
  With A4 the slot shows the tracker notice; replace it with
  `await expect(encountersPanel.getByRole("heading", { name: "Encounter tracker" })).toBeVisible();`.
- `docs/data-model.md`: no schema change; new functions `encounterTracking.*` above.

## QUESTIONS
- Resistance halving of an odd amount rounds **down** (CB p.99 only shows an even example). Reversible in `damageTaken`.
- Stress overflow with a block that has no Stress (Stress "None", stressMax 0): marking Stress marks 1 HP (the slots are "already full").
  Reversible in `markStress`.
- Should "Spend Fear: Additional GM move" also count a spotlight on the selected adversary? Kept separate (Q5: Fear never automatic).
