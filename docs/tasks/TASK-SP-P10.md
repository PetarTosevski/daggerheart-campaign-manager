# TASK-SP-P10: Sprite-packs end-to-end pass, docs and follow-ups

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P10 (wave 5; depends on P7, P8, P9). Bead: `dcm-bxp.56`
(stays open; the orchestrator closes it). Branched from `rebuild` e0304f1 (P9).

## Goal (from the plan)
A full GM-and-player flow on a Sprites map passes in the browser at desktop and tablet sizes, Classic is proven
unchanged beside it, the task docs are complete and the follow-ups are filed.

## What was built
| File | Does |
|---|---|
| `tests/e2e/sprite-packs-flow.spec.ts` | The one flow spec, two browsers, at 1440 x 900 and 1024 x 768 (below). |
| `tests/e2e/visual/SP-P10.spec.ts` | `@visual` shots of the flow's dungeon hall at night, GM and player, Sprites and Classic, at 1440, 1024 and 390. The map is built through the API (no generation), so the shots do not depend on a seed or the generation rate limit. |
| `docs/tasks/TASK-SP-P10.md` | This document. |

No app code changed. Nothing in the flow needed a `test.fixme`.

## The flow spec (`tests/e2e/sprite-packs-flow.spec.ts`)
Per viewport, one test (GM page + a second browser context for the player):
1. **Table**: the GM's PC Liriel, a running encounter (Bear, Dire Wolf), a prepared blank map (live for now).
2. **P8 upload**: the GM opens "Sprite packs" from the Combat Map, creates "Deep halls" with Setting "Add to Dungeon",
   drops the 4 x 4 fixture sheet (16 cuts in the browser), labels cut 1 "Rune stone", Blocks sight, uploads it
   ("Uploaded"); `combatMapStyle.settings` lists the pack under Dungeon (Q3).
3. **P6 + P7**: back on the Combat Map, a new Medium map; the header's "Map style" switch starts on Classic (Q4),
   one click makes it Sprites (`data-style="sprites"`). Edit mode, Scene card with Setting "Let Claude choose",
   "A damp dungeon with prison cells", Generate: "Drawn from keywords..." (no API key in e2e), the select reads
   "Let Claude choose (chose: Dungeon)"; the map row has `style: sprites`, `setting: {builtin: dungeon}`,
   `settingPicked: false`, and every sprite / texture ref is `dungeon/*` or `common/*` (at least one dungeon ref).
4. Seed-independence (as C9 does): a flagstone texture stroke over rows 5..15 through the API (it also paints stone
   terrain over the generated walls, P9) and the generated objects removed.
5. **P9 edit**: in the Terrain tool the GM picks "Cracked stone" under "Textures · This setting" and paints a 3 x 3
   stroke (server palette `[dungeon-flagstones, cracked-stone]`); in the Objects tool "Your sprites" → "Rune stone",
   placed (kind `pillar`, `sprite: {uploaded}`).
6. Set live; Play mode; "＋ Party (2)", "Place all" from the Adversaries tab (2 party · 2 enemies).
7. Tokens placed (Ash 3,10; Bear 14,10; Dire Wolf 20,10); night (8 days → Moonrise).
8. **Player**: live Sprites map (`data-style="sprites"`, no style switch); `spriteSources` for the player holds only
   the Rune stone, without its name, with a URL (D10). Torch on, Ash dragged one square east (facing east). Bear (dim
   band) and Wolf (dark) hidden; fog clear in front, dim at the Bear, unseen at the Wolf (R10).
9. **Brazier**: in edit mode the GM searches "brazier" and places "Iron brazier (lit)" (Common) beside the Wolf: the
   Wolf appears for the player and the fog around it clears. In Play "Put out the brazier" hides the Wolf, "Light the
   brazier" brings it back (Q1 / D2: a torch-light sprite on Classic kind `torch`).
10. **Pillar**: the GM places "Thick stone pillar" (Blocks sight by default, D3) between Ash and the Wolf: the Wolf
    is hidden from the player again (P3 / P5: sight from the manifest, 2 x 2 circle footprint).
11. **Classic and back**: the GM clicks Classic, then Sprites. Both canvases follow live; after each switch the
    player's `combatVision.playerView` is byte-identical (JSON) to before, the player's fog alpha at five sample
    squares is identical, and the Wolf stays hidden. The map rows are untouched (objects Rune stone, brazier, pillar
    with their refs; two-texture palette; setting dungeon, not picked) (D1). No alert on either page.

Results (machine load average 8-10):
- `tests/e2e/sprite-packs-flow.spec.ts`: **2 passed** (1440, 1024) in 1.1 min.
- Regression, unchanged specs: `combat-map-flow` (C9, 2), `sprite-style` (2), `sprite-edit` (2), `sprite-generate`
  (4), `sprite-packs-upload` (4), `sprite-packs-shell` (3): **17 passed** in 1.9 min. So C9's
  `tests/e2e/combat-map-flow.spec.ts` passes unchanged on rebuild (E1, E2).
- `tests/e2e/visual/SP-P10.spec.ts` (`E2E_VISUAL=1`): **1 passed**, 12 shots.
- `pnpm lint` clean, `pnpm typecheck` clean. `pnpm test`: 186 files, 2457 passed, 21 failed, every failure a
  5 / 15 s timeout under load (unrelated files: level-up, sheet, notes, combat-tokens access rows...); the 13 failed
  files rerun alone: **13 files, 199 tests passed**. This tracer changes no file vitest runs.

Servers: the local Convex backend and `scripts/e2e-next.mjs` were started by hand on 3334 / 3111 and Playwright ran
with `E2E_REUSE_SERVERS=1`; `tsconfig.json` was left unchanged by the build (checked).

## Visual (SP-P10, `E2E_VISUAL=1`): `tests/e2e/visual/SP-P10.spec.ts`
Shots in `test-results/visual/SP-P10/`: `gm-night-{sprites,classic}-{1440,1024,390}.png`,
`player-night-{sprites,classic}-{1440,1024,390}.png`. Scene: walls everywhere, a flagstone hall (rows 5..15) with a
cracked-stone patch and a dirt-and-straw corner, four thick stone pillars, a lit iron brazier, a candle cluster, an
urn, an iron cage and the uploaded Rune stone; Ash with a torch facing east, a Ghoul in the torchlight, the Dire Wolf
behind the pillar next to the brazier. No design board exists for sprites; each Sprites shot's counterpart is the
same view in Classic.

| Region | Verdict |
|---|---|
| GM, Sprites vs Classic (1440 / 1024 / 390) | Same layout in both. Sprites: flagstone / cracked / dirt textures tiled without visible seams; walls Classic with the noisy feathered edge; pillars, brazier (warm glow), candles, urn, cage as pack sprites with bottom-right shadows; the Rune stone (browser-cut upload) drawn from its URL. Classic: the same objects as their Classic kinds (pillar, torch, crystal with a blue glow, barrel, crate). The header's Classic / Sprites switch shows the active style. |
| Player at night, Sprites vs Classic | Identical cone, torch light and pillar shadows in both styles; the pillar's sight shadow hides the brazier corner and the Wolf; the Ghoul in the clear band is shown. No style switch for the player. 390: no horizontal scroll (checked by the helper). |

Deliberate deviations / observations: the cracked-stone patch has a straight edge against the flagstones (same
terrain class, G3); the Maps-card thumbnail still shows the blank map's grass because thumbnails ignore painted
cells (G15, pre-existing D9 behaviour).

## Decisions checked against the app
Evidence: the flow spec (F), this tracer's visual shots (V), or the owning tracer's tests (named).

| Decision | Verdict | Evidence / gap |
|---|---|---|
| P1 Setting picker, default "Let Claude choose", Claude picks | Holds | F step 3 (chose: Dungeon); P7 convex tests (two calls with a key). |
| P2 built-in packs from the 60 sheets + GM uploads cut and labelled | Holds | P4 / P4V (589 sprites, 8.45 MB); F step 2 (browser cut, labels, upload). Gap: per-object light override promised by Q1 (G2). |
| P3 both styles, one-click switch, Classic fully working | Holds | F step 11; E2 below. Open: which style becomes the default (G7). |
| D1 one layout for both styles; setStyle writes only style | Holds | F step 11 (rows unchanged, view identical); P5 test "D1 no row writes". |
| D2 light sprites map to a Classic light kind of the same reach | Holds | P1 catalog test; F step 9 (brazier on kind torch). Gap: Play-mode switch ignores uploaded rows (G1, bug) and is labelled by kind (G5). |
| D3 sight = override ?? manifest ?? R7 | Holds | F step 10 (pillar blocks by default); P9 e2e (bush override). |
| D4 sizes, r scales, rot rotates | Holds, with the P6 deviation the orchestrator kept (stand-ins sized like the Classic drawing). | P3 / P6 tests. |
| D5 app shadows bottom-right, constants in one module | Holds | V; `src/lib/combat-map/sprites/shadows.ts`. |
| D6 world-space tiling, variant mix, feathered class boundaries, seam fix | Holds between classes | V; P6 tests. Gap: same-class texture edges are crisp (G3). |
| D7 stored setting + settingPicked; keyword resolution | Holds | F step 3; P5 tests. Answered (P7): the fallback stores refs, so changing the setting re-maps nothing it generated. Open: setSetting(null) stores the keyword pick (G10). |
| D8 stable keys, content-hashed files | Holds | P4 test; `next.config.ts` immutable header. |
| D9 browser cut, one files row per sprite, deletes fall back | Holds | F step 2; P8 tests (deletePack keeps refs, spriteSources drops them). |
| D10 players get only the live map's sprite URLs | Holds | F step 8 (player spriteSources: one row, no name, a URL; no style switch, no packs). |
| E1 D9 rules on Sprites maps | Holds | F steps 7-11 (night R8, torch R9, dim R10, cone R5, live map R2, tokens C6); C9 flow passes. |
| E2 Classic painter untouched | Holds | `painter.ts`, `raster.ts`, `fallback-layout.ts` last changed by C2 (ea20eff); C9 flow passes unchanged. |
| E3 rows without the new fields read as before | Holds | P0 sprite-fields test. |
| E4 existing arguments accepted | Holds | no sprite-packs tracer changed the combat-map(s) / generate / tokens / vision tests (later commits there are the movement plan's M0 / M2); combat-map-edit changed only for M2's Door count (orchestrator-approved, P9). |
| E5 vision identical without traits; speed budget | Holds | P3 (vision / spec tests unchanged, 300 sprite objects ~1 ms). |
| E6 Classic prompt and keyword layout word for word | Holds | `tests/convex/combat-map-generate.test.ts` unchanged (P7). Answered (P7): Classic maps keep the keyword setting (no classification call); a picked setting steers Classic layouts. |
| E7 upload checks, rejected file deleted, {ok:false, code} | Holds | P8 tests + e2e (SVG). Open: type check uses the recorded content type (G11); rejection details (G12). |
| E8 duplicate copies the new fields | Holds | P0 test. |
| Q1 = (b) faint glow | Holds (engine, catalog, labels) | P3 / P8 / P9. Gap G2 (per-object override). |
| Q2 = (a) two calls, one generation | Holds for Sprites maps | P7 tests (10 generations = 20 calls). Classic: answered, no classification. |
| Q3 = (c) pack is a setting or adds to one | Holds | F step 2 (settings lists "Deep halls" under Dungeon). Follow-up G4 (pack-setting maps map stand-ins through common only). |
| Q4 = (a) new maps Classic | Holds | F step 3 (switch starts on Classic). |
| Q5 sharp devDependency | Holds | `sharp` 0.35.5 (the version Next ships; P0 QUESTION 1, accepted at merge). |

## Questions and deviations collected from P0-P9
Answered by the orchestrator (no bead): P6 Q1 / Q3 (keep Classic-sized stand-ins and the 220 ms fade); P7 Q1-Q3
(Classic maps keep the keyword setting, a picked setting steers Classic layouts, the fallback stores refs); P0 Q1-Q2
(sharp 0.35.5; light union with faintglow); P4 answers 1-4 (the user, in P4's doc). Follow-ups the orchestrator named:
P9 Q1 (G2), P9 Q3 (G3), P6 Q2 (G4). Every other open question is a bead below.

Sheets to regenerate: none. P4's report asked for none after the user's answers (tavern, temple and ruins terrain were
regenerated in P4; the temple polished wood's 0.34 tileability is recorded there and looked fine tiled).

## Beads filed (children of `dcm-bxp`, all naming dcm-bxp.56)
| Bead | P | Gap |
|---|---|---|
| dcm-bxp.83 | P2 bug | G1 Play-mode light switch ignores uploaded sprites' light (faint-glow uploads get no switch) |
| dcm-bxp.84 | P3 | G2 per-object light override (Q1 answer; P9 Q1) |
| dcm-bxp.85 | P3 | G3 soft edges between textures of the same terrain class (P9 Q3) |
| dcm-bxp.86 | P3 | G4 spriteSources returns a pack's `extends` (P6 Q2) |
| dcm-bxp.87 | P3 | G5 light switch labelled by the Classic kind, not the sprite |
| dcm-bxp.88 | P3 | G6 authz-matrix entries for every new function (D12) |
| dcm-bxp.89 | P3 decision | G7 the user's pick: Classic or Sprites as the default (P3, Q4) |
| dcm-bxp.90 | P3 | G8 P1 catalog questions Q-P1-1, Q-P1-2, Q-P1-4 |
| dcm-bxp.91 | P3 | G9 should glowing terrain textures give light (Q-P1-3; a mechanic, ask first) |
| dcm-bxp.92 | P3 | G10 setSetting(null) stores the keyword pick (P5 Q1) |
| dcm-bxp.93 | P3 | G11 upload type check on the recorded content type only (P8 Q1) |
| dcm-bxp.94 | P3 | G12 attachSprite rejection handling (P8 Q2, Q3) |
| dcm-bxp.95 | P3 | G13 `spritePacks.packs` reads everything in one query (P8 Q4) |
| dcm-bxp.96 | P3 | G14 textures on Classic maps; addObject with kind and sprite (P9 Q2, Q4) |
| dcm-bxp.97 | P3 | G15 map thumbnails ignore painted cells, both styles |
| dcm-bxp.98 | P3 | G16 adversary portrait omitted instead of null (P5 Q2) |

## Outside this tracer: suggested diff for G1 (dcm-bxp.83)
`src/components/combat-map/vision/vision-layer.tsx` (not in P10's owns). The read must sit where a failed
`spriteSources` (a map that just stopped being live, for a player) cannot blank the board, as map-canvas.tsx's
`SourcesBoundary` does; the hook goes before any early return.

```diff
@@ imports
+import { useQuery } from "convex/react";
+
+import { api } from "../../../../convex/_generated/api";
 import type { Id } from "../../../../convex/_generated/dataModel";
 import { brushSquares, objectLabel } from "../editor/edit-model";
+import { hasUploadedRefs } from "../map-view/paint-spec";
@@ export function VisionLayer(props: MapLayerProps) {
   const { layout, cells } = useMapView();
+  // Uploaded sprites' light comes from their rows (P5 spriteSources, the same read map-canvas makes).
+  const sources = useQuery(api.combatMapStyle.spriteSources, hasUploadedRefs(layout) ? { campaignId, mapId: layout._id } : "skip");
+  const uploaded = useMemo(() => new Map((sources?.sprites ?? []).map((s) => [s._id as string, s])), [sources]);
@@
-        if (!givesLight({ kind: o.kind, traits: o.sprite ? spriteTraits(o.sprite) : null })) return false;
+        if (!givesLight({ kind: o.kind, traits: o.sprite ? spriteTraits(o.sprite, { uploaded: (id) => uploaded.get(id) }) : null })) return false;
```
