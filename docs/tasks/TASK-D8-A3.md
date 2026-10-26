# TASK-D8-A3: Encounters and the Battle Points builder

Status: Review. Plan: `.omc/plans/d8.yaml`, tracer A3 (wave 2, depends on A0, A1). Analysis: `.omc/autopilot/d8-analysis.md`
(user answers 2026-10-18: "lgtm, default all"; Q4 = Minions as one group row).

## Goal
The GM creates, renames, deletes and starts encounters, adds adversaries (count, Minion group size, Summoned) and sees the Battle
Points budget with adjustments in the Sessions board's builder look.

## What was built
- **`src/lib/domain/encounters/budget.ts`** (pure, CB p.197): `startingBudget(pcs)` = 3 × pcs + 2; `BP_ADJUSTMENTS` (easy −1,
  twoSolo −2, dmg −2, lowTier +1, noBig +1, hard +2, with the Sessions board's labels); `BP_COSTS` (Social/Support 1,
  Horde/Ranged/Skulk/Standard 2, Leader 3, Bruiser 4, Solo 5); `minionGroups` = ceil(all counted Minions / pcs); `spentFor` skips
  summoned instances and unknown types; `suggestedAdjustments(entries, partyTier)` (2+ Solos → twoSolo, an adversary below the party's
  tier → lowTier, no Bruiser/Horde/Leader/Solo → noBig; hints only, never applied); `verdict` ("N BP left" / "Right on budget" /
  "Over by N BP"); `battlePoints(...)` for the panel (budget, spent, left, state under/exact/over, bar percent, minion groups, hints).
- **`src/lib/domain/encounters/instances.ts`** (pure): `nextLabels(name, existing, count)` ("Bear", "Bear 2", … after the highest
  number already in the encounter; names cut to fit 60 characters); `instanceStats(block, minionCount?)` snapshot {difficulty, major,
  severe (null = None), hpMax = HP, or the group size for a Minion group (1 HP per Minion, CB p.201), stressMax (Stress None → 0)}.
- **`convex/encounters.ts`** (GM wrappers only; `args` and `returns` validators on every function):
  - `list` (gmQuery, `by_campaign_status_updated`): `{active: running + drafts (newest first), ended: newest endedLimit (default 20,
    1..200), moreEnded}`.
  - `get` (gmQuery): the encounter + its instances in order (`by_encounter_order`, at most 60), each with its stat block's `name`,
    `type` and `tier` (SRD from the bundled data; a custom block read once per distinct id; null when that custom block is gone).
    Returns null for a missing, malformed or other campaign's id, so a live view never throws when the encounter is deleted.
  - `create` (keyedGmMutation): name 1..80 (trimmed), `pcs` 1..12 or, when omitted, the campaign's active characters (4 when none);
    ENCOUNTER_LIMIT at 200 encounters.
  - `rename`, `setNotes` (≤ 2000, blank clears), `setBudget` (intent: `{kind: "pcs", delta}` clamped to 1..12, or `{kind:
    "adjustment", adjustment, on}`), `start` (draft or ended → running; ENCOUNTER_RUNNING while another runs; idempotent on the running
    one), `end` (ENCOUNTER_NOT_RUNNING unless running), `remove` (deletes its ≤ 60 instances in the same mutation) — gmMutation.
  - `addAdversary` (keyedGmMutation): source `srd {adversaryId}` (must be in `adversariesFor` for the campaign: Hope & Fear switch,
    frame-exclusive Weredragon blocks) or `custom {customId}` of this campaign, else ADVERSARY_UNKNOWN; `count` 1..10 rows, or for a
    Minion one group row of 1..30 (`minionCount`); `summoned`; ENCOUNTER_FULL past 60 instances.
  - `removeInstance`, `reorder` (swap with the neighbour up/down) — gmMutation.
  - Mutations that change the instance set or the budget bump the encounter's `updatedAt` (list order).
- **Builder UI** (`src/components/adversaries/builder/`, CSS in `builder.css` on the A0 tokens):
  - `EncounterBuilder` (the page's Encounters slot): "+ New encounter" (created with the active party size), encounter list with
    Draft / Running / Ended chips and "N player characters", ended ones 20 at a time ("Show more ended encounters").
  - `EncounterDetail`: name field (saved on blur / Enter), two-click Delete, status card (Draft / Encounter running / Ended with
    "▶ Start encounter", "■ End encounter", "Open in tracker" → `onOpenEncounter`), Adversaries card (rows: label, "×N" for a Minion
    group, "Tier N Type" tag, Summoned tag, Difficulty and HP, cost "4 BP" / "group" / "0 BP", move up / down, remove), Notes.
  - `BudgetPanel` (Sessions board builder): "Player characters" stepper (−/+, 1..12), progress bar (meter role; over `#e0715f`, exact
    `#7cc49a`, else accent), "Spent X of Y" + verdict, the Minion group line, six adjustment toggles (aria-pressed, 22 px boxes,
    deltas) with "Suggested by this encounter's adversaries" hints, and the note "Starting budget is 3 × player characters + 2, per the
    core rules' encounter guidance." Optimistic update on the stepper and toggles (`applyBudgetChange`, the server's rule).
  - `AddAdversaryDialog` (native dialog via `Modal`): adversary search over the campaign's catalogue (when not fixed), encounter
    picker with "New encounter…" (when not fixed), "How many" (1..10) or "Minions in the group" (1..30; default the encounter's party
    size, else 4), "Summoned (costs no Battle Points)".
  - `AddToEncounter({campaignId, adversary})`: the "+ Add to encounter" button for the catalogue stat block's `renderActions`; opens
    the dialog with the adversary fixed (see "Needed outside owns").
  - Optimistic removal of an instance row.

## Book references (re-checked, CB p.197, printed page)
"When planning a battle, start with the following formula to calculate how many Battle Points you should spend: (3 × the number of
PCs in combat) + 2 … if you have a party of three PCs, you have 11 Battle Points to spend. If you have a party of five, you have 17"

"Adjusting Battle Points … • Subtract 1 point if the fight should be less difficult or shorter. • Subtract 2 points if you're using 2
or more Solo adversaries. • Subtract 2 points if you add +1d4 (or a static +2) to all adversaries' damage rolls (to increase the
challenge without lengthening the battle). • Add 1 point if you choose an adversary from a lower tier. • Add 1 point if you don't
include any Bruisers, Hordes, Leaders, or Solos. • Add 2 points if the fight should be more dangerous or last longer."

"Spending Battle Points … • Spend 1 point for each group of Minions equal to the size of the party. • Spend 1 point for each Social or
Support adversary. • Spend 2 points for each Horde, Ranged, Skulk, or Standard adversary. • Spend 3 points for each Leader adversary.
• Spend 4 points for each Bruiser adversary. • Spend 5 points for each Solo adversary."

"Tip: Some adversaries summon additional enemies when they use their features—you don't need to factor those into your point total."

The book's worked example (party of four: 14, "a little easier" 13, two Bruisers 8 + two Standards 4 + four Minions 1; five Standards
10 + a Ranged 2 + eight Minions 2; +2 damage → 12, Leader 3 + Bruiser 4 + two Hordes 4 + Support 1) is a unit test.

## Deliberate deviations and interpretations
- **Minion groups across names:** all counted Minions are summed before dividing by the party size (the Sessions board has one "Minion
  group" counter); two groups of 2 Lackeys for 4 PCs cost 1 BP.
- **Lower-tier hint:** "an adversary from a lower tier" is read against the campaign's tier (the party's); it is a hint only.
- **Board counters → real adversaries:** the Sessions board counts roles with ±steppers; here the spent total comes from the
  encounter's adversaries, so the role counter rows are replaced by the instance list (with each row's cost).
- **Touch targets:** steppers and row buttons are 44 px (board 36/40 px), per the plan's 390 px rule.
- **Ended encounters restart:** `start` accepts an ended encounter (the Sessions board lets a played session start again).
- **Party size range** is 1..12 (A0's cap; the Sessions board stops at 8).
- **"Add to encounter" from the catalogue:** built (`AddToEncounter`), but the page passes `noActions` to the catalogue and the
  page belongs to A0/A5, and the catalogue (A2) is still a stub on this branch. The e2e therefore adds Bears and Lackeys with the
  builder's own "+ Add adversary" dialog (same dialog, adversary searched instead of fixed).

## Verification
- `pnpm typecheck`: clean. `pnpm lint`: 0 problems (zero warnings in `convex/`).
- `pnpm test --maxWorkers=4 --testTimeout=60000`: 116 files, 1228 tests passed.
  - `tests/unit/encounter-budget.test.ts` 33 tests (each line of CB p.197, the worked examples, hints, verdicts, the optimistic
    updater, labels, snapshots).
  - `tests/convex/encounters.test.ts` 16 tests: anonymous UNAUTHENTICATED / outsider NOT_FOUND / player FORBIDDEN / GM ok for all 12
    functions; another campaign's encounter and instance ids NOT_FOUND (get → null); default party size from active characters;
    numbered labels and snapshots; count validation; ADVERSARY_UNKNOWN (unknown id, H&F with the switch off, Weredrake outside its
    frame, another campaign's custom); custom names / deleted custom; idempotent addAdversary; ENCOUNTER_FULL at 60; ENCOUNTER_LIMIT at
    200; rename / notes / budget intents; one running encounter (ENCOUNTER_RUNNING / ENCOUNTER_NOT_RUNNING); ended paging; reorder,
    removeInstance, remove with its instances; read cost: `get` reads exactly one more document per instance and none of another
    encounter's.
- Local backend: `E2E_CONVEX_PORT=3498 node scripts/convex-e2e.mjs dev --once --typecheck=enable` (functions ready).
- `pnpm test:e2e tests/e2e/encounter-builder.spec.ts`: 2 passed (create, 2 Bears + Lackey group of 4 → "Spent 9 of 14", "Harder or
  longer fight" → 16, stepper 3 PCs → "Spent 10 of 13", start → Running; the player's `encounters.list` → FORBIDDEN; 390 px: no
  horizontal scroll, every button ≥ 44 px). With `E2E_VISUAL=1` plus `tests/e2e/visual/A3.spec.ts`: 3 passed.
- `tests/e2e/adversaries.spec.ts` (A0's): its first test fails at `toHaveTitle("Adversaries")` (the title stays "Daggerheart ·
  Campaign Ledger" after the client-side nav click). The same failure happens on `rebuild` at 42d5b86 without A3, so it is not caused
  by this tracer. Past that line it would also stop at the builder stub text (see "Needed outside owns").

### Visual (app vs board)
App: `test-results/visual/A3/` (`E2E_VISUAL=1 pnpm test:e2e tests/e2e/visual/A3.spec.ts`). Board: `test-results/visual/board/sessions-*`,
shot from `reference/designs/project/Sessions.dc.html` with the same Playwright (a scratch script; `scripts/board-shots.mjs` has no
Sessions regions and is A0's file): a new session, 2 Bruisers + 1 Minion group, "Harder or longer fight" on.

| Region | App | Board | Verdict |
|---|---|---|---|
| BP panel | bp-panel-1440.png, bp-panel-390.png | sessions-bp-panel-1440.png, sessions-bp-panel-390.png | Match: card, Cinzel heading + "Battle Points", PC stepper on the dark field, 10 px bar in accent, "Spent 9/11 of 16" + verdict in accent, ADJUSTMENTS label, six rows with 22 px boxes and Cinzel deltas, checked row raised, the core-rules note. Deviations: role counters replaced by the instance list; Minion group line; hint line; 44 px steppers. |
| Encounter list | list-1440.png, list-390.png | sessions-list-1440.png, sessions-list-390.png | Match: list label, cards 1.5 px border, accent border when current, Cinzel 17 px name, status chip (Draft = accent on #2d2614, Running = #9fdcb6 on #20352b like "Played"), muted sub line. "+ New encounter" sits above the list (the board's "+ New session" is in its page header, which this tab does not have). |
| Detail | detail-1440.png, detail-390.png | (Sessions detail cards) | Match to tokens: title card with Delete (danger ghost), live card with dot and the green Start / red End pills, cards in .ss-card look; at 390 one column. |
| Add dialog | add-dialog-1440.png, add-dialog-390.png | (none) | Judged on tokens: brand Modal, fields in .ss-in look, accent primary pill; no horizontal scroll at 390. |

## Needed outside owns (for the orchestrator / A5)
- `src/app/(gm)/campaigns/[campaignId]/adversaries/page.tsx` (A0, then A5): pass `renderActions={(a) => <AddToEncounter
  campaignId={campaign._id} adversary={a} />}` (import from `@/components/adversaries/builder`) instead of `noActions`.
- `tests/e2e/adversaries.spec.ts` (A0): it asserts the builder stub text "Encounters and the Battle Points budget arrive with the
  next update."; with A3 the Encounters tab shows the builder ("No encounters yet. …" / "+ New encounter"). Replace that line with
  `await expect(encountersPanel.getByRole("button", { name: "+ New encounter" })).toBeVisible();`.
- `docs/data-model.md`: no schema change (A0's tables); the functions above are new.

## QUESTIONS
- Minion groups of different names are summed into one party-size count (board behaviour); should each Minion name form its own
  groups instead? (Reversible: `minionGroups` in budget.ts.)
- The default Minion group size in the add dialog is the encounter's party size (exactly one BP group), falling back to 4 when unknown;
  say if a fixed 4 is wanted.
