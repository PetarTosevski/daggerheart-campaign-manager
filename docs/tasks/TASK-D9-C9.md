# TASK-D9-C9: D9 end-to-end pass, docs and follow-ups

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C9 (wave 6; depends on C4, C8). Bead: `dcm-bxp.32`.

## Goal
A full GM-and-player combat flow passes in the browser at desktop and tablet sizes, every rule (R1–R12, Q1–Q6) is
checked against the app, and the follow-ups are filed.

## The flow spec
`tests/e2e/combat-map-flow.spec.ts`: one two-browser test, run once at 1440x900 and once at 1024x768 (a
`test.describe` per viewport; the player's context gets the same viewport).

1. The GM's PC Liriel, the player's PC Ash, a running encounter with a Bear and a Dire Wolf (SRD), and a prepared blank
   map ("Prep sketch", the first map, so live).
2. GM, UI: "＋ New map" Medium 30×20, Edit, describes "A windswept desert dune under the stars" and clicks "✦ Generate
   map". The e2e backend has no `ANTHROPIC_API_KEY`, so the card says "Drawn from keywords in your description." and the
   list shows the map as Generated (C4).
3. The fallback scatters trees with a fresh seed per generation; the spec removes the sight blockers through
   `combatMapEdit.removeObject` (using C1's `blocksSight`) so the vision checks do not depend on the seed. Bushes and
   rocks stay (cover only, R7).
4. GM, UI, Edit by hand: a 3-square stone stroke from (6, 15) to (10, 15) (C5); the server stores painted cells.
5. GM, UI: "Set live" on the generated map; the LIVE badge leaves the prepared map (R2).
6. GM, UI, Play: "＋ Party (2)" and the "From the Adversaries tab" queue's "Place all" (C6): "2 party · 2 enemies", four
   tokens. The spec then places Ash at (3, 10), the Bear at (14, 10), the Wolf at (20, 10) and Liriel at (1, 18) through
   `combatTokens.move`.
7. Night: `campaignTime.advance` × 8 (DAY 1 → NIGHT 2, Moonrise; R8).
8. Player, UI: the light pill says Moonrise; the map's name is the header line (no W × H, Q1); they pick "Torch" in
   "Light you carry" (Q3) and the light rule reads "your torch lights clearly to Close and dimly to Far" (R9); they drag
   Ash one square east: Ash stands on (4, 10) facing east (data-face 0, R5) and the GM's map follows.
9. Player: Liriel is shown (Q4); the Bear (10 squares away, the torch's dim band) and the Wolf (16 squares, dark) are
   not (R10). `combatVision.playerView` itself returns only the two PCs and no other token (filtered on the server,
   Q1). The fog canvas: clear in front of Ash, the dim band's alpha (100–200) at the Bear, exactly the unseen colour at
   the Wolf.
10. GM: all four tokens on the board (R12); selects the Bear, "Reveal to…" Ash: the player sees "Bear, Enemy, revealed
    to you" live with the dashed outline (R10). The Wolf stays hidden.
11. GM, UI, Edit: Objects → Campfire, click (22, 10): the campfire is placed lit; the player sees the Dire Wolf and the
    fog at (20, 10) and (24, 10) clears (campfire clear to 12, R9). The spec waits until the player's stored explored
    row grows (see gap 5).
12. GM, Play: "Put out the campfire": the Wolf disappears for the player and its square turns explored (faint, not the
    unseen colour, R11); "Light the campfire": the Wolf is back. No error alert on either page.

Result: see "Checks" below.

## R / Q checklist
| Rule | Verdict | Evidence |
|---|---|---|
| R1 square grid, 5 ft; GM sizes and aligns it over an image | Met | `convex/combatMaps.ts` `setGrid`; grid bar in `src/components/combat-map/map-view/`; `tests/convex/combat-maps.test.ts` "sets the grid…"; `tests/e2e/combat-maps.spec.ts`, `tests/e2e/combat-map-edit.spec.ts` (image map) |
| R2 several maps, one live; generated layouts edited by hand and regenerated | Met | `combatMaps.create/setLive/duplicate/remove`, `combatMapGenerate.generate`, `combatMapEdit.*`; `combat-maps.test.ts` "keeps exactly one live map…"; `combat-map-generate.spec.ts` (Another version); this flow (generate → edit → Set live) |
| R3 range circles on any token, per token, "hide all"; Melee 1 / Very Close 3 / Close 6 / Far 12 | Met | `src/lib/domain/combat-map/ranges.ts` `RANGE_BANDS`; `tokens/rings.ts`, `token-panel.tsx` "◎ Hide all circles"; `combat-tokens.spec.ts` (R key, Hide all) |
| R4 tokens linked to tracker and sheets; players never see adversary stats; players move/turn only their own PC | Met | `convex/combatTokens.ts` (stats read from sheet/tracker, no copies), `move`/`turn` COMBAT_NOT_YOUR_TOKEN; `combat-vision.test.ts` "never sends an adversary's or custom token's stats"; `combat-tokens.test.ts` "lets a player move and turn only their own PC token"; `combat-tokens.spec.ts` |
| R5 faces the way it moved; owner/GM turn with a handle snapped to 15°; portrait shows the front | Met | `combatTokens.move` (face from movement), `turn` (`snapTurn`); `combat-tokens.test.ts` R5 cases; `combat-tokens.spec.ts` (knob); this flow (player drag → face 0). The portrait stays upright with the board's facing arc and arrow marking the front (as on the board; TASK-D9-C6) |
| R6 cone 70 + 15 × Instinct, 10..180, never behind, named constants | Met | `src/lib/domain/combat-map/vision.ts` `VISION_BASE_DEG`, `VISION_STEP_DEG`, `coneDeg`; `tests/unit/combat-map-vision.test.ts` (cone cases); `combat-vision.spec.ts` "70° vision cone (Instinct +0)" |
| R7 big things block sight, small things cover only, GM override per object | Met | `src/lib/domain/combat-map/sight.ts` `SIGHT_DEFAULTS`; `combatMapEdit.setObjectSight`; `combat-map-edit.test.ts` "sets an object's sight…"; `combat-map-edit.spec.ts` (crate set to block) |
| R8 light by campaign time; only Nautical Twilight and Nightfall dim; Nautical Dawn day | Met (Witherwild) | `src/lib/domain/combat-map/light.ts` `DIM_PHASES`, `lightOf`; unit "only Nautical Twilight and Nightfall are dim…"; `combat-vision.spec.ts` (Nautical Dawn = Daylight); this flow (Moonrise). Gap: frames without campaign time are always day, see dcm-bxp.54 |
| R9 night reaches (none 1/3, torch = lantern 6/12, Alistair 12, wall torch 6/12, campfire 12/24); GM and players switch map lights (players only seen/explored ones) | Met | `light.ts` `CARRIED_LIGHT_REACH`, `MAP_LIGHT_REACH`; unit light rows; `combatVision.toggleLight` COMBAT_LIGHT_NOT_SEEN; `combat-vision.test.ts` "lets a player switch only a light…"; `combat-vision.spec.ts` (player puts out a wall torch); this flow (torch dim band, campfire placed lit, put out, lit again) |
| R10 dim light at night hides non-PC tokens; GM "Reveal to…" after a roll | Met | `vision.ts` `tokenVisibility`; `combatVision.revealTo/unrevealTo`; `combat-vision.test.ts` "hides a dim-band enemy at night until the GM reveals it…"; `combat-vision.spec.ts`; this flow (Bear) |
| R11 own character's view only; explored areas faint, tokens there hidden | Met, one gap (dcm-bxp.55 (fixed after C9: the write is sent at once and never cancelled)) | `combatVision.playerView`, `markExplored`, `combatExplored`; unit "another PC's vision is not shared", "a revealed token out of sight is hidden"; `combat-vision.test.ts` explored case; this flow (fire out → Wolf hidden, square explored) |
| R12 GM sees everything, previews any PC, reveal/hide brush | Met | `combatVision.previewAs`, `paintFog`; "👁 Player view ▾", "See the map as", fog brush in `vision/panels.tsx`; `combat-vision.test.ts` "gives the GM's preview exactly the player's result"; `combat-vision.spec.ts` (preview, Hide/Erase brush); this flow (GM board shows all four tokens). Board's "Forget explored" not built, see dcm-bxp.52 |
| Q1 whole layout to players, tokens filtered on the server; padded fog, hidden edges, no W × H | Met | `combatMaps.live` (layout), `combatVision.playerView` (tokens); `FOG_PAD_SQUARES` in `vision.ts`; `vision/vision-layer.tsx`; `combat-vision.spec.ts` (padding pixels = unseen, Fit, header); this flow (`playerView` returns only the PCs, header = map name) |
| Q2 lantern = torch | Met | `light.ts` `CARRIED_LIGHT_REACH.lantern`; unit "torch and lantern…" |
| Q3 every token can carry a light; GM sets any, player their own | Met | `combatVision.setCarriedLight`; RevealPanel "Carried light · <name>" and "Light you carry" (`vision/panels.tsx`); unit and `combat-vision.test.ts` "enemy's carried torch…"; this flow (player picks Torch) |
| Q4 players always see other PCs' tokens, never their vision; allies/neutrals follow R10 | Met | `vision.ts`; unit "other PCs are always shown…", "allies and neutral tokens follow R10"; `combat-vision.test.ts` Q4 case; this flow (Liriel shown at night far behind Ash) |
| Q5 10 generations per user per hour | Met | `convex/lib/functions.ts` `RATE_LIMITS.combatMapGenerate`; `combat-map-generate.test.ts` "allows 10 generations per user per hour (Q5)" |
| Q6 "+ Session encounter" disabled ("Comes with Sessions"); D10 bead | Met | `tokens/combatants-panel.tsx`; `combat-tokens.spec.ts` (disabled, title); D10 bead dcm-bxp.50 exists (open, "D10: wire the Combat Map's '+ Session encounter' button") |

## Gaps
1. **Frames without campaign time are always day** (C7 QUESTION 1, C8 QUESTION 3): R8 ties light to campaign time,
   which only Witherwild has, so night, dim bands, carried lights, campfires and "Reveal to…" never matter in the other
   frames. Unspecified mechanic: ask the user first. Bead **dcm-bxp.54**.
2. **"Forget explored"** (board, Vision & fog card) is not built; needs a GM mutation deleting a map's `combatExplored`
   rows (C8 deviation + QUESTION 2). Bead **dcm-bxp.52**.
3. **Players use two token queries** (C6's `combatTokens.party` + C7's `combatVision.playerView`); unify on
   `playerView.pcs` (C8 QUESTION 4). Bead **dcm-bxp.53**.
4. **authz matrix**: the D9 public functions are covered in each tracer's own Convex test, not yet in
   `tests/convex/authz-matrix.test.ts` (Top-15 rule 14; D12). Bead **dcm-bxp.51** lists every function:
   `convex/combatMaps.ts`, `combatMapGenerate.ts`, `combatMapEdit.ts`, `combatTokens.ts`, `combatVision.ts`, plus
   `characters.toggleCondition`, `feed.remove`, `feed.clear`.
5. **Squares seen only briefly never become explored** (R11, found by this flow): `useExploredSync`
   (`src/components/combat-map/vision/use-vision.ts`) sends the character's current seen mask, throttled to one write
   per 1.5 s; a pending write is cancelled when the view changes and the next one carries only the newer mask, and
   `markExplored` keeps only what the character sees at write time. In the first runs the GM put the campfire out
   within that window and the Wolf's square went back to unseen instead of explored. The spec now waits for the
   stored row to grow before putting the fire out. Bead **dcm-bxp.55 (fixed after C9: the write is sent at once and never cancelled)** (bug, P3).

Not filed (no gap against the rules):
- C0 QUESTION 1: the plan names a shared `Loading` component that does not exist; the slots use the codebase's inline
  `role="status"` pattern. A codebase-wide matter, not D9's.
- C8 QUESTION 1: a view that reaches the map's edge ends along a straight line, so an attentive player can guess the
  edge from where the light stops (pixels outside the map are exactly unexplored fog, Q1 holds). Open user question,
  left in TASK-D9-C8.
- Only maps created from the Scene card open in Edit; "＋ New map" keeps the current mode (the flow clicks Edit, as
  `combat-map-generate.spec.ts` does).
- Test budget: the flow generates once per viewport with the shared e2e GM, whose `combatMapGenerate` bucket (10 per
  hour) `combat-map-generate.spec.ts` also uses (4). The e2e allowlist has no second GM address, so repeated full
  runs within an hour on one backend can hit RATE_LIMITED.

## Beads
- dcm-bxp.51 D12: authz-matrix entries for every D9 public function
- dcm-bxp.52 Combat Map: GM 'Forget explored' action
- dcm-bxp.53 Combat Map: players read PC tokens from playerView.pcs (one query)
- dcm-bxp.54 Combat Map: night and lights in frames without campaign time (ask the user)
- dcm-bxp.55 (fixed after C9: the write is sent at once and never cancelled) Combat Map: squares seen only briefly never become explored (bug)
- dcm-bxp.50 (exists, C6) D10: wire the Combat Map's '+ Session encounter' button

## Checks
- Flow spec: `E2E_PORT=3131 E2E_CONVEX_PORT=3374 pnpm test:e2e tests/e2e/combat-map-flow.spec.ts`: 2 passed (1440x900,
  1024x768), twice in a row (25.0 s, 21.0 s). No test.fixme.
- `pnpm lint`: clean. `pnpm typecheck`: clean. `pnpm test`: 1566 of 1567 under machine load; the one failure is a
  5 s timeout in `tests/unit/domain-deck-level-up.test.ts` (unrelated to D9), which passes alone (4/4).
- `pnpm tracer:guard .omc/plans/d9-combat-map.yaml C9`: OK, both changed files owned.
