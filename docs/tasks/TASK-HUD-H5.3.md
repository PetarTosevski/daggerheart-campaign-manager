# TASK-HUD-H5.3: Fear spend confirm, End scene confirm with what ends, Areas panel

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 6, tracer H5.3 (boards GMDesktop 'Spend Fear', 'Areas',
'End scene'; CmpPromptsGM 'Spend 2 Fear?', 'End the scene?'). Briefs: `.omc/plans/combat-hud-briefs.md` "Common
rules", "Wave 6", answer 6a. Parent bead dcm-bxp.99.32. Mode: add; everything renders only inside the HUD shell
(switch on, Play), GM view.

## `FearConfirm` contract (stable; H5.2 codes against it)

Exported from `src/components/combat-map/hud/fear` (file `fear/confirm.tsx`):

```ts
export type FearConfirmProps = {
  amount: number;                              // the Fear the action spends (>= 1)
  reasons: readonly string[];                  // one phrase each: "1 to spotlight the Lieutenant"; joined ", " + "."
  onConfirm: () => void | Promise<unknown>;    // runs the action; buttons wait for the promise; a rejection shows
  onCancel?: () => void;                       // Cancel and Escape; omitted = no Cancel button
  fear?: number;                               // the GM's Fear now; omitted = read from combatHud.scene
  campaignId?: Id<"campaigns">;                // whose Fear to read; omitted = the route's [campaignId]
};
export function FearConfirm(props: FearConfirmProps): ReactNode;
export function fearReasonsText(reasons: readonly string[]): string; // "a, b." ("" when none)
export function fearAfterSpend(fear: number, amount: number): number; // max(0, fear - amount)
```

```tsx
<FearConfirm
  amount={2}
  reasons={["1 to spotlight the Lieutenant", "1 for Coup de Grace on Moss (Vulnerable)"]}
  onConfirm={() => run(intent)}
  onCancel={() => setAsk(null)}
/>
```

- The **caller owns the spend**: mount `FearConfirm` when an action needs Fear, do the action (which spends the Fear
  on the server; `NOT_ENOUGH_FEAR` refuses) in `onConfirm`, unmount it when `onConfirm` resolves or on `onCancel`.
  FearConfirm never calls a mutation itself.
- What it shows: `role="dialog"` (non-modal, `aria-modal="false"`, named "Spend n Fear?"), the reasons sentence, the
  flame and "a → b" (screen readers: "Fear a to b"), Cancel and "Spend n Fear" (lilac). It takes focus on mount and
  gives it back on unmount. Testids: `hud-fear-confirm`, `hud-fear-confirm-change`.
- While `onConfirm` runs both buttons are disabled; a thrown error's message (`errorMessage`) shows as `role="alert"`
  and the GM can try again or cancel. With less Fear than `amount` Spend is disabled and it says "Needs n Fear · you
  have m". While Fear loads: "Loading Fear…" (`role="status"`).
- Where: portalled into the HUD's fear region (`[data-hud-region="fear"]`) at the board's right 186 / top 150 (tablet
  right 150 / top 120); it moves left with the banner while a sheet is open (`.hud-sh-open`). With no fear region
  (unit tests, a classic page) it renders inline. Its own `PartBoundary` ("Spend Fear") holds its one query.
- Stubbing in tests: `vi.mock(".../hud/fear", () => ({ FearConfirm: (p) => ... }))`, or render it with `fear` given
  (no query then).

The banner's − still spends without asking (answer 6a). **No existing HUD Fear spend needed wiring**: before H5.2 the
only HUD control that spends Fear is that −. H5.2's stat block (spotlight, Fear features, Experiences, End · 1 Fear)
is the first caller.

## `combatHud.sceneEndPreview` shape

`gmQuery` (`need: "owner"`), args `{ campaignId }`, `returns` validator `sceneEndPreviewValidator`
(`convex/lib/combatHud.ts`):

```ts
{
  effects: string[]; // names of what End scene takes off the party's sheets, each once, in party order:
                     // each ended effect's `source` ("Wall Walk"; stance condition markers too), "Unstoppable"
                     // (the Guardian's die), the active stance's name ("Quick"), "Walk Between Worlds"
  limits: number;    // feature uses that refresh (once-per-scene and GM-turn limits)
  areas: string[];   // labels of the campaign's live map areas with expires "scene", each once
}
```

It mirrors `combatScenes.endScene` step by step without writing: active characters by `by_campaign`
(`take(MAX_CHARACTERS_PER_CAMPAIGN)`), `withoutStance(sheet)` then `expire(…, "scene")` (corrupt sheets skipped, as
`endScene` does), and areas by `by_campaign` (`take(200)`, `status === "active" && expires === "scene"`, as
`endSceneAreas`). The pure diff is `sceneEndOf(before, after, stanceName, walkKey)` in `convex/lib/combatHud.ts`.
`tests/convex/hud-scene-end.test.ts` checks the names, that what it lists is exactly what `combatScenes.end` then
removes, and that a player is FORBIDDEN; the authz matrix entry is in `tests/convex/authz/hud.entries.ts` (`access:
"gm"`; other player and edit grantee FORBIDDEN).

## What landed

| File | What |
|---|---|
| `hud/fear/confirm.tsx`, `fear.css`, `index.tsx` (re-export) | `FearConfirm` (above), board `.sp`. |
| `hud/scene/end.tsx` | `HudEndScene`: the toolbar's End scene opens a native modal `<dialog>` (board `.dm.em`): the map's name as kicker, "End the scene?", the sentence from the preview ("Effects that last “until the end of the scene” end: Wall Walk, Dark Cloud. 2 feature limits refresh. Fear, Hope, HP and Stress stay as they are. The players see a short summary."; with nothing: "Nothing lasts “until the end of the scene” right now."), Keep playing / End the scene. The preview is read only while it is open, in its own `PartBoundary`. End runs `combatScenes.end` once (`useIntent`, fresh key) and the classic `sceneReport` line shows in `end-scene-status`. `sceneEndText` is the pure sentence. |
| `hud/scene/index.tsx`, `scene.css` | End scene is `HudEndScene` (was the classic `EndSceneButton` with its generic confirm); Areas toggles the Areas panel (`aria-expanded`, `aria-controls="hud-areas"`) instead of the area-tools pop-over. Dice and Fog pop-overs unchanged. |
| `hud/areas/index.tsx`, `areas.css`, `open.ts` | `HudAreas` (H0's stub, mounted by the shell in the pop region for the GM): "Areas on the map" at the bottom right (board `.ar`: right 16, bottom 16, 360 wide; 320 on the tablet), `role="dialog"` named "Areas", non-modal. Rows: swatch, name, "Circle · radius Close · blocks sight · Vex" (`areaLine`), a radius picker for circles, Move, Remove. "Draw an area": Name, Shape (Circle / Wall), Radius, Belongs to, Blocks sight, "Pick on the map". The logic is the classic `AreaTools`' (same reads, mutations, optimistic resize / remove, `startAreaPick` with the same prompts and "X drawn." line); `pickSquares` is copied (14 lines) because area-overlay.tsx does not export it. ✕ ("Close Areas") and Escape close it; focus returns to the Areas button. `open.ts` holds the open flag shared by the toolbar button and the panel (a `useSyncExternalStore` module store, as `map-view/area-pick.tsx`). |
| `convex/combatHud.ts`, `convex/lib/combatHud.ts` | `sceneEndPreview`, `sceneEndPreviewValidator`, `sceneEndOf`. |

## Board states matched

- GMDesktop 'Spend Fear' / CmpPromptsGM 'Spend 2 Fear?': title, reasons line, flame "5 → 3", Cancel, lilac "Spend 2
  Fear", under the Fear banner. The CmpPromptsGM card's extra line ("The Lieutenant attacks Moss (Vulnerable).") has
  no prop: the caller can fold it into a reason.
- GMDesktop 'Areas': bottom-right panel, heading "Areas on the map", rows with Move / Remove, "Draw an area" form with
  Circle / Wall segment, Radius, Blocks sight, the pick button. Added beyond the board, from the classic tools: the
  radius picker on circle rows, "Belongs to" (the server needs the owning PC), ✕. The board's "Pick on map" reads
  "Pick on the map" (the classic label; hud-make-room.spec clicks it).
- GMDesktop 'End scene' / CmpPromptsGM 'End the scene?': backdrop, kicker with the scene's name, "End the scene?",
  the sentence naming what ends, Keep playing / End the scene.
- No `tests/e2e/visual/HUD-H5.3.spec.ts`: not in this tracer's owns. The e2e spec checks the Areas panel's box
  (right 16, bottom 16, 360 wide at 1440 × 900).

## Tests

- `tests/convex/hud-scene-end.test.ts` (4): nothing to end; names across the party (effects once, Unstoppable, stance,
  Walk Between Worlds, limits, scene areas only, ended areas skipped); preview equals what End removes and is empty
  after; player FORBIDDEN.
- `tests/convex/authz/hud.entries.ts`: `combatHud.sceneEndPreview` (`gm`).
- `tests/unit/hud/fear-confirm.test.tsx` (17): FearConfirm (sentence, "5 → 3" from the route's campaign, given Fear,
  loading, pending, refusal shown, not enough Fear, portal into the fear region), End scene (sentence, ask first, Keep
  playing, End runs `combatScenes.end` and reports, loading), Areas (line, opens only via the flag and for the GM,
  rows, remove optimistic, Circle / Wall, ✕ / Escape, empty states).
- `tests/e2e/hud-fear-confirm.spec.ts`: the GM opens Areas (box at the board's place), draws "Smoke" on a square,
  End scene names "Smoke", Keep playing ends nothing, End the scene closes it and reports, the empty confirm, ✕
  returns focus; players have neither button; axe on the panel and the confirm. FearConfirm has no live host until
  H5.2, so it is covered by the unit tests.

## Check results

- `pnpm lint`, `pnpm typecheck`: clean.
- Vitest: focused (`tests/unit/hud`, 19 files / 253 tests; `hud-scene-end` + `authz/hud`, 34 tests) green; full suite
  (`--maxWorkers=2 --testTimeout=120000`) 466 files, 10438 passed + 1 expected fail.
- e2e (ports 3189 / 3490): `hud-fear-confirm.spec.ts` passes; every `hud-*.spec.ts` passes except
  `hud-make-room.spec.ts:32`, which fails on `rebuild` too: since the interim commit 36737ed0 a GM click on an
  adversary token only selects it until H5.2 lands, and the spec expects `hud-sh-open` (H5.2's acceptance restores
  it). Its Areas steps (dialog "Areas", `area-tools`) pass before that line.
- Under machine load several specs timed out (sign-in redirect, 30 s clicks); reruns passed.
- Class names: the panel uses `hud-areas-*`. The first draft used `hud-ar-*`, which is the action ring's prefix
  (`hud-ar`, `hud-ar-b`) and broke its buttons; any new HUD prefix must be checked against `grep -r "hud-<prefix>"`.

## Out-of-owns edits

- `tests/unit/hud/fear-scene.test.tsx` (H1.2's): its "Areas, Fog and Dice open the existing tools in one pop-over"
  test expected Areas to open the area-tools pop-over inside `HudScene`. Areas now toggles the shell-mounted panel, so
  the test checks `aria-expanded` / `aria-controls="hud-areas"` instead (the panel itself is tested in
  fear-confirm.test.tsx). `tests/e2e/hud-fear.spec.ts` and `hud-make-room.spec.ts` pass unchanged: the panel keeps
  the dialog name "Areas", the `area-tools` testid, "Close Areas" and "Pick on the map".

## Merge-time actions

- Regenerate `convex/_generated` (`npx convex codegen`): new public query `combatHud.sceneEndPreview`. (Locally the
  generated `api.d.ts` did not change: it types modules by `typeof import`.)

## Beads

None filed; none closed (parent dcm-bxp.99.32 stays open).

## QUESTIONS

None. No new mechanic: the preview reads the engine's existing End scene (CB p.107, "End of the Scene"; SD8 / DA10),
and answer 6a fixed which Fear spends ask.

## User answers 2026-11-02 (applied)

- **Areas folds when not in use** (dcm-bxp.99.32.28). Desktop placement stays bottom right. The panel opens
  unfolded; after a press outside it or focus leaving it (the map, a token, another panel) it folds to its header bar, so the tokens under it
  take clicks again. The header ("Areas on the map", a button with `aria-expanded`) unfolds it; a running square pick
  keeps it shown until the pick ends. Folded, the body stays mounted (hidden), so the draw form keeps its values.
  Testids, the dialog name "Areas", "Close Areas" and "Pick on the map" are unchanged. Tablet placement (under the Fear
  banner) stays. Tests: `fear-confirm.test.tsx`, `hud-fear-confirm.spec.ts`, `hud-make-room.spec.ts` (unfolds before
  its second pick).
