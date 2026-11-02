# TASK-HUD-H3.4: the action ring around your own token

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 4 batch C, tracer H3.4 (board Main 'Picking a target' /
'Can't afford', `.rad`). Briefs: `.omc/plans/combat-hud-briefs.md` "Wave 4" and answer 3b. Depends on H3.0 (pick
session), H3.1 (hand Use → card picker), H3.2 (`useAttackPicker`), H3.3 (`useFeatureUse`). Parent bead dcm-bxp.99.32.
Mode: add; renders only inside the HUD shell (switch on, Play, players).

## What landed

All in `src/components/combat-map/hud/action-ring/`:

| File | What |
|---|---|
| `model.ts` | Pure: `ringUses` (the sheet panel's Use buttons, action uses only, one per use), lock reasons (`featureLock`: "Evolution is used. Back after a long rest." / "Evolution needs 3 Hope. You have 1."; `attackLock` from the picker's reason; `castLock` "No cards in your loadout."), `ringItems` (Attack, Cast, Sheet, then features), the geometry (`ringRadius`, `ringStep`, `ringSlots`, `ringPoint`, `clearsArcs`), the overflow (`splitRing`, `moreItem`) and arrow keys (`stepFocus`). |
| `store.ts` | Which token's ring is open: a module store (`useSyncExternalStore`, like `pick-area/store.ts`): `toggleActionRing(tokenId, focus)`, `openActionRing`, `closeActionRing`, `useActionRing`. Changed only from event handlers. |
| `index.tsx` | `HudActionRing` (the H0 stub's export, already mounted by the shell as a map layer in its own PartBoundary). |
| `hand.ts` | `raiseHand()`: Cast's "raise the hand" through the hand's DOM hooks (see below). |
| `action-ring.css` | Board `.rad` / `.rad.on` / `.rad.off` / `.rad-tip` on the `--hud-*` tokens, the More list, the classic flow pop-up; the open animation stops under `prefers-reduced-motion`. |

### Behaviour

- **Opens** on a click (or Enter / Space) on your own token (player, HUD on, Play). From the keyboard, focus moves to
  Attack; a mouse open leaves focus on the token so its arrow-key moves keep working. The token carries
  `aria-expanded`. The GM's clicks are unchanged (sheets / stat blocks).
- **Buttons** (answer 3b), from the left over the top, as on the board: **Attack** → `useAttackPicker(state).open()`
  (H3.2; on again cancels it); **Cast** → raises the hand; **Sheet** → `toggleSheet({ kind: "pc" })` (lit while your
  sheet shows); **each feature with a Use button** (`mapUses`, action uses) → `useFeatureUse(...).open({ featureId,
  useId })` (H3.3); `"classic"` (Warden's Protection, Charge) shows the classic `FeatureUse` in a pop-up beside the ring,
  as the sheet panel shows it in the panel.
- **Lit** (`.on`, `aria-pressed`) while its picker runs: Attack's session, a card session (`card:<character>:…`, the
  board's Cast `.on` in 'Picking a target'), a feature's session or classic flow, the sheet.
- **Locked** (`.off`, `aria-disabled`, still focusable): the lock icon, the reason as the accessible description and
  as the board's `.rad-tip` beside the button on hover, focus or a tap. Reasons: a used feature (`ready` false, with its
  reset label), a fixed Hope cost above your Hope, Attack's picker reason ("No weapon equipped"), Cast with an empty
  loadout. Stress / Armor costs are not locked: Stress past full marks a Hit Point (CB p.106, `applyStep` in
  sheet/model.ts), so it is payable; the server refuses anything else with its own reason.
- **Overflow: "More"** (decided over a second ring). The arc runs from 180° (left) to −20° (just below the right), so at
  the board's radius it holds 6 buttons; with more, the 6th slot is "More actions (n)", a list beside the ring with each
  remaining button (a locked one with its reason under its name). A second ring would sit twice as far out, over the
  neighbouring tokens on a busy map, and its labels would collide with the first ring's.
- **Stays** open while a picker it started runs (as the board shows the ring with the picking panel), so a cancel gives
  focus back to its button; it hides during square picking (the crosshair needs the map) and returns after.
- **Closes**: Esc (after the picker's own Esc: an open pick session or square pick takes it first; then the More list,
  then the classic flow, then the ring; focus goes back to your token), a click on your token, or a press on the bare
  map (not on a token, the ring or a HUD panel; never while a picker runs).
- **Keys**: arrows / Home / End go round the ring (handled with `preventDefault`, so the token layer's arrow-key move
  does not fire).
- **Geometry** (stage px around the token's centre, like H3.0's target rings): radius `max(size/2 + 72, 0.57·size + 30)`
  = the board's 96 for a 48 px token; 38° apart (a 62 px chord). The token's arcs reach 0.566 of its footprint
  (token.css: svg 1.12 × footprint, r 46 of 50 + a 9-unit stroke), so every button edge stays outside them at any size
  (unit-tested for 24-400 px; e2e-measured at 1440 × 900 and again while the map makes room).
- **Pointer maths while shifted (H2.2)**: none of its own. The ring is a map layer, so the make-room transform moves and
  scales it with the token; its buttons are DOM buttons. Presses inside stop at the ring (`stopPropagation`) so the map
  neither pans nor drops the selection. e2e: centre within 2 px of the token while the sheet is open, Attack still opens.

### Cast: "raises the hand"

The HUD hand hangs below the screen's edge and raises a card while it has focus (`hand.css .hud-hc:focus-within`);
"Hide cards" folds it. Cast presses the hand's own "Show cards" when it is folded, then focuses the first card whose Use
is enabled (else the first card): the card lifts and Tab walks the fan; its Use opens H3.1's card picker. `hud/hand/**`
was another tracer's file while this ran, so `hand.ts` reaches it through the DOM hooks it already ships
(`[data-testid=hud-hand][data-mode=own]`, `data-folded`, `hud-hand-hide`, `hud-hand-card`, `button.cmh-use`). Bead
**dcm-bxp.99.32.20**: export a `raiseHand()` from hud/hand and drop `action-ring/hand.ts`.

## Board states matched

- Main 'Picking a target': Attack, Cast (lit while the card's panel is open), Sheet, Evolution locked, around the gold
  token at radius 96, labels under the buttons. Matched (positions within 4-6 px of the board's at 48 px; the app's
  token size follows the map's zoom).
- Main 'Can't afford': the locked Evolution with "Evolution needs 3 Hope. You have 1." beside it (`.rad-tip`); here the
  tip shows on hover / focus / tap of the locked button (several locked features would otherwise stack tips).
- No visual-shot spec this tracer (time): `tests/e2e/hud-action-ring.spec.ts` covers the states with axe. Follow-up:
  `visual/HUD-H3.4.spec.ts` can reuse its setup (open the ring, hover Evolution).

Deviations: the board shows the ring only in its 'pick' / 'blocked' states; here it is open until you close it (a picker
it started keeps it). The board's button names are the bare labels ("Evolution"); here a feature's is "Use Evolution"
(contains the visible label, WCAG 2.5.3; matches the sheet panel's "Use …").

## What moved out of the old column

Nothing removed (mode add). The ring is the HUD's entry for the weapon attack (H3.2), cards (H3.1, via the hand) and
feature uses (H3.3) from your token.

## Tests

- `tests/unit/hud/action-ring.test.tsx` (19): model (board geometry, never over the arcs for 24-400 px in every slot,
  ring uses incl. reactions / out-of-combat / manual excluded and multi-use, lock texts, item order and names, More
  split, arrow keys); ring (opens from the token, toolbar name, centred on the token, buttons and order, locked
  Evolution's description; Attack opens / locked Attack shows why; Sheet toggles and is lit; feature → picker, classic
  flow beside the ring and closing it, locked feature shows its reason only; enough Hope unlocks, used feature's text;
  Cast focuses the first playable card's Use; raiseHand unfolds a folded hand / no hand; Cast locked without cards;
  keyboard open → Attack focused, arrows, Esc → token focused; token click / bare map close, press inside does not;
  More with 9 buttons → list, Esc closes the list first; GM and another token's id get nothing).
- `tests/e2e/hud-action-ring.spec.ts` (2): player (Moss at 1 Hope): token click opens the ring (not the sheet),
  `aria-expanded`, Attack / Cast / Sheet order, every button clear of the arcs (measured), Evolution locked with the
  board's reason (tip on hover, or under More), Beastform usable, axe; Attack opens H3.2's panel (weapon tiles, lit),
  Esc ends it and the ring stays; Cast focuses a card; Beastform opens H3.3's flow; Sheet opens the sheet, the map makes
  room and the ring stays centred on the token and clear of the arcs, Attack still works; arrows; Esc closes, focus on
  the token; Enter reopens with focus on Attack; bare map closes. GM: a click on Moss still opens the sheet, no ring.

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean. tracer-guard: OK (plus the `tokens-layer.tsx` edit below).
- vitest focused: `tests/unit/hud` 15 files, 206 passed (19 new). Full suite (`--maxWorkers=2 --testTimeout=120000`):
  460 files, 10354 passed + 1 expected fail.
- e2e (ports 3190 / 3492): `hud-action-ring.spec.ts` 2 / 2; all `tests/e2e/hud-*.spec.ts` 21 / 21. (First runs: the
  ring's zero-size anchor reads as hidden to Playwright, and the features arrive after the sheet loads; the spec now
  checks the buttons and waits for the features.)

## Out-of-owns edits

- `src/components/combat-map/tokens/tokens-layer.tsx` (H1.3's click handler; 6 lines): import `toggleActionRing` /
  `useActionRing` from `hud/action-ring/store` (the store only, so the classic layer pulls in no ring UI); in `openSheet`
  a player's own token toggles the ring instead of the sheet (`role === "player" && token.mine`), the keyboard path
  passes `keyboard = true`; the HUD face's own token gets `aria-expanded`. Classic (switch off) unchanged: `openSheet`
  returns at once without the HUD.

## Merge-time actions (orchestrator)

Delete the two interim attack buttons now that the ring's Attack opens H3.2's picker:

1. **H3.0's interim Attack (dcm-bxp.99.32.18)**: in `src/components/combat-map/hud/pick/attack.tsx` delete
   `PickLauncher` and `Launcher` (keep `plainAttackSession` / `PlainAttack`: the unit tests and H3.2 use them; drop the
   imports only they used); in `hud/pick/index.tsx` remove `import { PickLauncher } from "./attack";` and
   `<PickLauncher state={state} />` from `HudPick`, and "and the interim Attack button" from its comment; in
   `hud/pick/pick.css` delete the `.hud-pk-launch*` rules. Tests that drive it: `tests/e2e/hud-pick.spec.ts` (line 27
   `getByTestId("hud-pick-attack")`, line 87 focus back to it) and `tests/e2e/visual/HUD-H3.0.spec.ts` (line 32): open
   the ring instead (`board.getByRole("button", { name: /^Open Moss’s sheet \(your character\)/ }).click()`, then
   `getByRole("toolbar", { name: "Your actions (Moss)" }).getByRole("button", { name: "Attack" })`); focus goes back
   to that ring button on Esc. `tests/unit/hud/pick-panel.test.tsx`: delete the `describe("the interim Attack button")`
   block (from line 347; keep its out-of-range → pending check by opening `plainAttackSession` directly if wanted) and
   the `hud-pick-attack` absence line 343.
2. **H3.2's interim "Weapon attack"**: in `src/components/combat-map/hud/pick-attack/prompts.tsx` delete the
   `<button … data-testid="hud-attack-open" …>Weapon attack</button>` inside `.hud-atk-launch` (keep the
   `.hud-atk-res` result line and its wrapper until H4.1), and "the interim 'Weapon attack' button" from the header
   comment. Tests: `tests/e2e/hud-attack-pick.spec.ts` line 65 (`getByTestId("hud-attack-open")`) → open the ring and
   press Attack as above; `tests/unit/hud/attack-pick.test.tsx` lines 263, 290, 302, 341 (`fireEvent.click(
   getByTestId("hud-attack-open"))`) → render a small test button calling `useAttackPicker(state).open()` (or
   `HudActionRing` with `openActionRing(MOSS)`), and line 394's "GM gets nothing" keeps checking the absence.
- **Done (hud-clean-w4, 2026-11-02):** items 1 and 2 above; the tests now open the picker through the ring's Attack
  (e2e) or `useAttackPicker(state).open()` / `plainAttackSession` (unit). Nothing lost: `.hud-atk-res` shows Hit /
  Miss / Defeated (by name, with damage) and the held-roll note the interim line showed. H3.2's taller panel beside
  the Lieutenant partly covers the map toolbar's Zoom out (axe target-size): `hud-pick.spec.ts` excludes that button
  with a reason until dcm-bxp.99.32.22 fixes it.
- Accept the `tokens-layer.tsx` edit above. No Convex, schema, authz or codegen change.
- Close dcm-bxp.99.32.18 once item 1 is done.

## Beads

- Filed **dcm-bxp.99.32.20** (raiseHand export from hud/hand), **dcm-bxp.99.32.21** (your own token's name still says
  "Open Moss’s sheet" though it opens the ring; renaming touches hud/token/model.ts, token-face.test.tsx and
  hud-tokens.spec.ts lines 126 / 153, so it was left out of this tracer).
- dcm-bxp.99.32.18: done on the ring side; the deletion is the orchestrator's (above).

## Data gaps

- `combatHud.sheet` gives a use's `ready` but not why it can't be paid; the ring computes the Hope shortfall from the
  SRD costs (`featurePlan(...).use.costs`), like H3.3's `hopeShortfall`. A server-side shortfall (dcm-bxp.99.32.2)
  would replace it.

## QUESTIONS (safest reversible defaults taken)

1. **Reactions on the ring?** "Every feature with a Use button": the sheet panel's reaction buttons read "React", and a
   reaction answers something (its prompt), so the ring shows action uses only. Reactions stay on the sheet and in their
   prompts. Say if they should join the ring.
2. **D5 out-of-combat uses** (Commune, Get In & Get Out: the sheet's `D5Use`) are not on the ring: they are not combat
   actions. Same question.
3. **When the ring closes.** Built: stays until Esc, your token or the bare map (a picker it started keeps it; it hides
   during square picking). The board only shows it while picking; alternative: close it as soon as a picker opens
   (focus would then go back to the token on cancel).
4. **Locked tip.** Shown on hover / focus / tap of the locked button (the board shows it always in 'Can't afford').
   With several locked features always-on tips would overlap; say if one should always show.
5. **Forced attack.** The ring's Attack opens a normal attack; a forced attack keeps its red prompt card (H3.2). Should
   Attack answer the oldest forced attack instead while one waits?
