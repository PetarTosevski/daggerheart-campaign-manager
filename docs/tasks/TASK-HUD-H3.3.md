# TASK-HUD-H3.3: feature uses, areas, walls and chains through the picking panel

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 4 batch B, tracer H3.3 (board CmpPicking 'Area · pick a
square', 'Wall · two points', 'Chain links'). Depends on H3.0 (pick-session API). Parent bead dcm-bxp.99.32; fold-in
**dcm-aiwg** (a feature's action roll offers its rider options: done here, close at merge). Mode: add; everything
renders only inside the HUD shell (switch on, Play).

## What landed

### `hud/pick-area/` (square picking: areas, walls, chain links)

| File | What |
|---|---|
| `model.ts` | Pure: `placeAt` (next point, then the nearest moves), `movePoint`, `startCursor` / `stepCursor` (keyboard), `wallLength`, banner / progress / summary texts, `placementProblem` (the server's own `placementHolds`, CmpBlocked layer 1), `confirmProblem`, `confirmLabel`, `previewRadius`, `linkBand`. |
| `store.ts` | One module store (like the classic `map-view/area-pick.tsx`; no provider): `startAreaPick(spec)`, `pickArea(spec) → Promise<Square[] \| null>`, `cancelAreaPick`, `placeSquare`, `movePointTo`, `setCursor`, `confirmAreaPick`, and the bar's result line `showPickLine` / `dismissPickLine`. Focus goes back to the opener on cancel. |
| `layer.tsx` | `HudAreaPickLayer` (map stage): crosshair on the hovered / keyboard square, radius preview (`.xh`), placed centres (numbered for several), a wall's line with two draggable handles (pointer capture), amber when outside `placeWithin`; and the chain overlay (`.chainl` dashed links actor → link 1 → link 2…, numbered `.node`s) during a pick session whose data carries `chain`. Every pointer position goes through `viewport.toSquares` (H2.2's `stageToSquares`: right while the map is shifted / scaled for an open sheet). |
| `bar.tsx` | `HudAreaPick` (pop region): the `.pickban` banner ("Pick the centre of **Dark Cloud** within Close", "Esc cancels" / "1 of 2 points"), the summary ("Radius: Close (6 squares)", "Length 6 squares · within Far", "Blocks sight"), cost line, Cancel and ONE confirm ("Place Dark Cloud here", "Raise Veil of Night"), the reason it is blocked, a refusal (`role="alert"`, mode stays open), then the result line. Keyboard: focus to the banner (a `role="group"`) on start; arrows move the crosshair from your square (window listener in the capture phase + `preventDefault`, so the token layer's arrow-key moves never see them), Enter places a point, Enter on a placed point (or with no cursor) confirms, Esc cancels from anywhere but a text field. |
| `chain.ts` | `chainOf(data)`, `chainRows(tokenIds, creatures, lastLink)` (the ask's creatures, bands from the last link), `chainAnswer(link, picked)` (`chain:<link>`; an empty list stops the chain, convex/lib/cardRunner.ts). |
| `area-pick.css` | Board values on the `--hud-*` tokens; the feature picker's chips. |

### `hud/pick-feature/` (a feature's Use)

| File | What |
|---|---|
| `model.ts` | `featurePlan` (classic / area / panel), `areaAskOf`, cost line (`payLine`: "Marks 1 Stress", "Spends your last Hope") and `hopeShortfall`, `ruleOf` / `noPickText`, **dcm-aiwg** `featureRiderOptions` + `featureRiderPhase` (mirror of the server's `riderOptions` / `riderPhase` for a feature host, see below), `riderPill` / `riderLabel` / `riderNote`, `resultLine` (Hit / Miss / Defeated by name, own roll total, never an adversary number), `askText`. |
| `index.tsx` | `useFeatureUse({ campaignId, role, map, characterId }).open({ featureId, useId, name? })` → `"picker" \| "area" \| "classic"`; `featureOptions`, `featureChoices`, `featureBlocked`, `riderPicksOf`. |
| `rows.tsx` | The panel's extra rows: trait chips (Fangs), weapon, numbers (Stepper), cost options ("Pay with"), choices before the roll, allies it affects, the GM's Difficulty; after the roll the server's asks (a choice, a damage split). |

What `open` does:
- **classic**: Warden's Protection (rolled count) and Charge (square + GM Difficulty) keep the classic `FeatureUse`; also
  no live map or no token to act from. The caller shows the classic flow.
- **picker**: the H3.0 panel. Rule from the use's targets (`formFor` / `targetAsk`), else one locked "You" row with
  "On yourself" / "Every enemy within Close". Switches: riders on the action roll (dcm-aiwg, cost pill, disabled while
  used), optional parts, situations to confirm (the primary waits: "Confirm: …"). Footer: the cost line; Hope short →
  "Needs 3 Hope · you have 1". Primary "Use Fangs on Lieutenant" → `combatFeatures.useFeature` with targets, choices
  (`choicesOf`), roll (trait; GM Difficulty), riders (`ridersToSend`). `pending` → "Waiting for the GM" (H3.0).
  `needsChoice` → the next panel answers the server's asks; a chain's link (`followUp`) lists the ask's creatures,
  draws the numbered links on the map, primary "Next link" / "Stop here" (CmpPicking 'Chain links'); answers
  accumulate and the use is re-sent (the server kept its dice). Resolved → the result line in the bar.
- **area**: Dark Cloud (and a `point`-side use with a point area: Circle of Power) → square picking. When the use asks
  nothing else it goes straight to the map; with riders / options the panel comes first ("Then pick a square on the
  map", primary "Pick the square"). The confirm sends `point` / `points` (`areaUseArgs`), the line is `areaUseLine`'s.
  A `point`-side use without an area (Shadow Stepper's teleport, a move prompt) picks no square.

### dcm-aiwg (rider options on a feature's roll)

`combatFeatures.useFeature` takes `riders` (E1.3a), but only `combatActions.riders` lists options, for a weapon. The
picker mirrors `riderOptions` / `riderPhase` for the feature host (`rollHost` with `fromUse` = the feature), from what
the client already subscribes to: `combatFeatures.drawer` (held features, per-use `ready`) and `combatCards.hand`
(loadout). Before / after phases only (damage-phase riders are prompts, DA2), default-on riders left to the server.
Gaps vs the server: no `applyUpgrades`, no weapon range (a feature roll names none), no MAP_SITUATIONS filter. The server
re-checks every rider (`pickRiders`). Fangs offers "Feed: Fear Die a d20"; Feed's own token rider waits for the damage.
Bead **dcm-bxp.99.32.19** (lane:w1-e1-triggers-rolls): a `combatFeatures.riders` query to replace the mirror.

## Entry points (for the orchestrator / H3.1 / H3.4)

```ts
// Squares (H3.1's cards that need a point / points; from a click handler; end an open pick session first):
import { startAreaPick, pickArea, showPickLine } from "../pick-area";
startAreaPick({ id, mapId, name, label, shape: "circle" | "wall", count, radius?, within?, blocksSight?, origin?,
                confirm?, pay?, send: async (squares) => ({ kind: "done", line } | { kind: "pending" } | { kind: "stay", message }),
                onCancel? });
const squares = await pickArea({ ...same without send });          // Square[] | null
// H3.1 card picker: build the ask with areaAskOf(name, areaSpec, picks, actorFootprint, n) (hud/pick-feature/model.ts)
// from the hand model's areaPickOf / drawer/use/model.ts pickAreaOf; send point = squares[0], points = squares.slice(1).
// Chains for cards: on needsChoice with a followUp ask, open a pick session with rows = chainRows(...), data
// { chain: { links } } and answer chainAnswer(link, picked) (see pick-feature/index.tsx openAsks).

// Features (sheet panel H2.1: wired; H3.4's action ring):
const featureUse = useFeatureUse({ campaignId, role, map, characterId });
if (featureUse.open({ featureId, useId }) === "classic") showClassicFeatureUse();
```

## Out-of-owns edits (minimal)

- `src/components/combat-map/hud/shell.tsx`: mounts `HudAreaPickLayer` on the map (beside `HudPickLayer`) and
  `HudAreaPick` in the pop region, each in its own PartBoundary (import + 6 lines). Every picker region shares them.
- `src/components/combat-map/hud/sheet/panel.tsx`: Use calls `useFeatureUse({ ..., canUse: rights.use }).open(...)`;
  only `"classic"` keeps the classic `FeatureUse` in the panel (import + 3 lines).
- `tests/unit/hud/sheet-panel.test.tsx`: one `vi.mock` of `hud/pick-feature` answering `"classic"`, so its "Use opens
  the classic flow" checks stay as they were (the panel test renders without PickProvider).

## Board states matched

- CmpPicking 'Area · pick a square': crosshair, square highlight, radius preview, banner "Pick the centre of **Dark
  Cloud** within Close · Esc cancels", "Radius: Close (6 squares)" + "Blocks sight", "Place Dark Cloud here".
- 'Wall · two points': first / second point prompts, "2 of 2 points", wall line, two draggable handles, "Length N
  squares · within Far", "Raise <wall>".
- 'Chain links': dashed blue links with numbered nodes, the link's rows, "Next link" / "Stop here" (the board's two
  buttons are one primary that renames itself: the panel has ONE primary, HANDOFF rule).
- Deviations: the banner and summary are one card at the top centre of the map (the board's `.pickban` + `.bar` sit in a
  tile); the result line reuses that card until H4.1's result panel. No visual-shot spec (no seeded card wall/chain;
  the e2e covers the area banner live).

## Tests

- `tests/unit/hud/area-pick.test.tsx` (21): model (placement, cursor, texts, placeWithin, chain rows / answers); bar +
  layer (click on a 2× scaled map lands on the square, radius, placeWithin block, confirm + line; keyboard arrows +
  Enter + Enter with token keys untouched; Esc cancels every mode with onCancel and focus back; wall two clicks + handle
  drag + order + `stay`; refusal keeps the mode; line dismiss); feature model (plans, **dcm-aiwg** Fangs → Feed's Fear
  Die, nothing on a no-roll use, situations / costs / shortfall, area ask, result line); the hook (Fangs panel: trait,
  rider, target → `useFeature` args with riders; chain links: numbered nodes, `chain:1`, "Stop here" sends `chain:2: []`;
  Dark Cloud straight to the square with `point`; Dark Cloud with a rider: panel → "Pick the square" → riders + point,
  pending line; Shadow Stepper "On yourself", situation gate, no target id sent; `canUse: false` reads no drawer / hand
  and answers classic; Warden's Protection classic).
- `tests/e2e/hud-area-pick.spec.ts` (1): the GM plays for Vex (levelled to the Nightwalker specialization): Dark Cloud
  banner / summary / disabled confirm / axe, Esc cancels, keyboard placement and confirm, a pointer click on the map
  shifted for the open sheet lands on the square (area centre checked when the Spellcast Roll succeeds), Shadow Stepper
  through the panel (situation switch gates the primary, axe, Vex marks 1 Stress).

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest focused: `tests/unit/hud/area-pick.test.tsx` 21 / 21, `sheet-panel.test.tsx` 11 / 11; `tests/unit/hud` 12 files
  pass. Full suite (`--maxWorkers=2 --testTimeout=120000`): 457 files, 10308 passed + 1 expected fail (run before the
  last `canUse` fix; the focused files were rerun after it).
- e2e (ports 3138 / 3388): `hud-area-pick.spec.ts` 1 / 1. All `tests/e2e/hud-*.spec.ts`: 14 passed, 1 failed:
  `hud-sheet.spec.ts` test 1 asserts the panel's right edge at exactly 1440 px and gets 1442-1443; it fails the same
  with this tracer's shell / sheet edits reverted (HEAD = H3.0), so it is not from H3.3 (a transition / sub-pixel race
  under load; not filed, worth a look at merge).
- First e2e attempts failed at "Test sign-in failed." because `pnpm e2e:setup` had run without the worktree's ports;
  rerunning it with `E2E_PORT=3138 E2E_CONVEX_PORT=3388` fixed it.
- Found by `hud-hand.spec.ts`: the hook read `combatFeatures.drawer` / `combatCards.hand` on a view-only sheet, which
  the server refuses for a hidden hand (the sheet panel crashed into its boundary). `useFeatureUse({ canUse })` now
  skips both reads unless the viewer may use the sheet (the sheet passes `rights.use`).

## Merge-time actions

- Accept the three out-of-owns edits above. No Convex change, no codegen, no schema, no authz entry.
- Close **dcm-aiwg** (UI half done; the server took riders in E1.3a).
- H3.1 is already on `rebuild` (merged after this branch started) with a "PointPicker seam" on the classic area pick:
  point that seam at `startAreaPick` / `pickArea` (build the ask with `areaAskOf`), and its chain asks at `chainRows` /
  `chainAnswer` + session data `{ chain: { links } }`. `shell.tsx` also gained H3.2's HudAttack mount on `rebuild`: my
  shell hunk (two PartBoundaries) merges beside it.
- H3.4: the action ring's feature buttons call `useFeatureUse(...).open`.

## QUESTIONS (safest reversible defaults taken)

1. **Feature uses the classic flow never ran.** The classic `FeatureUse` ran only the server-decided uses (count,
   Charge, point areas) and rendered nothing for the rest. The HUD panel now runs every automated action / reaction use
   the sheet offers through `combatFeatures.useFeature`; a reaction used from the sheet without its trigger is the
   server's to refuse (shown under the primary). Reversible in `featurePlan`.
2. **Point-side uses.** Circle of Power (`targets.side: "point"` with a point-centred area) now picks its square and
   sends `point`, so the server's `afterUse` places the circle (it left it for the table before). Shadow Stepper's
   point (a teleport, CB p.42 "reappear inside another shadow within Far range"; the move is a prompt, Q9) picks no
   square and sends no target (the server refuses a token for a `point` side). Confirm both readings.
3. **Rider choices.** A rider with options or numbers takes its first option / minimum (the Attack bar's defaults);
   its situations are confirmed by switching it on (the note says "Confirms: …"). Extra targets of a rider
   (`addTargets`) are not offered on a feature roll.
4. **Enter on the keyboard cursor** places the next point; once all are placed, Enter on a placed point confirms (Enter
   elsewhere moves the nearest point there). Alternative: a separate key for confirm.
