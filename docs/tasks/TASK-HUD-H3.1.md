# TASK-HUD-H3.1: playing a card through the picking panel

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 4 batch B, tracer H3.1 (boards CmpPicking, Main, CmpCards).
Depends on H3.0 (pick-session API). Parent bead dcm-bxp.99.32; fold-in **dcm-p1r** (UI half: the vault swap row) is
built here (not closed: the orchestrator closes it). Mode: add; everything renders only inside the HUD shell (switch on, Play).

## What landed

New `src/components/combat-map/hud/pick-card/`:

| File | What |
|---|---|
| `model.ts` | Pure. The card's rule (`ruleOf`: the classic `targetAsk`, or a locked "Affects you" / "Every enemy within Close" / "Pick the square on the map next" over the actor's own row, `min` 0), `selfRows`, the use's optional add-ons as rider switches (`ridersOf`: "If it hits, also …" / "On a success, also …" from the gates on the way to the optional step, the fixed cost as the pill, the cost lead "Spend a Hope to" dropped when the pill says it, the runner's default-on kept), `riderOptions` (a rider whose steps act on `picked` rings its creature with its verb, "Restrain"), `payLine` (footer: up-front costs, then riders that are on, "if it hits" for gated ones, "Spends your last Hope"), `primaryLabel` ("Cast on Lieutenant", "Cast on A and B", "Cast on 3 targets", "Cast Vicious Entangle", "Use …" for an ability, "Place Mysterious Mist"), `blockedOf` (CmpBlocked layer 1: the classic `formProblem`, the GM's Difficulty, the vault card, up-front Hope "Needs 1 Hope · you have 0", the roll options' Hope), `requestOf` (the `combatCards.useCard` request: classic `choicesOf` / `rollOf`, riders as `optional:<id>`, `triggerDamageType`, `swapWith`). |
| `session.tsx` | `cardSession(env)` / `cardPatch(env, data)`: the H3.0 `PickSessionSpec` for one card (id `card:<characterId>:<cardId>`, source with `cardId` → the header's art through next/image, the map's enemy pick kept, `actor` for the GM's Play-for). A new spell or answer goes through `update(cardPatch(...))`, so rule, rows, riders, footer and primary follow the picked use. |
| `rows.tsx` | `CardRows`, the panel's `extra`: every choice the classic Use dialog asks, as H0 `ChoiceRow` / `Stepper` rows: grimoire **Spell**, numbers (listed values or a stepper: a number of Hope), **Pay with**, **Confirm** (situations), choose-before-roll (with Twin Fang's `distinctFrom`), the creatures a step names (a rider's own pick shows only while it is on: "Restrain: pick who"), **Weapon**, **Trait**, **Swap in from the vault** (dcm-p1r, the vault cards at or under the character's level), **Your ally’s damage was** (Encore), the GM's **Difficulty** (players: a note), and "Rolls with Advantage +1" from the Hand's roll options. No `extra` when the use asks none of these. |
| `use-play.ts` | `useCardPlay`: `combatCards.useCard` with a fresh idempotency key per click; `send` lets a refusal throw (the panel shows it under the primary, layer 2), `trySend` keeps it as `error` (paths without a panel); `waiting` / `answer` for a `needsChoice`. |
| `points.ts` | The **point-picker seam** (`PointPicker`, `classicPointPicker`): an area card asks the map for its square (two for a wall) through the classic banner (`map-view/area-pick.tsx`), as the classic hand did. |
| `pick-card.css`, `index.ts` | Row styles on the `--hud-*` tokens; the public exports. |

`src/components/combat-map/hud/hand/body.tsx` (H2.3's, in owns): Use now
- opens the card's pick session (`usePick().open(cardSession(...))`) whenever the classic `needsDialog` says the use
  asks anything (with `pickedEnemies: 0`: a target is always confirmed in the panel); the card is raised and tagged
  "Casting · pick a target" while its session is open (derived from `usePick().session`, no extra state; Esc / ✕ /
  another Use lowers it);
- fires at once when the use asks nothing at all (no target, no choice; user answer 2026-10-23), or goes straight to
  the point picker for an area that asks nothing else;
- the primary: an area use hands off to the point picker (the session ends, the card stays "playing" while the banner
  waits); otherwise it sends; `resolved` → the classic `CardResult` above the fan (until H4.1), roll options cleared
  if used; `pending` → `{ kind: "pending", requestId }` (H3.0's "Waiting for the GM" with Withdraw; the GM, who has no
  waiting card, keeps the classic pending line); `needsChoice` → the session ends and the classic `AfterRollDialog`
  asks (chain links / splits in the HUD are H3.3's and a later wave's);
- changing Roll options while a card's panel is open updates its footer / blocked reason / request (`pick.update`).
- The classic `UseDialog` is no longer used by the HUD hand (the classic page still uses it).

## Board states matched

- CmpPicking 'One target · a card' / Main 'Picking a target': header art + "Vicious Entangle" + "Pick 1 target within
  Far"; rows picked / in / out "GM approves" / walled Bandit not listed; rider "If it hits, also Restrain another
  adversary within Very Close range of your target" with the ★1 pill; while on, "Restrain: pick who" and the picked
  Bandit's ring carries "Restrain" (`.hud-tg-rl`); footer "Spends your last Hope if it hits" (Moss at 1 Hope) or
  "Spends 1 Hope if it hits"; primary "Cast on <Lieutenant>".
- CmpCards 'Playing': the raised card with "Casting · pick a target" and the gold glow while its panel is open.
- Deviations: the rider label is the card's own add-on text (the effect table's label minus its cost lead), not the
  board's shortened "Restrain the Bandit"; the footer adds "if it hits" for a hit-gated cost (the board's line has no
  gate). No visual shot spec: `tests/e2e/visual/HUD-H3.1.spec.ts` is not in H3.1's owns (see Merge-time actions).

## What moved out of the old column

With the HUD on, the classic Use dialog (`actions/hand/dialog.tsx` `UseDialog`) is replaced by the panel for the HUD
hand. The classic page (switch off) is unchanged.

## Out-of-owns edits (minimal, forced)

- `src/components/combat-map/actions/hand/dialog.tsx`: `export` added to `listedValues`, `withListedNumbers` and
  `distinctFromOf` (3 words), so the panel reuses the dialog's card logic instead of copying it. No behaviour change.
- `tests/unit/hud/hand-states.test.tsx` (H2.3's): `renderHand` wraps the hand in `HudProvider` + `PickProvider` (the
  hand now calls `usePick()`), and the "Use runs the classic flow" case became "Use opens the card's pick session"
  (session id, the Playing tag, another Use replaces it). Every other case is unchanged.
- `tests/e2e/hud-hand.spec.ts` (H2.3's): the Use step expects the picking panel (`hud-pick`) instead of the classic
  dialog; the header comment says so. Same assertions otherwise.

## Tests

- `tests/unit/hud/card-pick.test.tsx` (11): riders ("If it hits", pill, the rider's ring label once its creature is
  picked), the footer (none, "if it hits", last Hope, up-front Hope, Stress), the primary's names, the no-target rule
  and self row, blocked reasons (up-front Hope, roll options, vault), the request (rider as optional, its pick, roll
  options, `swapWith`, `triggerDamageType`); rendered with the panel: Use raises the card and opens the panel with the
  map's pick and art, rider on → its pick → footer → Cast sends once with the right args, pending closes and lowers;
  a refusal stays under the primary, Esc cancels and lowers; a grimoire's spells switch rule, primary and footer;
  the vault swap row (level filter, blocked until picked, `swapWith` sent); a card that asks nothing fires at once.
- `tests/e2e/hud-card-pick.spec.ts` (2): the player casts Vicious Entangle (Playing tag, focus to the title, rule,
  art, rows / reach, primary, rider with pill and its pick and ring label, footer, axe, resolved → result above the
  fan, Esc on another card); live: an out-of-range cast shows "Waiting for the GM · Vicious Entangle · out of range" for
  the player and in the GM's classic card sanctions; Withdraw removes both.

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest focused: `tests/unit/hud` 12 files, 152 passed (11 new). Full suite (`--maxWorkers=2 --testTimeout=120000`):
  457 files, 10300 passed + 1 expected fail.
- e2e (ports 3127 / 3366, servers started by hand, `E2E_REUSE_SERVERS=1`): `hud-card-pick.spec.ts` 2 / 2; all
  `tests/e2e/hud-*.spec.ts` 16 / 16. The first run failed every sign-in: `pnpm e2e:setup` had been run without the
  worktree's ports; rerunning it with `E2E_PORT` / `E2E_CONVEX_PORT` fixed it.

## Known gap

The creatures a rider names ("Restrain: pick who") are not greyed when out of the rider's own range (Very Close of the
target): the classic dialog didn't either. The server sends such a use to the GM ("Waiting for the GM: The target is
Close"), so nothing wrong happens, but the panel's footer doesn't warn first. A follow-up can mark those rows with the
Hand model's `outOfRange` using the step's `pick` spec (area `aroundTarget`, `areaRange`) anchored on the first target.

## Beads

None filed. dcm-p1r's UI half (vault swap row) is built here; close it with this merge.

## Merge-time actions

- **Point picker (H3.3):** `HudHandBody` takes `pointPicker?: PointPicker` (default `classicPointPicker`, the classic
  banner). `PointPicker = ({ mapId, cardName, area: AreaPick, send(squares) }) => void`: start a pick for `area.squares`
  squares (1, or 2 for a wall) with `area.radius` / `area.placeWithin`, then call `send(squares)` (it resolves to the
  line to show, and throws the server's refusal). Once H3.3's `hud/pick-area` is merged, either pass its picker from
  `hud/hand/index.tsx` (`<HudHandBody pointPicker={...}>`) or change the default in `hud/hand/body.tsx`; nothing else
  changes. If H3.3's picker is promise-shaped (`pick(area) => Promise<Square[] | null>`), wrap it:
  `({ area, send }) => void pickArea(area).then((sq) => sq && send(sq))`.
- **Visual shots:** add `tests/e2e/visual/HUD-H3.1.spec.ts` to a later tracer's owns (or H3.1's at merge) if the
  board-match shots are wanted for this state; H3.0's `HUD-H3.0.spec.ts` already shoots the card panel's layout
  with its sample session.
- Accept the three out-of-owns edits above. No Convex change, no codegen, no schema, no authz entry.

## QUESTIONS (safest reversible defaults taken)

1. **A one-enemy card with an enemy already picked on the map:** the classic hand fired it at once (user answer
   2026-10-23: "a rolling card with an enemy picked and nothing else to ask fires at once"); the boards (Main
   'Picking a target') show the panel with the picked Lieutenant and "Cast on Lieutenant". Default: the panel opens
   pre-picked (one more click, and the rider / footer are seen). A card that asks nothing at all still fires at once.
2. **Footer for an on-hit cost:** "Spends your last Hope if it hits" (the board's line has no gate). The Hope a rider
   spends after the roll is not blocked client-side, because the roll's own Hope may pay it — CB p.90: "When using a
   Hope Feature, if you rolled with Hope for that action, the Hope you gain from that roll can be spent on that feature".
   Up-front Hope is blocked ("Needs 1 Hope · you have 0").
3. **Verb:** "Cast" for spells and grimoires, "Use" for abilities ("Use Codex-Touched: swap from the vault"). Confirm
   the wording for abilities.
4. **GM's Difficulty stepper** starts at 10 and must be touched once (blocked "Set the Difficulty" until then), as the
   classic dialog's empty field did.
