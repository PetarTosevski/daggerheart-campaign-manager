# TASK-HUD-H9.2: "Waiting on you", Resolutions behind Log, Areas bottom-right

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 10, tracer H9.2, batch B (boards GMDesktop, GMTablet,
CmpPromptsGM). Delta `.omc/plans/combat-hud-v2-delta.md`; user answer Q10 (a) binds: the queue stays closed; a new
request pulses the count and shows a short toast. Mode: replace. No server change, no codegen.

## What landed

- **"Waiting on you"** (`hud/queue/index.tsx`, `queue.css`; GMDesktop / GMTablet `.wchip`): the GM's queue is closed
  by default behind a bottom-left button (left 16, bottom 16, 56 px; tablet left 12, bottom 12, 52 px with the label
  hidden visually, kept for screen readers): tray icon, "Waiting on you", the count (`.wn` purple, `.wn0` grey "0",
  `data-testid="hud-wait-count"`), a chevron that turns when open. `aria-pressed` and `aria-expanded`,
  `aria-controls` the queue. It opens the unchanged queue above it (bottom 72, 330 px; tablet bottom 74, 300 px),
  capped under the party banners, cards scrolling inside. Open state is `hud/panels.ts` entry `"queue"`: one GM panel
  at a time (Log, Areas, Dice… close it), Escape closes it and the focus goes back to the button.
- The queue stays mounted while closed (hidden by CSS), so a death confirm's outcome or a half-set Difficulty survive
  closing it, and the count reads the same merged reads as before.
- **Q10a arrivals**: a request that arrives after the queue first loaded (every read settled, so loading never
  toasts) pulses the count (Web Animations, skipped under `prefers-reduced-motion`; no state, no re-render) and, while
  the queue is closed, toasts in the HUD toast host: **"Vex: out of range"** · "Waiting on you" (neutral tone, one per
  request, keyed so a repeat replaces). Titles (`queue/model.ts` `arrivalTitle`): out of range, "set the Difficulty",
  "<attacker> → <target>: reactions", "does Cloaked end?", the fire question, "ally roll", "<PC>: death move".
  Requests open when the GM loads the map count but don't toast. UI only: nothing is sent.
- **Resolutions only behind Log**: `HudQueue` no longer renders `HudResolutions`, so Log no longer shows them twice.
  The shell's "log" region (H9.0, right 16 / bottom 80 / 360 px; tablet right 12 / bottom 74 / 330 px, now shown at
  tablet width) is their only desktop / tablet home; `queue.css` caps its height under the banners and scrolls.
- **GM phone queue sheet** (answer 13a, `phone/queue.tsx`): the sheet provides `QueueInSheet`, and inside it the queue
  renders inline (heading, count, cards) with Resolutions under it; no button there.
- **Areas bottom-right** (`hud/areas`): right 182 / bottom 80 (GMDesktop `.gmc .ar`), tablet right 12 / bottom 74
  (overrides responsive/tablet.css's old "under the Fear banner" placement); keeps its fold (user 2026-11-02). Its ✕
  and Escape close it through `closePanel("areas", true)`, so the focus returns to the dock's Areas button (it used to
  go to the old title-row Areas button). `areas/open.ts` stays the mirror flag `panels.ts` and H9.3's scene read.

## Placement fixes from H9.0

- The always-open queue and Resolutions column under the dock's left end at 1440 is gone (the queue is closed; open,
  its right edge is left of the dock — `hud-queue.spec.ts` checks it).
- `hud-queue.spec.ts:101-103` (the `.hud-map .cm-toolbar` and the GM spotlight panel) is replaced by the new
  placement checks.

## Allow / Decline (Arcane Glass roles, merged rebuild 6d1d2929)

`items.tsx`: the GM's answer to a player's request is Allow in Hope gold, Decline in Fear purple, Decline left of
Allow: Out of range (Allow, primary `role: "allow"`; Decline `"deny"`) and Set the Difficulty (Set and roll `"allow"`;
Decline `"deny"`). `no()` takes a role; Ally roll's "Cancel the roll" is `"cancel"`; Resolve now stays the default
confirm; Cloaked and the fire ask keep confirm / neutral. The branch merged rebuild (speed pass 2d1b20d4: the queue
reads `combatRequestsReads`, `combatCardsReads`, `combatFeaturesReads`, `charactersReads`).

## Log beside a sheet

While a sheet or stat block is open, the "log" region moves left of the panel (`right: --hud-sheet-w + 16`, tablet
+ 12; `queue.css`), so Undo stays reachable (`combat-adversary.spec.ts` undoes with the stat block open).

## Specs (owns)

- `tests/unit/hud/queue.test.tsx` (new): closed by default, grey 0, opens / closes through panels.ts, one panel at a
  time, arrival toast (not on load, not while open), death move arrival, the phone sheet inline with Resolutions,
  arrival titles, Areas ✕ focus return.
- `tests/e2e/hud-queue.spec.ts`: closed button at left 16 / bottom 16 / 56 px with grey 0; two arrivals → purple 2 and
  the toast; opens above (bottom 72, 330 px, under the banners, left of the dock); Escape returns focus; withdraw,
  Allow; Log opens Resolutions at right 16 / bottom 80 / 360 px (once), closes the queue; Undo. Reactions via the
  button. Areas at right 182 / bottom 80 and ✕ focus to the dock's Areas. Tablet 1024: button 52 px at 12 / 12 with
  the label hidden, queue bottom 74 / 300 px, Log right 12 / bottom 74 / 330 px, Areas right 12 / bottom 74. Axe at
  1440 × 900 and 1024 × 768.
- Updated: `hud-fear-confirm.spec.ts` (Areas and End scene from the dock, Areas at 182 / 80; End scene closes other
  GM panels, so Areas reopens), `hud-answers.spec.ts` (Log for Resolutions; Dice from the dock),
  `hud-make-room.spec.ts` (Areas from the dock; the dock stays beside a sheet; after merging rebuild the player title
  hides with a sheet open, per H9.3 scene.css), `lane4-cloak-prompt.spec.ts`,
  `lane4-fire-ask.spec.ts` (open "Waiting on you" first), `combat-adversary.spec.ts` (Log open for Resolutions),
  `visual/HUD-H5.1.spec.ts`; new `visual/HUD-H9.2.spec.ts` (board renders and seed shots, `E2E_VISUAL=1`).
- Coordinator request (H9.3 removes the "GM tools" group): `hud-answers.spec.ts`, `hud-fear-confirm.spec.ts` and
  `hud-make-room.spec.ts` find Dice, Areas and End scene in the dock (`toolbar` "Map controls").

## Out-of-owns edits

- `tests/unit/hud/queue-cards.test.tsx`, `tests/unit/hud/blocked-gm.test.tsx`: their Resolutions cases render
  `HudResolutions` instead of `HudQueue` (Resolutions left the queue). Minimal: the import and the render lines.

## Specs outside owns the merge may affect (their owners)

- `hud-pick.spec.ts:117`, `hud-card-pick.spec.ts:93`, `hud-blocked-gm.spec.ts:90-105` look up queue cards; a
  `toBeVisible` / click on a card needs `getByRole("button", { name: /^Waiting on you/ }).click()` first
  (`toHaveText` on `hud-queue-count` still works closed).
- `combat-actions-flow.spec.ts:237`, `adversary-actions-flow.spec.ts:267` expect Resolutions visible: click the dock's
  Log first.
- `hud-tablet.spec.ts:175-226` (H9.6): the queue column now sits above the button at bottom 74 and Resolutions show
  in Log at tablet; `hud-phone.spec.ts` (GM sheet) should pass unchanged.
- `responsive/tablet.css` (H9.6): `.hud-q-col > [data-testid=hud-resolutions]` and the `.hud-r-left` column rules
  for the GM are dead weight now; `.hud-areas` top 232 is overridden by `areas.css`.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. vitest `tests/unit/hud`: 35 files, 462 passed.
- e2e (`E2E_PORT=3709 E2E_CONVEX_PORT=3809`, `--workers=1`): hud-queue (3), hud-answers, hud-fear-confirm,
  hud-make-room, lane4-cloak-prompt, lane4-fire-ask, combat-adversary, combat-actions-a11y, hud-pick, hud-card-pick,
  hud-blocked-gm, combat-actions-flow, adversary-actions-flow: 27 pass (hud-queue, hud-fear-confirm and
  combat-adversary "Rook" on the rerun after the spec fixes / a target-size axe flake on the hit window's glass
  button). `E2E_VISUAL=1` HUD-H9.2 (2) and HUD-H5.1 pass.
- Shots: `test-results/visual/HUD-H9.2/` (board renders; gm-1440 / gm-1024: closed (toast at 1440), button, queue,
  log, areas).
