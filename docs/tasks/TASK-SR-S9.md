# TASK-SR-S9: Header status, death-move modal and badges, status controls

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S9 (wave 2). Shell and frozen names: `docs/tasks/TASK-SR-S0.md`.

C = `src/app/(gm)/campaigns/[campaignId]/party/[characterId]`.

## What changed

- **Banner badges (C/sections/header.tsx):** the status badge (`character-status`) is the sheet-ui `Badge`, which matches the board's FALLEN pill (Cinzel 12 px, 0.18em, dark pill).
  - Dead reads "Fallen" (dark), as on the board.
  - Retired reads "Retired" and away reads "Away · in the infirmary", "Away · sent home" or "Away · benched" (X6). Both use the paper tone.
  - The death badges (`death-unconscious` dark, `death-journey-ends` wine) and the GM's "Return to play" now sit in the banner after the status badge. They used to be in the strip under the header row. "Return to play" is a small light outline pill, 44 px below 640 px. It is still hidden for a benched character (X6), who comes back through the card's "Bring back".
- **Death badges (src/components/party/death/badges.tsx):** `tone` is now `"banner" | "card"` (it was `"paper" | "card"`). The new export `DeathBannerBadges` renders the banner badges, and `awayLabel()` builds the away text the banner and the card share. The dashboard card (`DeathCardBadge`) looks the same as before.
- **Death-move modal (death/death-move.tsx):** it is now a `PaperModal` titled "Death move", replacing the dark brand Modal.
  - Each move is a large parchment option button, styled like the board's advPick options. The button's name is the move and its description (`aria-describedby`) is the CB 106 reminder.
  - Blaze of Glory keeps its "Last action (optional)" paper input under its button.
  - The Castle High reason is a dashed paper fieldset with 44 px radio rows.
  - The Blaze of Glory finish keeps its solid pill and the Risk It All split keeps its paper number and green "Clear them" button. The "Death moves" strip keeps "Make a death move" / "Finish …" as a solid pill and "Undo death move" as an outline pill. Styles: death/death.css (`db-*`).
- **Status controls (C/sections/status.tsx):** a small paper row of outline pills under a rule like the footer's, right-aligned at desktop width and left-aligned at 390 px. It is no longer a box.
  - The pill for the current status is solid.
  - Dead and Retired still ask first in an inline `alertdialog` ("Confirm dead" / "Confirm retired").
  - The region is still named "Status" (now by an `h3`), and the group is still "Character status".

## Defaults taken (open questions)

- Status controls stay at the bottom of page 1 (the mount is in page-one.tsx, which S9 doesn't own), styled as the proposed "small paper row under a rule".
- The dead badge reads "Fallen", the board's word, instead of "Dead".

## Visual comparison

| Region | App 1440 / 390 | Board | Verdict |
|---|---|---|---|
| Header, alive | test-results/visual/S9/header-alive-* | test-results/visual/board/header-* | Banner unchanged from S0; the board has no badge here either. |
| Header, FALLEN | S9/header-fallen-* | board banner with `sheetDead` (same markup: `#0a0606` pill, `#c9bdb5`, Cinzel 12, 0.18em) | Same pill, first in the banner, before the name. |
| Header, unconscious / away + Return to play | S9/header-unconscious-*, S9/header-away-* | (none on the board) | Same pill family; at 390 the badges wrap above the name without horizontal scroll. |
| Death-move dialog | S9/death-move-dialog-*, S9/death-move-dialog-less-lethal-* | advPick (Party.dc.html l. 1187) | Parchment dialog, Cinzel 22 title, option buttons in the advPick style (`#fffaf0`, `#cdb88f` 1.5 px border, radius 10, ≥ 44 px). |
| Death strip, status row | S9/death-strip-*, S9/status-*, S9/status-confirm-* | (none on the board) | sheet-ui pills on the paper. |

## Verification

- `pnpm lint` and `pnpm typecheck` are clean. `pnpm test`: 100 files, 1047 tests passed.
- e2e on ports 3139/3390:
  - death.spec.ts (3 tests: the original Avoid Death flow, now also checking the option description and undo; Castle High Blaze of Glory → "Away · sent home" → Return to play; status row Dead with confirm → "Fallen" → Active);
  - character-sheet.spec.ts;
  - party-roster.spec.ts (X6 benched flow).
  - All 10 passed.
- `E2E_VISUAL=1` S9.spec.ts: 2 passed.
