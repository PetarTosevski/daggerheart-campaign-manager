# TASK-D9-C8: Fog of war and the player view on screen

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C8 (wave 5; depends on C7). Bead: `dcm-bxp.32`.

## Goal
Players see the live map through their character's eyes (cone, light, dim and dark bands, faint explored areas,
revealed tokens marked), switch lights and their carried light, and the GM previews any PC's view, reveals tokens and
brushes fog.

## Rules this tracer implements
- **Q1** "the player's fog extends FOG_PAD_SQUARES (default 24, the farthest light reach) beyond every edge, the area
  outside the map always looks exactly like unexplored fog (even when a character looks straight at the edge), and the
  player's pan limits and 'Fit' use that padded area or their explored squares, never the map's real bounds." → the
  fog canvas covers the padded stage; after the blur every pixel outside the map is refilled with exactly the unseen
  colour (opaque, so nothing under it shows); the map's outermost half square is unseen and the next two squares fade
  into the view, so light reaching the edge dies out softly; the stage (scroll extent, the pan limit) is the padded
  area; Fit frames the explored squares plus 3 squares of fog (at least 16 × 12 squares), or the padded area before
  anything is explored. The header line shows players the map's name only (C3's `MapHeaderLine`).
- **R6** cone outline from the viewer's token facing, `coneDeg` from C7's result ("85° vision cone (Instinct +1)").
- **R8** light pill (phase, ☀ / ◐ / ☾, "Dim light: ranged attacks at disadvantage" in Nautical Twilight and Nightfall,
  "Night: light sources matter" at night; nothing for frames without campaign time, C7 QUESTION 1) and the dim-phase
  badge in the "Your view" card.
- **R9** "Map lights are switched on/off by the GM AND by players (a player only for a light they can see or have
  seen)." → a switch over every campfire / wall torch in Play (players: only lights whose square they see now or have
  explored), through C7's `toggleLight` with the wanted state and an optimistic `lit` on `combatMaps.get` / `live`.
  C5's edit-card switch stays the GM's switch in Edit.
- **R10** "on a success the GM reveals that token to that player ('Reveal to...')" → RevealPanel's "Reveal to…" per PC
  (`revealTo` / `unrevealTo`, optimistic on `combatTokens.list`); a revealed token has the board's dashed outline and
  eye badge for that player.
- **R11** "Each player sees only their own character's view. Explored areas stay faintly visible, but tokens there are
  hidden unless the character can see them now." → fog painted from `playerView.vision` (clear: none, dim: 150,
  explored: 205, unseen: opaque; the board's colours) and the stored explored mask; tokens come only from the server.
- **R12** "The GM sees everything, can preview any PC's view, and can reveal or hide areas by hand with a brush." →
  "👁 Player view ▾" in the header and "See the map as" in the Vision & fog card (`previewAs`); fog brush Off / Reveal /
  Hide / Erase with brush 1 / 2 / 3 and "Clear marks" (`paintFog`, optimistic with C5's `paintTile` on the fog layer).
  User 2026-10-20: the brush decides token visibility (reveal shows tokens there, hide hides them), as C1 and C7 built.
- **Q3** carried light: the player's own token in "Your view"; the GM's for any selected token in RevealPanel, under
  C6's token card (decided 2026-10-20). `setCarriedLight`, optimistic on the token lists and the character views.
- **Q4** other PCs' tokens are always shown with HP/Stress (C6's layer, from `party`), never their vision.

No new book page is cited (the light radii are C1's, its task doc quotes CB p.103, p.104, p.129).

## Files (all in `src/components/combat-map/vision/` unless noted)
- `fog.ts` (pure): fog colours, `fogImage` (masks → padded RGBA at half-square resolution, the rim and edge fade),
  `exploredFrame` (the player's Fit frame), `unionMask`, `maskAt`.
- `use-vision.ts`: `useViewing` (player → `playerView`; GM previewing in Play → `previewAs`; else the GM's own view),
  `useStoredExplored`, `useFogMasks`, `useExploredSync`, `useVisionActions` (toggleLight, setCarriedLight, revealTo /
  unrevealTo, paintFog, each optimistic), `paintFogCells`.
- `use-campaign-light.ts`: the phase and light from `campaigns.get` (the shell's subscription) and `campaignTime.get`.
- `vision-state.tsx`: `VisionProvider` (fog tool and brush size).
- `vision-layer.tsx`: `VisionLayer`: fog canvas (z 1, under C6's tokens at z 2), the GM's night / dim tint, an SVG
  overlay (fog marks, cone outline, brush stroke), light switches (z 1), the non-PC tokens a player sees (z 2), the
  brush (z 3), the preview's ghosting style.
- `panels.tsx`: `VisionPanel` (player "Your view" + a selected non-PC token's card; GM "Vision & fog"), `RevealPanel`.
- `header.tsx`: `LightPill`, `PreviewPicker`. `fit.ts`: `usePlayerFitArea`. `vision.css`. `index.tsx`: the exports.
- `src/components/combat-map/map-view/map-board.tsx`, `use-map-zoom.ts` (owned since 2026-10-20): `useMapZoom` takes a
  `fitArea`; Fit zooms to it and centres it; the player's board passes `usePlayerFitArea`.

## Details
- **Fog** is never recomputed on the client: the server's `seen` / `clear` masks include lights the client does not
  know about (hidden torch-bearers, Q3). The engine on the client is used only for the cone (`coneDeg`).
- **Explored sync (R11, CL6)**: `useExploredSync` derives the need during render, `grows = exploredGrows(stored,
  seen)`. The effect depends only on that boolean and the encoded masks (strings), returns at once when nothing grows,
  and sends one `markExplored` per 1.5 s at most (trailing timer, cancelled when the view changes first). After a write
  the stored row updates reactively, `grows` turns false and nothing more is sent; a refused write (`grew: false`)
  does not retry for the same mask because the dependencies did not change. The GM's preview never writes.
- **Other tokens (players)**: C6's `TokensLayer` reads `combatTokens.party` (PC tokens), which matches playerView's
  `pcs`, so PCs stay on C6's layer (drag, knob, panel). The non-PC rows (`others`) are drawn by `VisionLayer` in C6's
  token look (C6's CSS classes, `initialsOf`, `SIDES`, `useRings`), not movable; a click selects one, its card (name,
  side, "revealed to you", range circles) is in the vision panel, and R toggles its circles. No C6 file changed.
- **GM preview**: C6's layer still draws every token for the GM; tokens the previewed PC cannot see are ghosted
  (opacity .28) and revealed ones outlined through a style keyed on C6's `data-token`, so the GM can still select a
  ghosted token and reveal it.
- **Light switches** are transparent round buttons over the painted light (the painter already draws lit / out),
  labelled "Light the campfire" / "Put out the wall torch", 44 px on phones.

## Acceptance evidence
- `tests/e2e/combat-vision.spec.ts` (two browsers, 1 test, passes): night (Moonrise) with a torch: the Bandit in the
  dim band is absent for the player, the Wolf in clear light present; light pill, cone text "70° vision cone
  (Instinct +0)", light rule, header line without size; fog pixels: the padding and an unexplored map square are both
  exactly (4, 6, 9, 255), also just outside the west edge; clear light in front of Ash has no fog, the Bandit's square
  is dim (alpha 100..200); Fit frames the explored squares (closer than the padded area); `explored` grows on the
  server; the player puts out a wall torch (optimistic, stored `lit: false`); the GM reveals the Bandit through
  "Reveal to…" and it appears live with the dashed outline; the GM moves the Wolf behind a painted wall and it
  disappears; the GM previews Ash (fog, cone, the Wolf ghosted) and goes back; the GM takes the reveal back (Bandit
  gone); day (Nautical Dawn): the Bandit shows unmarked, the Wolf stays hidden, Ash's cone is clear up to the east edge
  and the pixels just past the edge are exactly unexplored fog; the GM's Hide brush over the Bandit hides it from the
  player, Erase brings it back; no alert on either page.
- All combat e2e specs together (`combat-vision`, `combat-tokens`, `combat-maps`, `combat-map-shell`,
  `combat-map-edit`, `combat-map-generate`): 11 of 12 pass; `combat-tokens` fails only on C6's "the player sees no
  Bear" line, which C7 + C8 now contradict by design (by day the Bear is in Ash's cone). With the one-line change
  below it passes (verified in this worktree, then reverted).
- `pnpm lint` clean, `pnpm typecheck` clean, `vitest run`: 137 files, 1566 tests pass.

## Visual comparison
App: `test-results/visual/C8/{player-night-hidden,player-night,player-card-night,gm-night,gm-cards,gm-preview,
player-day-edge,player-dim}-{1440,1024,390}.png` (E2E_VISUAL=1 `tests/e2e/visual/C8.spec.ts`).
Board: `test-results/visual/board/combat-{player-night,player-day,gm-play}-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Player at night (player-night, player-night-hidden) | Matches the board's fog: clear torch light, darker dim band, explored areas faint, unseen black, the dashed gold cone lines, shadows behind trees and the painted wall. The revealed Bandit has the board's dashed lilac outline and eye badge. Deviation (Q1): the map's edges never show: outside the map is the same black as unexplored fog (the board shows the map's end and the dark viewport). |
| "Your view" card | Matches the board's "You are" card (name, Find me, class · level · cone, Facing, Light you carry, light rule) under the C0 label "Your view"; adds the dim-phase badge (R8). |
| Light pill | Matches the board's pill colours and copy for day, dim and night. |
| Player by day at the edge (player-day-edge) | The cone is clear up to the map's east edge, where the view fades out over two squares into the fog; past the edge only fog. |
| Player in a dim phase (player-dim) | Pill and card badge "Dim light: ranged attacks at disadvantage"; full vision in the cone. |
| GM at night (gm-night) | The board's night tint over the map, Hide marks (dark violet squares) and Reveal marks (light squares); light switches (invisible until hovered or focused) over the campfire and wall torch. |
| GM cards (gm-cards) | Selected token (C6) then "Carried light · Bandit" and the board's violet "Reveal to…" box; Vision & fog: See the map as, the fog brush, Brush 1 / 2 / 3, Clear marks. |
| GM preview (gm-preview) | "👁 Viewing as Ash ▾", the PC's fog and cone over the GM's map, the Bandit Archer behind the wall ghosted. |
| 390 px | Single column, 44 px targets, no horizontal scroll (checked by the visual helper). |

## Deliberate deviations
- The board's per-map "Light" override (phase select in Vision & fog) and "Forget explored" are not built: the data
  model has no per-map phase and C7 has no mutation to clear explored rows (see QUESTIONS).
- Unseen fog is opaque (board: 250 of 255) so the padding, which has no map under it, matches it exactly (Q1).
- The GM's preview ghosts the tokens the PC cannot see instead of hiding them (the board hides them), so the GM can
  select one and reveal it while previewing.
- Players' non-PC tokens are drawn by the vision layer (C6's layer reads PC tokens only); see "Outside owns".
- Fog marks are drawn as square outlines (the board strokes one diagonal per hidden square).

## Outside owns (needed, not edited)
`tests/e2e/combat-tokens.spec.ts` (C6): with C7 + C8 the player now sees the Bear by day, so its "no adversary" line
fails. Diff (verified):

```diff
@@ -118,7 +118,8 @@
     const theirs = playerBoard.getByRole("button", { name: /^Liriel, Party/ });
     await expect(mine).toBeVisible();
     await expect(theirs).toBeVisible();
-    await expect(playerBoard.getByRole("button", { name: /^Bear/ })).toHaveCount(0);
+    // C8: by day the Bear stands in Ash's cone, so the player sees it, with no stats (R4).
+    await expect(playerBoard.getByRole("button", { name: "Bear, Enemy" })).toBeVisible();
```
(and its header comment's "and sees no adversary" should read "and sees the adversary without stats").

## QUESTIONS
1. A view that reaches the map's edge ends along a straight line (softened: a half-square rim plus a two-square fade).
   Pixels outside the map are exactly unexplored fog, but an attentive player can still guess the edge from where the
   light stops, as with a wall. Hiding even that would need invented terrain past the edge. Keep?
2. "Forget explored" (board) needs a C7-side GM mutation that deletes a map's `combatExplored` rows; file a follow-up?
3. A per-map light override (the board's "Light" select) would need a field on `combatMaps`; skipped (R8 says light
   follows campaign time).
4. Players get C6's `party` for PC tokens and C7's `others` for the rest (two queries). If preferred, C6's
   `useTokens` could read `playerView.pcs` for players (one query): a change in `tokens/use-tokens.ts` and its
   optimistic `patchTokens` (add `combatVision.playerView` pcs).
