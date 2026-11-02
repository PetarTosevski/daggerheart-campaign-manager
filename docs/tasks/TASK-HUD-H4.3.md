# TASK-HUD-H4.3: the death move modal and the "Just now" feed

Plan `.omc/plans/combat-hud.yaml`, wave 5 batch B, tracer H4.3 (boards Main 'Last Hit Point', CmpTokens). Bead
dcm-bxp.99.32 (parent; not closed). Depends on HD4 (`docs/tasks/TASK-HUD-HD4.md`, answer 15b). Mode: add. With the HUD
switch off nothing changes.

## What landed

- **`hud/death/index.tsx`** (`HudDeath`, mounted by the shell in the pop region):
  - Every character the viewer plays (`characters.listByCampaign`, `mine && canEdit`) gets `OwnDeath`. On the GM view,
    every PC also gets `GmDeathConfirm`.
  - Each character sits in its own `PartBoundary`.
- **`hud/death/own.tsx`** (`OwnDeath`):
  - **Choose.** When the last Hit Point is marked (`deathMoves.state.awaitingMove`), 'Choose a death move' opens in the
    brand `<Modal>` (native dialog; its `::backdrop` dims the map, the board's `.dm-back`).
    - The kicker reads "Moss marked their last Hit Point".
    - It offers three move buttons: the name is each button's accessible name, the rule its description.
    - An optional "Blaze of Glory: your last action" field.
    - The footer reads "Your table can see this choice. The GM confirms the outcome." (on the GM's own PC only the
      first sentence, because the GM's choose is made at once).
  - **Wait.** After a player's pick, the same modal reads 'Waiting for the GM to confirm' ("Waiting for the GM to
    confirm Avoid Death.", waiting dots) with Take it back. Take it back is `deathMoves.undo` on `request.entryId`,
    as the sheet's `DeathMoveWait` does.
  - **Outcome.** When the GM confirms, the player gets an outcome popup: "<name>'s death move", "<Move> · confirmed by
    the GM", the move's own feed line (e.g. "Moss avoids death and drops unconscious. Hope Die 9 against level 1: no
    scar."), and Got it.
    - The line is read from `feed.list`: the newest live death row of the character above the request row
      (`requestFate` in `model.ts`).
    - The request the view watches is kept with React's "information from previous renders" pattern (a state set
      during render, no effect), so a reload while waiting still shows the outcome.
  - **Sent back.** The choice opens again with "The GM sent back <Move>. Choose again."
  - **Closing.** Closing the modal hides it until the phase changes. A "Moss: choose a death move" / "Moss: waiting
    for the GM" button opens it again.
  - **Finish steps.** After the confirm, Blaze of Glory's finish and Risk It All's split mount the sheet's own
    `DeathMoveModal`, as the classic map's `MapDeathMove` does. A less-lethal frame's choice (Castle High's away reason)
    does the same.
  - **The GM's own PCs.** The choose is made at once, and the outcome popup shows `deathResultText`.
- **`hud/death/confirm.tsx`** (`GmDeathConfirm`): a GM-tone HUD `Popup`, 'Death move to confirm', on the GM view. It
  stays there until H5.1's queue takes it.
  - The body reads "<name> marked their last Hit Point and chose <Move>[: action]. The dice roll when you confirm."
    plus the less-lethal request when there is one.
  - Its buttons are Confirm the death move (`deathMoves.confirm`) and Send it back (`deathMoves.decline`).
  - After the confirm, the outcome (`deathResultText`, the sheet's line) stays until Done.
- **`hud/death/model.ts`**: `DEATH_MOVES`, `DEATH_MOVE_RULES` (core wording), `deathPhase`, `requestFate`.
- **`hud/death/death.css`**: the board's `.dm` (520 px, red rim and glow, Cinzel title, `.dm-o` options with the gold
  focus ring). Popups stack in the pop region's centre column, below the banners and the scene toolbar.
- **Greyed PC**: H1.1's banner (`hbn-down`, grey portrait) and H1.3's token (`tk-down`) already grey a PC with every Hit
  Point marked. The spec checks the banner on both views, and no file changed for it.
- **`hud/feed/**`** (`HudFeed`): "Just now" in the shell's left region (bottom-left), on the player view only.
  - The newest 5 public rows of `feed.list`, live (`aria-live="polite"`).
  - Each row has the board's icon by kind (hit, dice, Fear, death) and a grey detail line: the roll total and outcome,
    the Fear gained or spent, and "undone".
  - It shows a loading line and an empty state.
  - It is hidden at ≤ 1100 px (PlayerTablet: "Feed is hidden"). The phone's Feed tab is H7.x's.
  - On the GM view the left column holds the queue and Resolutions with Undo (H5.1); the spotlight panel stays under
    them, as the user asked.

## Board states matched (shots: `test-results/visual/HUD-H4.3/`, written by `tests/e2e/hud-death.spec.ts`)

| Board state | Shot |
| --- | --- |
| Main 'Last Hit Point' (modal over the dimmed map, grey Moss banner) | `last-hit-point-1440.png` |
| Waiting for the GM to confirm | `waiting-1440.png` |
| GM confirm popup (GM view) | `gm-confirm-1440.png` |
| Outcome on the player view, "Unconscious" on the banner | `outcome-1440.png` |

- **Copy.** The move descriptions follow the core book, not the board's sample copy (HANDOFF: "the death-move wording,
  which follows the core rules"). The board's Avoid Death says "until an ally clears a Hit Point or the scene ends"; the
  book says "or when the party finishes a long rest" (CB p.106).
- **Visual spec.** No separate `tests/e2e/visual/HUD-H4.3.spec.ts`: it is not in the tracer's owns. The shots come from
  the functional spec, as H4.2's do.

## Out-of-owns edits

None.

## Reused, not forked

These come from `party/death`:
- `deathResultText`
- `DeathMoveModal`, for the finish steps and Castle High
- the same mutations as `DeathMoveWait` (`undo`, `confirm`, `decline`)

They come from `lib/domain/death`:
- `DEATH_MOVE_LABELS`
- `AWAY_REASON_LABELS`

The sheet's `MOVE_HINTS` is not exported (and `party/death` is reads-only), so the HUD's rule lines live in
`hud/death/model.ts`, in the book's words.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `tests/unit/hud/death-feed.test.tsx`: 14 passed.
- Full vitest (`--maxWorkers=2 --testTimeout=120000`): 465 files; 10424 passed, 1 expected fail.
- e2e (ports 3178 / 3468):
  - `tests/e2e/hud-death.spec.ts`: 2 passed. One is the live two-browser case: the player chooses, the GM confirms,
    both see the outcome, and the feed is live. The other covers Take it back, Send it back and reopen. axe runs on
    the modal (choose, wait), the GM popup and the feed.
  - All `hud-*.spec.ts` plus `death.spec.ts`: 28 passed, 2 failed.
    - `hud-banners.spec.ts` passed on a rerun (a flake under load).
    - `hud-make-room.spec.ts` "the GM: a stat block makes room…" fails at line 57: a click on the Lieutenant
      selects the token but no stat block opens. It fails the same way with H4.3's parts swapped back to the `rebuild`
      stubs, so it does not come from this tracer.

## Merge-time actions

None: no Convex change, no codegen, no authz entry.

## Follow-ups

- H5.1 moves `GmDeathConfirm` into the queue ("death move confirm"). It can import `GmDeathConfirm`'s logic or lift it;
  then drop the `gm` branch of `HudDeath`.
- The classic map's `MapDeathMove` still mounts inside the tools drawer's classic column. With the drawer open while a
  move is due, the sheet's modal opens too, as it does for H4.2's hit window. It goes at wave 9.

## QUESTIONS

1. **Who sees the outcome popup?** (UI, not a rule.) The board says "Your table can see this choice". Only the choosing
   player and the GM get the popup; other players read the request and the outcome in "Just now". Reversible.
2. **May the player close the modal?** CB p.106: "when you mark your last Hit Point, you must make a death move". GM
   chapter p.182: "make space for them to work and talk through their decision". The default lets the player close
   it and reopen it from a button, because nothing else is blocked meanwhile. Reversible: drop `onClose`.
