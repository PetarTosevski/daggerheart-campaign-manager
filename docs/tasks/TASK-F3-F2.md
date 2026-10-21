# TASK-F3-F2: Combat Map: uploaded light sprites get the Play-mode light switch, named after the sprite

Status: Review. Plan: `.omc/plans/followups-3.yaml`, tracer F2 (wave 1, no dependencies). Beads: `dcm-bxp.83` (G1)
and `dcm-bxp.87` (G5) from TASK-SP-P10. Both stay open; the orchestrator closes them.

## What was built
| File | Change |
|---|---|
| `src/components/combat-map/vision/vision-layer.tsx` | The Play-mode light switches are now their own `LightSwitches` component. When the map has uploaded refs (`hasUploadedRefs`), `LightSwitchesWithSources` reads `combatMapStyle.spriteSources`, the subscription the canvas already holds, so it adds no new read. It passes `{ uploaded: id => row }` to `spriteTraits`, so an uploaded faint-glow or torch sprite gets a switch, as the server's `toggleLight` (via `loadObjectTraits`) and the editor panel already allow (G1). The read sits behind a `SourcesBoundary` keyed on the map, as in map-canvas.tsx. If it fails (for example, a map that just stopped being live, for a player), the switches fall back to the built-in lookup and the layer stays up. No hook is conditional: the branch picks a component, not a hook. Each switch is labelled with `lightLabel`: the built-in sprite's catalog name (`spriteName`), the uploaded row's name when the row has one (the GM only, D10), else the Classic kind's `objectLabel` (G5). |
| `tests/e2e/combat-light-uploaded.spec.ts` | New e2e spec, described below. |
| `tests/e2e/sprite-packs-flow.spec.ts` | The brazier switch names follow G5 (below). |
| `docs/tasks/TASK-F3-F2.md` | This document. |

`src/components/combat-map/vision/panels.tsx` is unchanged. The plan lists it as owned for "light switches (map and panel)", but the vision panels have no light switch, only the Doors card (M2). The only light switch outside the map is the editor's selected-object card (`edit-tools-panel.tsx`, P9), and it already shows `sprites.nameOf(object) ?? objectLabel(kind)`. Adding a Lights card to the vision panel would be a new mechanic that nobody specified, so F2 does not add one (QUESTION 1). Doors in the vision layer and the Doors card are untouched.

## The e2e spec (`tests/e2e/combat-light-uploaded.spec.ts`, 1440 x 900)
1. The GM creates the pack "Glow kit" (Add to Dungeon) through the P8 upload page. Cut 1 of `tests/fixtures/sprite-uploads/props-4x4.png` is named "Glow stone", with Gives light set to Faint glow, and uploaded. The stored row has `light: faintglow` and `classicKind: crystal`. The crystal kind gives no light on its own, which is how G1 happened.
2. A blank Medium map is created (the campaign's first, so live) and switched to Sprites / Dungeon through the API.
3. Edit mode, Objects tool: under "Your sprites" the GM places "Glow stone" at (8, 7), then searches "brazier" and places "Iron brazier (lit)" (Common) at (1, 18). The stone row is `kind: crystal, sprite: {uploaded}`.
4. Play: two switches. The labels are "Put out the glow stone" and "Put out the iron brazier (lit)", and none reads crystal or torch (G5). The GM puts the stone out (row `lit: false`, "Light the glow stone", not pressed), lights it again, and puts the brazier out.
5. The player joins and creates Ash. The GM adds the party; Ash is moved to (4, 7) and faces east. By day the stone is in Ash's view and the brazier, behind Ash, is not. The player sees exactly one switch, "Put out the crystal": D10 gives players no sprite names, so the switch shows the Classic look. The player puts the stone out (row `lit: false`), the GM's board follows live ("Light the glow stone"), and the player lights it again. No alert appears in `.cm-root` on either page.

## Results
Servers were started by hand: the local Convex backend on 3378 and `scripts/e2e-next.mjs` on 3133 (`NEXT_DIST_DIR=.next-e2e-3133`). Playwright ran with `E2E_REUSE_SERVERS=1`. Load average was 38-46.

- `tests/e2e/combat-light-uploaded.spec.ts`: **1 passed** (52 s). Earlier attempts failed only on backend timeouts under load: a 4 s / 1 s "Function execution timed out" in `combatVision.doors` and `combatTokens.sessionEncounter`, and once a sign-in redirect slower than 5 s. Two runs also exposed spec mistakes, now fixed: the brazier was placed in the player's view, and the alert check matched the page-level route announcer.
- Combat-map regression (`playwright test tests/e2e/combat- tests/e2e/sprite-`, 35 tests). First run at load 40+: 24
  passed and 11 failed. Every failure was a backend "Function execution timed out" alert, a generation slower than
  5 s, or a test timeout, except sprite-packs-flow: its spec file was edited to the new brazier names while the run
  was going, so it still clicked "Put out the brazier", and the page snapshot shows "Put out the iron brazier (lit)".
  Rerun of the 11 failed specs' files at load ~23: 22 of 23 passed, including both sprite-packs-flow viewports with
  the new names, combat-vision (doors, lights, wall torch), combat-map-flow (campfire) and sprite-edit.
  combat-map-generate failed once on "Drawing the battlefield…" after 5 s and passed alone (2 passed). So every
  combat-map and sprite spec has passed with F2.
- `pnpm lint` and `pnpm typecheck` clean; vitest results below.

## Questions and deviations
- QUESTION 1 (plan wording): "Light switches (map and panel)". No vision panel has a light switch, and the editor's object card already uses the sprite name. Should the GM's Play panel get a Lights card like the Doors card? That is a new mechanic, so I'm asking before building it.
- QUESTION 2: the built-in sprite name keeps its state word: "Put out the iron brazier (lit)", and once out, "Light the iron brazier (lit)". Should trailing state words such as "(lit)" be dropped from switch labels? The editor card shows the full name, so F2 keeps it.
- `tests/e2e/sprite-packs-flow.spec.ts` (added to F2's owns by the orchestrator, af6ac84): lines 288 and 290 clicked
  "Put out the brazier" / "Light the brazier" on the built-in Iron brazier (lit); after G5 they read
  "Put out the iron brazier (lit)" / "Light the iron brazier (lit)", and the spec now uses those names.
  Classic switches keep their labels ("wall torch" in combat-vision, "campfire" in combat-map-flow).
- D10 holds (orchestrator: fine; built-in names may show to players): a player's switch for an uploaded sprite falls back to the Classic look's label, because `spriteSources` gives players no names.
