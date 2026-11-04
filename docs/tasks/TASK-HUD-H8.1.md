# TASK-HUD-H8.1: cut-over, page and player side

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 9, tracer H8.1 (boards Main, PlayerTablet, PlayerPhone).
Briefs: `.omc/plans/combat-hud-briefs.md` "Wave 9 (cut-over)". Parent bead dcm-bxp.99.32. Mode: replace. No server
change, no codegen. User decision 2026-11-03: "Cut over now"; the HUD is the only Combat Map; no Admin switch is added.

## What landed

- **No switch.** `hud/flag.ts` (localStorage `dcm:combat-hud`, `?hud=1` / `?hud=0`, `useHudEnabled`) and
  `HudSwitchButton` are deleted. The page renders `HudShell` whenever the map is in Play, for the GM and every player.
  The GM's Edit mode (and the GM with no map yet) keeps the two-column layout with its header (answer 12a: the HUD has
  no Edit mode). A stale stored value or an old `?hud=0` link changes nothing.
- **Classic player UI deleted:** the player column (incoming-hit card, combat actions panel, phone bottom sheet), the
  target list, the Attack bar with its rider toggles / after-roll / rider-pick prompts and result card, the Hand card,
  docked fan and GM hand card, the Use and after-roll dialogs, the map dice box and mini feed, the sheet drawer dialog
  and its Sheet buttons, and the classic header outside Edit.
- **Kept for the HUD** (it imports them): `hand/face.tsx`, every `model.ts`, `attack/mods.ts`, `roll-controls`,
  `map-view/area-pick`, `party/death`, plus the helpers listed per file below.
- **While the map loads the GM gets the column** (as before the cut-over; players get the HUD's loading line), so the
  GM's links mount at once (`navigation-perf.spec.ts` counts an extra sprite-packs prefetch otherwise).
- **Edit stays Edit:** the GM with no map yet is in Edit and stays there once the first map exists (made in the column
  or generated); only the Play / Edit switch moves the GM into the HUD (without this a GM's first "New map" jumped into
  the HUD with the drawer closed).
- **Kept on purpose, not HUD:** the target rings layer (`TargetsLayer`), the GM column in the "Map tools" drawer
  (H8.2 trims it), `GmOwnHits` and `PendingHits` (GM column and the character sheet page), `EndSceneButton`.
- **New, small:** `SheetExtras` (`drawer/index.tsx`): the classic drawer's class controls the HUD sheet does not show
  yet (class counters and held dice, Flying Q16, Beastform "Drop out" Q10, Martial Artist stances Q5), in the HUD's tools
  drawer for the player's own PC and for the PC token the GM selected (greyed until "Play for this character").
  Without it those controls would have no UI at all after the cut-over (see QUESTIONS 1).

## Files (owns)

| File | Fate |
|---|---|
| `src/app/(gm)/campaigns/[campaignId]/combat-map/page.tsx` | Reduced: Play always `HudShell`; Edit keeps the column and `EditHeader` (title, header line, scene tools, no switch, no Sheet), and the GM with no map stays in Edit after the first map; while the map loads the GM gets the column. Player drawer: view card, token card, `SheetExtras`. GM column gets `SheetExtras` under the token card. SheetButton / SheetDrawer / IncomingHit / ActionsPanel gone. |
| `.../combat-map/combat-map.css` | Kept (the Edit layout, error and packs pages use it); one comment fixed. |
| `src/components/combat-map/slots.ts` | Reduced: `ActionsPanelProps`, `SheetDrawerProps` and the sheet-drawer contract gone; tables say what the HUD owns now. `sheetCharacterId` / `sheetHref` kept (`SheetExtras`, unit tests). |
| `hud/flag.ts` | Deleted. |
| `hud/shell.tsx` | Reduced: toolbar is the Map tools button only; passes the campaign to the drawer. |
| `hud/tools/index.tsx` | `HudSwitchButton` deleted (`tools.css` unchanged); the GM's drawer now ends with `HandSharingSwitch` ("Players can see each other's cards", testid `combat-hand-sharing`), which only the deleted classic GM hand card mounted. |
| `hud/index.tsx`, `hud/token/hooks.ts` (added to owns 2026-11-03) | Re-exports of the switch removed; `useHudTokens` is the HUD face whenever the map is in Play inside the shell. |
| `tokens/tokens-layer.tsx`, `vision/vision-layer.tsx` | Kept unchanged (they draw the HUD face through `useHudTokens`; the Encounter tab's map pane keeps the classic face). |
| `actions/index.tsx` | Reduced to `Resolutions` (adversary actions, CA5 Resolutions, End scene) and re-exports (`TargetsLayer`, `ActionsProvider`, `GmOwnHits`). `ActionsPanel`, bottom sheet, `usePhoneLayout` deleted; the GM hand card left `Resolutions` (the HUD hand plays for a PC). |
| `actions/actions.css` | Reduced: 28 dead classes' rules removed (target list, Attack bar, feed, bottom sheet). |
| `actions/targets/index.tsx` | Reduced: `TargetList`, `TargetRows` deleted; hints, `useTargetHints`, `BAND_LABEL`, `TargetsLayer` kept. |
| `actions/attack/index.tsx` | Reduced to helpers: `damageLabel`, `equippedWeapons`, `outcomeLine`, `targetVerdict`, types. `AttackBar`, `AttackResult`, Minion dialog deleted. |
| `actions/attack/riders.tsx` | Reduced to the rider model (`pickOf`, `ridersToSend`, `riderProblem`, `extraMax`, `extraCandidates`, `HeldRoll`…). Toggles and prompts deleted. |
| `actions/attack/riders.css`, `actions/attack/memory.tsx` | Deleted. |
| `actions/hand/index.tsx` | Reduced to `handHiddenKey` (HUD hand). |
| `actions/hand/dialog.tsx` | Reduced to card-use helpers (`swapsWithVault`, `asksTriggerDamageType`, `listedValues`, `withListedNumbers`, `distinctFromOf`, `DialogRequest`, `VaultPick`). `UseDialog`, `AfterRollDialog` deleted. |
| `actions/hand/dock.tsx` | Reduced to `VaultDeck`; imports `hand.css`. Dock and fan deleted. |
| `actions/hand/hand.css` | Reduced: 37 dead classes' rules removed; the card face, vault deck and card result stay. |
| `actions/hand/result.tsx` | Kept (`CardResult`, HUD); now imports `dice.css` and `hand.css` itself (the deleted Attack bar used to). |
| `actions/hand/sharing.tsx` | Reduced: `HideHandSwitch` deleted (the HUD sheet has its own). |
| `actions/hand/use-card.ts` | Kept (HUD hand and card picker). |
| `actions/reactions/index.tsx` | Reduced: `IncomingHit` deleted; `GmOwnHits`, `PendingHits`, `HitBoundary` kept. |
| `actions/reactions/prompt.tsx`, `reactions.css` | Kept (character sheet's incoming hit, GM column). |
| `actions/dice/index.tsx` | Reduced to `MINI_FEED_ROWS` (read by `adversary/flash.tsx`, H8.2). |
| `drawer/index.tsx` | Replaced: `SheetDrawer` deleted; `SheetExtras` added. |
| `drawer/drawer.css` | Reduced: 33 dead classes' rules removed. |
| `drawer/boundary.tsx` | Kept (`requests/`, `drawer/use`, many party parts). |
| `drawer/trackers/index.tsx`, `drawer/list/index.tsx` | Deleted (the HUD sheet shows trackers and features). |
| `drawer/list/controls.tsx` | Kept (`D5Use` in the HUD sheet; Flying / Beastform / stances in `SheetExtras`). |
| `drawer/prompts/**`, `drawer/use/**` | Kept (HUD sheet and action ring). |
| `tests/e2e/hud/helpers.ts` | `enableHud` is a no-op (kept so HUD specs need no edit); `hudScene` lost its `hud` option. |

## Specs

### Unit (tests/unit)

| Spec | Fate | Coverage of what left |
|---|---|---|
| `combat-actions-ui.test.tsx` | Reduced to helpers (hints, picking, verdict / outcome words, damage label, GM filter) | Target list → `hud/pick-model.test.tsx` "lists every creature of the rule's side with band and reach…", "row names and ring labels carry names and bands only (U1)…"; attack result → `hud/result-panel.test.tsx`, `hud/attack-pick.test.tsx` "resolved: Hit / Miss / Defeated only (hard rule 2)" |
| `combat-hand.test.tsx` | Reduced to the Hand model, card result, GM sharing switch, drop / aim and out-of-range model | Hand UI → `hud/hand-states.test.tsx`, `hud/card-pick.test.tsx`, `hud/sheet-panel.test.tsx` ("Hide my hand"), e2e `hud-hand.spec.ts`, `hud-card-pick.spec.ts`, `hud-gm-playfor.spec.ts` |
| `combat-riders.test.tsx` | Reduced to the rider model (Rage Up numbers, Hold Them Off extras, Kick option, Rise to the Challenge) | Toggles → `hud/attack-pick.test.tsx` "weapon tiles, roll chips, riders with cost pills…"; Death Strike / held roll → `hud/result-panel.test.tsx` "a damage-phase rider…", "'Your roll waits'…", "Pass on a held roll…" |
| `incoming-hit.test.tsx` | `IncomingHit` tests now drive `GmOwnHits` (GM column); model, prompt, sheet and retry tests unchanged | Player's map card → `hud/hit-window.test.tsx`, e2e `hud-hit.spec.ts` |
| `sheet-drawer.test.tsx` | Models kept; drawer dialog tests replaced by `SheetExtras` (counters, Flying, Beastform, stances, GM greyed, refusal) and `D5Use` | Drawer trackers, features, Use flow, Play-for, loading / error → `hud/sheet-panel.test.tsx` |
| `drawer-list-states.test.tsx` | Deleted | Spent feature shows when it comes back → `hud/blocked-player.test.tsx` (`hud-sheet-used`, "Used · back after a long rest"); the DA7 "Active" banner has no HUD equivalent (QUESTIONS 2) |
| `drawer-prompts.test.tsx`, `drawer-use.test.tsx` | Unchanged (components kept) | — |
| `hud/h0-state.test.tsx` (added to owns) | Switch tests deleted; provider and drawer tests kept | — |

### E2E

| Spec | Fate | Notes / coverage |
|---|---|---|
| `combat-map-shell.spec.ts` | Drives the HUD (player test) | Player: `combat-hud`, `hud-title` "No live map yet", board empty state, read-only Fear, no Map tools. GM tests unchanged (Edit layout). |
| `fear-render.spec.ts` | Unchanged | Dashboard only. |
| `lane-m-time-of-day.spec.ts` | Drives the HUD | Player: `hud-disc` light, the dim rule on the light pill in "Your character". |
| `combat-tokens.spec.ts` | Drives the HUD | Combatants / token card in the Map tools drawer; HUD token names; own condition on the HUD sheet; 1440 × 900 (at 1280 × 720 the GM's spotlight panel covers the Bear). |
| `combat-vision.spec.ts` | Drives the HUD | Pill and "Your view" in the player's drawer; `hud-title`; Reveal in Map tools; fog brush and Forget explored in the HUD Fog pop-up; Player view in "GM tools". |
| `live-combat.spec.ts` | Drives the HUD | Map tools drawer open for maps / Doors / See the map as / fog; HUD token names; focus + keys (a click opens the sheet); "Something blocks the way." |
| `area-overlay.spec.ts` | Drives the HUD | HUD "Areas on the map" panel (fold / unfold, Shape group); player's Dark Cloud from the HUD sheet and square picking (`hud-area-*`). |
| `combat-cannonball.spec.ts` | Drives the HUD | GM: Moss's HUD sheet + Play for this character; player at 390: full-screen sheet; same `ally-roll-*` prompts. |
| `combat-feature-reactions.spec.ts` | Unchanged | Character sheet page only. |
| `incoming-hit.spec.ts` | Drives the HUD (map test); sheet tests unchanged | "You were hit" / "Tabby can react" (390 bottom sheet), I Am Your Shield, Mark 2 Armor. |
| `combat-cards.spec.ts` | Drives the HUD | GM plays a card for Moss (Play-for on the HUD sheet → picker → ring → result → feed); once-per-rest card used → rest → back, free recall during the rest. Dropped: drag / dialog (gone), Hide across reload (answer 16a); rest named in its header → `hud-hand.spec.ts`, `hud-card-pick.spec.ts`, `hud-result.spec.ts`, `hud-sheet.spec.ts`. |
| `combat-riders.spec.ts` | Drives the HUD | Hold Them Off (rider switch, 2 extra targets, 3 Hope, 3 results); Patron's Boon held roll → Use. Sneak Attack, Rage Up → `tests/convex/combat-riders.test.ts` + `hud/attack-pick.test.tsx`. |
| `combat-actions-flow.spec.ts` | Drives the HUD | Three browsers as before. Ash's attack through the action ring (Hit, no numbers, GM `hud-resolution`); Wild Flame on two (spell radio, two rows); the GM's Undo (`hud-res-undone`, the player's feed row undone); Recant ("GM approves" row, Hope −1); vault recall (2 Stress); a Minion offer ("Pick Minions", Defeat 1); a once-per-rest card used → rest → back; the U1 websocket-frame scan for enemy numbers. |
| `combat-actions-a11y.spec.ts` | Drives the HUD | Phone Attack tab (after an attack) and Dice tab (after a roll) axe + fit; desktop Dice dialog axe; GM at 390 phone queue with Undo, axe + fit. Classic desktop scans → `hud-hand.spec.ts`, `hud-attack-pick.spec.ts`, `hud-answers.spec.ts`; picker / result sheets → `hud-phone-sheets.spec.ts`. |
| `a11y-combat-hand.spec.ts` | Drives the HUD | Axe on the HUD hand in every state; 1024 × 768 fit + map above the hand; phone Hand tab 44 px + axe. Tablet 44 px side buttons and the 768 × 1024 hint overlap are a `test.fixme` (dcm-bxp.99.32.41). Drag-to-aim gone (Use → `hud-card-pick.spec.ts`). |
| `combat-attack.spec.ts` | Deleted | `hud-attack-pick.spec.ts` (weapon tiles, Minion), `hud-pick.spec.ts` "a player picks…" (bands, rings, single select) and "live: an out-of-range pick waits…", `hud-result.spec.ts`, `hud-queue.spec.ts` (Resolutions + Undo, Allow), `hud-phone.spec.ts` (tabs at 390); server: `tests/convex/combat-attack.test.ts`. |
| `lane4-forced-attack.spec.ts` | Deleted | `hud-attack-pick.spec.ts` "a forced attack: the red prompt opens the panel with the target locked, and the attack answers it"; `tests/convex/lane4-e1b-attack.test.ts`. |
| `sheet-drawer.spec.ts` | Deleted | `hud-sheet.spec.ts` (both tests: open from token / banner, GM edit, Play-for, Esc), `hud-phone.spec.ts` "the player at 390…" (full-screen sheet, 44 px close, axe), `hud/sheet-panel.test.tsx` "Esc closes it and focus goes back to the opener". No "Full sheet" link in the HUD sheet (QUESTIONS 3). |
| `visual/SD-SD6.spec.ts` | Deleted | `visual/HUD-H2.1.spec.ts`, `visual/HUD-H7.1.spec.ts`, `visual/HUD-H7.2.spec.ts`. |
| `visual/CA-CA5.spec.ts` | Deleted | `visual/HUD-H3.0.spec.ts` (panel, rings, waiting), `visual/HUD-H4.1.spec.ts` (result), `visual/HUD-H5.1.spec.ts` (queue, Resolutions), `visual/HUD-H7.2.spec.ts`; the 390 no-scroll check → `combat-actions-a11y.spec.ts`. |
| `visual/CA-CA6.spec.ts` | Deleted | `visual/HUD-H2.3.spec.ts` (hand states incl. used, GM lock, vault), `visual/HUD-H3.0.spec.ts`, `visual/HUD-H4.1.spec.ts`; the 390 no-scroll check → `a11y-combat-hand.spec.ts`. |
| `hud-shell.spec.ts` (added to owns) | Rewritten | No switch: GM and player always get the HUD (also with `?hud=0` / a stale stored value); Map tools; Edit keeps the column; player drawer holds "Your view". |

## Checks

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: clean (on rebuild aa428a95 plus this tracer).
- vitest: 482 files, 10594 passed + 1 expected fail (an earlier full run under machine load 20+ had 7 Convex tests time out at 15 s; the 7 files
  rerun 185 / 185).
- e2e (ports 3621 / 3721, servers by hand, `E2E_REUSE_SERVERS=1`; the host sat at load 15-25 most of the day while other
  worktrees ran, see dcm-uh6r):
  - Last full run (`--workers=2`, after merging rebuild aa428a95 with the Convex load-cost fix): 354 passed, 36 failed,
    1 skipped (the `test.fixme`), 7 did not run. Of the 36: 11 are H8.2's specs (`adversary-actions-a11y` × 2,
    `adversary-actions-flow`, `combat-adversary` × 2, `combat-end-scene`, `combat-map-flow` × 2, `lane4-cloak-prompt`,
    `lane4-fire-ask` × 2 = 11 tests); the rest were load only (sign-in stuck on /signin, "Function execution timed out
    (maximum duration: 1s)", "The campaigns failed to load", 30 s test timeouts) or fixed after the run.
  - Reruns of every failed non-H8.2 spec with `--workers=1` after the last fixes and a fresh build: all pass (the last
    two reruns: 71 / 75 then 29 / 29 + 1 skipped; the four that failed in the first one, `combat-cards` (Convex 1 s
    timeout), `combat-maps` (sign-in timeout) and `death` × 2 (30 s test timeouts, no combat map), passed in the
    second). Every spec this tracer changed passed in its last run.

## Out-of-owns edits

Added to H8.1's owns by the orchestrator during the tracer (rebuild 7ec82336, 18810185, c2e3226e):
`hud/index.tsx`, `hud/token/hooks.ts`, `tests/unit/hud/h0-state.test.tsx`, `tests/e2e/hud-shell.spec.ts` (the switch), and
14 specs the cut-over broke outside the classic list, fixed by selector only: `a11y-play`, `combat-light-uploaded`,
`combat-map-edit`, `combat-map-generate`, `combat-maps`, `combat-movement`, `encounter-actions`, `hud-card-pick`,
`hud-pick`, `session-encounter`, `sessions-flow`, `sprite-edit`, `sprite-packs-flow`, `sprite-style`. Patterns: the GM's
column only where it lives only there (maps, Play / Edit, combatants, token card, Reveal, Vision, style, packs) through
the new `openMapTools(page)` helper (`tests/e2e/hud/helpers.ts`); HUD token names ("Open Ash’s sheet (your character)",
"Open the Bear’s stat block"); "Something blocks the way."; `hud-pick` / `hud-card-pick` read the GM's HUD queue
(`hud-queue-range`) instead of the classic list.

Left for H8.2 (its owns; broken by the cut-over): `adversary-actions-a11y`, `adversary-actions-flow` (the player's map
"Incoming hit" region is the HUD hit window now), `combat-adversary` (GM token names), `combat-end-scene`,
`lane4-cloak-prompt`, `lane4-fire-ask` (classic Resolutions / asks, now only in the drawer), `combat-map-flow` (Map
tools drawer after the first map).

## QUESTIONS (sensible defaults taken)

1. **Class controls outside the HUD sheet.** The classic drawer's Flying (Q16), Beastform "Drop out" (Q10), stances
   (Q5) and class counters have no HUD equivalent; default: `SheetExtras` in the tools drawer (player: own PC; GM: the
   selected PC token, greyed until Play-for). Move them into the HUD sheet? Bead dcm-bxp.99.32.43.
2. **DA7 "Active" banner** (a feature whose effect still holds) and the **"Full sheet" link** are not in the HUD sheet
   (it shows "Used · back …" on the spent use). Same bead.
3. **The GM's spotlight panel (top middle) covers** the map's own toolbar (Zoom / Fit / Names / Areas) at 1440 × 900,
   the "Player view" menu, and mid-map tokens at 1280 × 720 (specs select by keyboard or use 1440 × 900). Bead
   dcm-bxp.99.32.42.
4. **HUD hand on tablets:** side buttons 28 px, the 768 × 1024 map hint covers them, phone tabs 40 px high (classic
   kept 44 px). `a11y-combat-hand.spec.ts` keeps it as a `test.fixme`. Bead dcm-bxp.99.32.41.
5. **The first map keeps the GM in Edit** (new): before, a GM's first "New map" went to the Play layout; with the HUD
   that would close the column mid-task. Default taken; say if Play should win.
6. **Query errors stay up:** a HUD part whose query timed out shows "failed to load … Try again" until pressed, so a
   finished result can stay hidden (seen under dcm-uh6r load). Retry by itself, as `HitBoundary` does?
