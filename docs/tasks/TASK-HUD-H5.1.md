# TASK-HUD-H5.1: the GM request queue ("Waiting on you") and Resolutions with Undo

Plan `.omc/plans/combat-hud.yaml`, wave 6, tracer H5.1 (boards GMDesktop 'Requests', CmpPromptsGM). Bead dcm-bxp.99.32
(parent; not closed). Mode: add. With the HUD switch off nothing changes. No server change.

## What landed

- **`hud/queue/index.tsx`** (`HudQueue`): GM only. The shell's H0 stub is replaced. Inside one column it mounts two
  parts, each in its own `PartBoundary`:
  - **"Waiting on you"** with a count, as a `<section>` landmark.
  - **Resolutions**.
- **The queue is a client merge of the existing reads.** `queueItems` in `model.ts` lists the items oldest first. Each
  item is one CmpPromptsGM card: the HUD `Popup` on the GM tone, made compact in the 330 px column.

  | Card | Read | Answer (existing keyed mutation) |
  | --- | --- | --- |
  | Out of range: your call (attack) | `combatRequests.mine` (kind `sanction`) | Allow / Decline: `combatRequests.sanction` |
  | Out of range: your call (card) | `combatCards.pending` | `combatCards.sanction` |
  | Out of range: your call (feature) | `combatFeatures.pending` | `combatFeatures.sanction`. The classic UI had no button for this one. |
  | Set the Difficulty (Charge, Cloaked in dim light) | `combatRequests.difficulties` | Stepper; Set and roll / Decline: `featurePrompts.answerDifficulty` |
  | Reactions (who still has to answer, with waiting dots) | `adversaryActions.windows` | Resolve now: `adversaryActions.resolve` |
  | Does <name>'s Cloaked end? | `cloakPrompts.pending` | Yes, it ends / No, it stays: `cloakPrompts.answer` |
  | Was this hit fire? (the server's question) | `hitKeywords.asks` | Yes, it was fire / No: `hitKeywords.answer` |
  | Ally roll (waiting on the roller) | `featurePrompts.allyRolls`, the GM's `pending` | Cancel the roll: `featurePrompts.cancelAllyRoll` |
  | Death move to confirm | `deathMoves.state` per PC (`useQueries` for the count) | H4.3's `GmDeathConfirm`, reused: Confirm the death move / Send it back |

- **How an answer behaves.**
  - Every answer has an optimistic update that drops its card at once.
  - The result shows in the queue's status line ("Allowed: Moss · Attack.", "Vex stays Cloaked.").
  - A refusal stays on its card as an alert.
  - A card or feature whose approval needs a player's choice (`needsChoice`) keeps its card, with the classic note.
- **Already answered.** REQUEST_NOT_OPEN or DEATH_MOVE_NOT_WAITING means the item was answered elsewhere (another GM
  tab, the player's withdraw, the encounter ending). It shows "Already answered: <who · what>" with OK, and its card
  drops out.
- **Withdrawn.** HD3 closes a withdrawn request, so it leaves every read and its card disappears live. The e2e spec
  checks this.
- **Resolutions** (`resolutions.tsx`) shows the GM's latest `combat` and `adversary` rows from `feed.list` (newest
  first, 6). This is the classic column's Resolutions and "Adversary actions" lists in one.
  - Each row has the hit icon, the summary and the feed's detail line (`feedDetail`: damage, "GM gains 1 Fear",
    "undone").
  - Undo (`actionLog.undo`) is optimistic: the row strikes through at once. A refusal rolls it back and shows its text
    under the list (UNDO_STALE: "That can't be undone any more: something newer happened since.").
  - The block is not a landmark, so the classic drawer's "Resolutions" region stays unique.
- **Answers 7a and 14a.**
  - There is no Momentum prompt. Momentum's Fear rides on the adversary's row, which shows in Resolutions as
    "GM gains 1 Fear" with Undo.
  - There is no Hope split.
- **Map tools.** The GM's classic request column stays in H0's Map tools drawer, unchanged.

## Placement

The queue stays in the shell's "left" region, bottom-left. The column stacks the queue, then Resolutions, then the
GM's spotlight panel at the very bottom, as the user asked on 2026-11-02.

- The board hangs `.gq` at top 300, but that is where the party banners hang.
- The column grows upward from the spotlight panel. It is capped at `100dvh − 300px (banners) − 150px (spotlight)`
  (`queue.css`), and the cards scroll inside the queue.
- The e2e spec checks the placement at 1440 × 900: x < 40, the top below every banner's bottom, and the bottom above
  the spotlight menu.
- `shell.tsx` is not changed.

## Board states matched (shots: `test-results/visual/HUD-H5.1/`)

| Board state | Shot | Spec |
| --- | --- | --- |
| GMDesktop 'Requests' (two out-of-range uses) | `requests-1440.png` | `hud-queue.spec.ts` |
| Resolutions with Undo after Allow | `resolutions-1440.png` | `hud-queue.spec.ts` |
| CmpPromptsGM 'Reactions' card | `reactions-card.png` | `hud-queue.spec.ts` |
| Full queue: attack, card, Reactions, death confirm (4) | `requests-full-1440.png`, `queue-column.png` | `visual/HUD-H5.1.spec.ts` (E2E_VISUAL=1) |
| Queue + Resolutions after Resolve now | `queue-and-resolutions.png` | `visual/HUD-H5.1.spec.ts` |

Board renders to compare: `reference/designs/combat-hud/preview/GMDesktop.dc.html` (state Requests) and
`CmpPromptsGM.dc.html`. The sample rows ("Moss · Vicious Entangle", "Brannoc · Strength roll", "Mira", "Ash") come
from the e2e seed's real data.

## Items skipped

- **End this countdown?** dcm-pgfr (the countdown's link to its adversary instance and the prompt's server) is still
  open, so there is nothing to read. Add the card when that server lands.
- **More Where That Came From and other adversary feature choices.**
  - The choices before a use are asked through `adversaryActions.featureAsk` when the GM uses the feature (H5.2's
    stat block).
  - The use's GM prompts (summon, countdown, manual) come back only in `useFeature`'s return value. Nothing stores
    them, so no read can list them.
  - Filed **dcm-bxp.99.32.27** (lane E7) to store them as open requests; the queue adds the card then.
- **Momentum** (answer 7a) and **Hope split** (answer 14a) are left out by design.

## Out-of-owns edits (minimal; for the orchestrator)

- `src/components/combat-map/hud/death/index.tsx`: removed the GM branch (`GmDeathConfirm` per PC). The queue mounts
  it now, so the GM never gets two confirm popups. `hud-death.spec.ts` finds the same dialog ('Death move to confirm',
  `hud-death-confirm`, `hud-death-outcome`) in the queue unchanged.
- `tests/unit/hud/death-feed.test.tsx`: the two "GM's confirm popup" tests render `GmDeathConfirm` directly instead of
  `HudDeath` as the GM. Same assertions.

## Tests

- `tests/unit/hud/queue-model.test.tsx`: the merge order, the lines, Already-answered codes and the Resolutions filter.
- `tests/unit/hud/queue-cards.test.tsx`: the player view is empty; one card per kind with the count; empty and loading
  states; every answer's mutation and args; needsChoice; REQUEST_NOT_OPEN → Already answered; a card's alert; the
  Difficulty stepper; the death confirm; Resolutions Undo and UNDO_STALE.
- `tests/e2e/hud-queue.spec.ts`:
  - Live with two browsers: the player's out-of-range attack and card land in the queue. The player withdraws the
    card in the HUD and it disappears from the GM's queue. The GM allows the attack: the player's wait ends, the hit
    shows in Resolutions, and Undo undoes it. The spec also checks the placement and runs axe.
  - A Brute's hit gives a 'Reactions' card; Resolve now settles it and the row shows in Resolutions.

## QUESTIONS (defaults taken, reversible)

1. The Difficulty stepper starts at 12, with a range of 1-30. The board shows 13 as sample data. This is a UI starting
   point the GM steps, not a rule. The GM sets the Difficulty for these rolls ("The GM sets this Difficulty", CB p.104).
   Should it start somewhere else, or take typed input?
2. Resolutions lists only the GM's `combat` and `adversary` rows, as the classic column does. The board also shows a
   PC's plain roll with Fear ("Vex rolled with Fear · +1 Fear · Undo"). Should plain action rolls show there too?
   (They are in the feed and the classic dice log.)

## Checks

- **`pnpm lint`**: clean.
- **`pnpm typecheck`**: clean.
- **vitest, full suite** (`--maxWorkers=2 --testTimeout=120000`): 467 files, 10443 passed, 1 expected fail.
- **`hud-queue.spec.ts`**: 2 of 2 passed, axe included.
- **`visual/HUD-H5.1.spec.ts`** (E2E_VISUAL=1): passed.
- **All `hud-*.spec.ts`** (27 tests), run on servers started by hand with `E2E_REUSE_SERVERS=1`: 22 passed in the
  full run.
  - 4 failed on Convex 1 s function timeouts at load average about 15: `hud-area-pick:48`, `hud-hit:80` and both
    `hud-queue` tests. All 4 passed when rerun on their own.
  - `hud-make-room.spec.ts:32` fails on `rebuild` without this change. `tokens-layer.tsx` skips the GM's adversary
    click until H5.2's stat block lands (H5.2's acceptance re-enables it).
  - `hud-death.spec.ts` passes with the GM's confirm now in the queue.

## Merge-time actions

- No codegen: no Convex file changed.
- Accept the two out-of-owns edits above (`hud/death/index.tsx`, `tests/unit/hud/death-feed.test.tsx`).
