# TASK-HUD-H2.3: the HUD hand (card states around the unchanged face; vault, recall, roll options, full card, Hide cards)

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 3 batch A, tracer H2.3 (boards CmpCards, Main). Briefs:
`.omc/plans/combat-hud-briefs.md` (Common rules, Wave 3 / H2.3, user answer 16a). Depends on H0 (shell, `hand` region,
primitives, HudProvider). Bead: dcm-bxp.99.32.

## What landed

All in `src/components/combat-map/hud/hand/` (renders only with the HUD switch on, in H0's `hand` region):

- `index.tsx` `HudHand` (H0's export and props kept). Whose hand:
  - **player**: their own (`useActor`); while another PC's sheet is open (`useHud().sheet`), that PC's hand **view
    only**, or, when the GM's "Players can see each other's cards" is off or its player hid it, three card backs and
    why ("Vex keeps their hand hidden." / "The GM keeps every player's cards private."); the hand query is then never
    sent (F7-H4).
  - **GM**: the hand of the PC whose sheet is open, locked with "Turn on “Play for Moss”" until Play-for is on
    (`usePlayFor`, answer 5a; the switch itself is in the sheet header, H2.1, and in the classic drawer meanwhile).
    No sheet open: no hand.
- `body.tsx` `HudHandBody`: the fan, the side buttons and the panels, with the classic hand's writes
  (`useCardActions` → `combatCards.useCard`, `useRecall` → `characters.moveCard` with its optimistic update).
- `states.ts` (pure): `cardLook` gives each card its tag, wash and Use state in CmpCards' order of precedence; recall
  labels, the loadout-full label, the Hope shortfall (`hopeNeed`), Experience affordability, advantage text.
- `parts.tsx`: `FanCard` (tag + the app's face), `CardBacks`, `SidePop` (the non-modal popovers), `RollOptionsBody`,
  `FullCard`.
- `hand.css`: everything around the face; nothing in `actions/hand/face.tsx`, `hand.css` or `domains.css` changed.

### The card states (CmpCards "Card states in the hand"), around the face only

| Board | Built | Where it comes from |
|---|---|---|
| Ready, "3 tokens" | tag `limit`: the card's tokens, else its limit ("Once per rest"); Use on the face | `card.tokens`, effect `limit` |
| Playing, "Casting · pick a target" | tag `play`, card lifted 34 px with the gold glow (`is-play`) | Use dialog open, area pick running, after-roll choice waiting, use on its way |
| Can't afford, "Needs 1 Hope" | tag `no` with the lock icon, grey wash, Use disabled with "Needs 1 Hope · you have 0" | up-front fixed Hope costs of the first ready use vs the sheet's Hope (CmpBlocked layer 1) |
| Used, "Used · back after a rest" | tag `used`; the face greys and turns itself; no Use | `state: exhausted`, `resetLabel` |
| Locked (GM), "Turn on “Play for Moss”" | grey lock tag; the face's own `locked` grey; no Use, no Roll options, no Recall | `playFor.list` |
| Another player's card, "Brannoc's hand · view only" | tag `used`, full colour, no Use, no vault / side buttons | `combatCards.handSharing` |
| Hidden hand | three card backs + the reason | `handSharing` |
| Reaction, "Reaction · shows in the hit window" | tag `used`, no Use (also "Passive · always on", "Rider · added to an attack", "Automatic", "Out of combat") | `uses[].activation`, `state` |

The fan is `cards/fan.ts` (7° per step, used cards turned further), 160 px cards (Main `.handrow`), sunk 128 px below
the screen's edge; hover, a tap (the slot takes focus) or keyboard focus on More / Use raises the whole card.

### Beside the fan (Main `.fanside`)

- **Vault**: the classic `VaultDeck` (backs + count, "Open vault, N cards"). It opens a popover with the vault's cards
  (the app's face, 150 px) and per card "Recall · 1 Stress" in combat, "Recall · free" while resting or for a 0-cost
  card, disabled "Loadout full · 5 of 5" + "Send a card to the vault first" (`characters.moveCard`, `duringRest` from
  `rests.current`); the Perfect Recall riders as in the classic hand.
- **Roll options**: a popover (CmpCards "Roll options"): Experience chips with a ★1 Hope pill, greyed "Needs 1 Hope"
  once the Hope is spoken for; Advantage −3..+3; Help dice 0..3; "Applies to the next card that rolls." Set options
  light the button (gold) and are cleared after a card used them (F8-I1).
- **Hide cards** (answer 16a): folds the viewer's own fan into three backs; the button becomes "Show cards (N)". This
  browser only (localStorage, the classic hand's key `dh.combat.handHidden:<campaign>:<character>`, so both views
  agree), held for the visit when storage is blocked. No server call (unit test asserts none).
- Popovers close on ✕ or Escape and give focus back to their button; only one is open at a time.

### Full card view (More)

The face's own More is caught on the way down (capture phase) and opens the HUD's `FullCard` instead: a native modal
`<dialog>` over the map with the app's face at 300 px, **Use** and **Close** at its foot, and the whole text beside it
(the face clips its text). Escape / Close / backdrop close it; focus goes back to the More that opened it. The face's
own More is hidden inside the full view only. Vault cards open it too (Close only).

### Use until H3.1 (the classic use flow)

Use (on the card or in the full view) runs the classic hand's flow unchanged: a card that needs nothing more fires
`combatCards.useCard` at once with the last picked enemy and the roll options; otherwise the classic **Use dialog**
(`actions/hand/dialog.tsx` `UseDialog`) opens; an area card asks the map for its square through the classic pick
banner (`startAreaPick`); a choice after the roll opens the classic `AfterRollDialog`; the result shows as the classic
`CardResult` in a panel above the fan (✕ closes it). H3.1 replaces the dialog with the HUD casting panel by swapping
`play()` in `body.tsx`; the states (`playing`) already follow whatever is open. Drag-to-play stays the classic dock's
(not built in the HUD; Use is the single-pointer way, WCAG 2.5.7).

## Board states matched (shots: `E2E_VISUAL=1 E2E_PORT=… E2E_CONVEX_PORT=… pnpm exec playwright test tests/e2e/visual/HUD-H2.3.spec.ts`)

`test-results/visual/HUD-H2.3/`: `player-main-1440.png`, `player-hand-1440.png` (Main bottom band), `player-raised-1440.png`
(Ready, raised), `player-playing-1440.png` (Playing), `player-roll-options-1440.png`, `player-vault-1440.png`
(Recall · 1 Stress), `player-full-card-1440.png`, `player-folded-1440.png` (Hide cards), `player-view-only-1440.png`,
`player-hidden-1440.png`, `gm-locked-1440.png`, `player-main-1024.png`, `player-main-390.png`. Board renders to compare:
`reference/designs/combat-hud/preview/CmpCards.dc.html` (full page) and `Main.dc.html` at 1440 × 900.

Differences from the boards, on purpose:
- The face is the app's (`cmh-*`, a little taller than the board's 5:7 `hc-face`) and its footer (More / Use) always
  shows, as everywhere else in the app; the board hides `.hcf-acts` until hover. The fan sinks deeper (128 px vs 84 px)
  so the visible part matches.
- Help is the app's count of Help dice, not the board's per-ally "Brannoc's Help die (d6)" chips (the engine has no
  per-ally Help offer).
- Can't afford is client-computed for up-front Hope costs only (Stress / Armor / Fear shortfalls stay with H6.1 and
  dcm-bxp.99.32.2).
- The hand is centred in the shell's `hand` region (today left 330 px to right 24 px, centre ≈ 873 px at 1440); the
  board centres it around x = 1050 (`.bot` left 700, width 700). The region is H2.2's (shell.css); see Merge-time.
- Tablet / phone keep the desktop layout scaled down (128 / 104 px cards); H7.x builds the phone Hand tab.

## Tests

- `tests/unit/hud/hand-states.test.tsx` (19): every `cardLook` state; recall / loadout-full / Experience helpers; the
  rendered hand with Convex mocked: fan with the classic face and tags, Hide cards (no server call), Roll options
  (Hope greying, ±3 bounds, Esc returns focus), full card (More → one dialog, Close returns focus), Use (fires with the
  picked enemy and advantage; else the Use dialog with the playing tag), vault (moveCard args, free while resting,
  loadout full disabled), GM locked, view only, hidden hand, loading line.
- `tests/e2e/hud-hand.spec.ts` (1 test, two browsers, axe at four points): fan centred in the region, Hide / Show
  cards, Roll options, full card (Esc, focus back), Use → classic dialog with "Casting · pick a target", vault recall
  costs 1 Stress, GM locked → Play-for on unlocks, Brannoc's hand view only → hidden.
- `tests/e2e/visual/HUD-H2.3.spec.ts` (@visual): the shots above.

Results: `pnpm lint` clean; `pnpm typecheck` only the 28 pre-existing spotlight errors (see Merge-time); vitest focused
19/19; full suite (with the spotlight table composed locally) 10212 passed, 2 failed (`cleanup.test.ts` "covers every
campaign-scoped table", `schema-guard.test.ts` "retention decision": both only because of that local composition; on
the committed tree they pass, 61/61 with the hand test); `hud-hand.spec.ts` passed; `HUD-H2.3.spec.ts` passed
(E2E_VISUAL=1). Several e2e attempts failed in the shared fixtures (sign-in / join `toHaveURL` 5 s, seed mutations
over Convex's 1 s limit) while other tracers loaded the machine; a fresh local backend fixed it.

Layout notes from the shots: the fan sits in a 640 px box at the region's bottom with `overflow: clip`, so a raised
card or a popover stays inside it and focusing a sunk Use never scrolls the HUD root (an `overflow: hidden` scroll
container; the first build let Playwright's hover scroll the whole HUD). At 390 px the shell's `hand` region (left
330 px) is narrower than the hand, so the hand overflows to the right; the phone layout is H7.x's.

## Beads

None done or filed. No data gaps beyond the ones the briefs already name (structured shortfall dcm-bxp.99.32.2).

## QUESTIONS (defaults taken, all reversible)

1. Whose hand when a sheet is open: the hand follows the open PC sheet (player: another PC's sheet shows that hand view
   only; GM: the open PC's hand). Default built. Alternative: a separate "view hand" control on the sheet (H2.1).
2. Hide cards persists per browser (localStorage, shared with the classic hand) rather than only for the visit. Answer
   16a says local, no server call; both readings are local. Default: persisted.
3. The GM's Play-for switch is not repeated beside the hand (the lock tag tells the GM where it is: the sheet header,
   H2.1). Until H2.1 lands the GM turns it on in the classic drawer (Map tools) or the classic sheet drawer.

## Merge-time actions

- **rebuild does not type-check today**: `convex/schema.ts` does not compose `combatSpotlightTables` (H1.S's merge
  note says it should), so `pnpm typecheck` fails with 28 errors in `convex/combatSpotlight.ts`, `convex/lib/spotlight.ts`
  and `tests/convex/hud-spotlight.test.ts`, and `next build` (every e2e run) fails "Failed to type check". H2.3 ran
  its checks with that one composition line added locally, not committed (out of owns). The orchestrator should add
  `...combatSpotlightTables` to `schema.ts` (with it, `cleanup.test.ts` and `schema-guard.test.ts` need the table's
  purge step and retention decision, which H1.S's merge note also lists but which are not on rebuild either).
- H2.2 / shell: to match Main, the `hand` region should be `left: 700px; width: 700px` (centre x = 1050), `left: 330px`
  while a sheet is open; the hand centres in whatever box the region gives it.
- No Convex files, no codegen, no authz entries.
