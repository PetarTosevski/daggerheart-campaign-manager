# TASK-GLASS-G2: the dashboard and the campaign shell's own buttons are glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G2; briefs `.omc/plans/glass-buttons-briefs.md` (Q1-Q9 = a); bead
dcm-q861.3. Built on G0 (9926a1bb). A restyle only: labels, accessible names, `data-testid`s, `type`, disabled logic
and handlers are unchanged; every two-step confirm stays two-step.

## Buttons per file

| File | Button | Role (variant) | Was |
|---|---|---|---|
| `campaign-shell.tsx` | Start Session (hero) | confirm, large | hand-styled gold pill (`heroPill`) |
| | Session N in progress (GM's hero link) | confirm, large (on the `<Link>`) | `heroPill` |
| | Start the session? → Cancel | cancel | hand-styled outline |
| | Start the session? → Start session | confirm | hand-styled green pill |
| | Open the Tome (hero) | neutral, large | hand-styled dark pill |
| | Players (header) | neutral | hand-styled dark chip |
| | Load a campaign (campaign not found, link) | confirm, large | `solid` lg |
| `end-scene.tsx` | End scene (opens the dialog) | danger, sm | `outline` |
| | End the scene? → Cancel | cancel, sm | `outline` |
| | End the scene? → End scene | danger, sm | `primary` (Q9 a: opener and final both danger) |
| `players-dialog.tsx` | Copy join link / Link copied | neutral, sm | default (outline) |
| | New code | neutral, sm | default (outline) |
| | Invite | neutral | `solid` (role map: Invite has no side) |
| | Revoke (per invite) | danger, sm | default (outline) |
| | Remove (per player) | danger, sm | unchanged |
| `wither-panel.tsx` | End Session · convert N to Fear / keep Wither | danger | hand-styled purple |
| | End the session? → Cancel | cancel | hand-styled outline |
| | End the session? → End session | danger | hand-styled red pill |
| `time-arc.tsx` | End day (days 1-6; `TimeArc` and `CampaignDay`) | neutral (`endDayButton`) | hand-styled dark pill |
| | ☀ Bring the Dawn / ☾ Bring the Night (day 7) | neutral with tone hope (dawn) / fear (night) | inline-styled gold / blue pill |
| | Undo the day's end (`UndoEndDay`) | cancel (`undoButton`) | `endDayButton` |
| `time-of-day.tsx` | Advance the time of day (two-line face) | neutral (`flex-col`, centred) | hand-styled card |
| | End day (day card) | neutral | hand-styled gold pill |
| `last-session.tsx` | Open the Journal (link) | neutral on the `<Link>` | hand-styled outline |
| `party-section.tsx` | + Create character (link) | neutral on the `<Link>` | hand-styled outline |
| `src/components/sessions/session-chip.tsx` | Session N chip (link; tracker and Combat Map header) | neutral on the `<Link>`, live dot kept | hand-styled green chip |

## Classes and constants deleted

- `heroPill`'s hand-styled class string (now `brandButton({ variant: "confirm", size: "lg" })`).
- `endDayButton`'s hand-styled class string (now neutral glass); new `undoButton` (cancel).
- `dashboard.css`: the dead `.tm-adv:focus-visible` selector (no element uses `tm-adv`).
- `time-of-day.tsx`: the `cn` import (unused now).

## Left alone, and why

- `fear-panel.tsx`: the 12 Fear tokens on the spiral (`.fz`). They are token art with `aria-pressed`, like pips;
  `fear-render.spec` covers them. The panel has no other button.
- `time-arc.tsx`: the seven day windows on the arc (`.tm-ic`): sky art, not action buttons.
- `sidebar-panels.tsx`: the Campaign Tome panel's chapter rows and the Locations rows: list rows that open something.
  The inline "Inciting Incident" button and the empty-state Locations link are plain text links.
- `party-section.tsx`: "Open the Party tab" is a text link.
- `campaign-shell.tsx`: the player's "Session N in progress" and "Player" badges are `<span>`s, not buttons.
- `src/components/tome/tome-book.tsx` (close ✕, chapter list, previous / next): the Tome book is a paper surface and
  keeps its ink-on-paper buttons (Q5 a). The ✕ sits on the book's leather frame in the book's colours.
- `campaign-tome.tsx`, `campaign-tome-book.tsx`, `frame-rules-panel.tsx`, `page.tsx`, `error.tsx`, `[section]/**`: no
  buttons of their own (the error pages use the shared `CampaignRouteError`).
- The dashboard's other cards (countdowns, frame trackers, rest launcher, roll feed, party cards) belong to G3, G4, G5.

## Out-of-owns edit

- `tests/e2e/glass-foundation.spec.ts` (G0's): its "real dialog" check asserted that the Players dialog's Invite is a
  Fear confirm. G2 makes Invite neutral (as the plan says), so the check now uses the "Start the session?" dialog's
  Start session confirm and its ✕ ("Close start the session?"). The check is the same: a native `<dialog>` in the shell
  inherits the GM's viewer, a Fear confirm, a Hope round cancel, hover ink, axe. The orchestrator approved this edit.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest (`--maxWorkers=1 --testTimeout=120000`):
  - touched areas (`tests/unit/dashboard`, `brand`, `hud/{dock,fear-confirm,fear-scene}`, `journal/{j1-shell,header}`,
    `purposeful-design`): 105 passed;
  - the full suite: 519 files, 11051 passed, 1 expected fail.
- e2e, with servers started by hand on ports 3849 / 3949, `E2E_REUSE_SERVERS=1` and `--workers=1`:
  - `visual/GLASS-G2` (2) and `glass-foundation` (4): 6 passed;
  - `dashboard`, `live-dashboard`, `wither`, `players`, `tome`, `lane3-campaign-time`, `lane-m-time-of-day`,
    `lane4-end-day-undo`, `fear-render`, `campaign-preload`: 26 of 29 passed while the full vitest suite ran alongside.
    The 3 failures were load: a Convex "Function execution timed out (1s)" and two sign-ins that never left `/signin`.
    Rerun once vitest had finished, `lane-m-time-of-day` and `players` passed 7 of 7.
- After the shots, the day card's rule line ("Full light on every map.") got `font-normal`, because the glass button's
  600 weight bolded it. The shots were taken before this one-class change.

## Shots

`tests/e2e/visual/GLASS-G2.spec.ts` (E2E_VISUAL=1) writes to `test-results/visual/GLASS-G2/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g2/`:

- `dashboard-{gm,player}-{1440,1024,390}`: Witherwild dashboards (time arc, Wither panel, End scene, hero).
- `dashboard-gm-hover-start`: the hovered Start Session (Fear fill for the GM); `dashboard-gm-focus-tome`: keyboard
  focus on Open the Tome. Axe runs on G2's parts in both states.
- `start-dialog-gm-*`, `end-scene-dialog-gm-*`, `end-session-dialog-gm-*`, `players-dialog-gm-*` at 1440 and 390.
- `core-dashboard-{gm,player}-{1440,1024,390}`: a core campaign's day card.
- `day-card-gm-undo-{1440,390}`: the day card after End day, with the Undo (cancel).
