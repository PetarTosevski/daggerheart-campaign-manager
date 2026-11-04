# TASK-HUD-H8.2: cut-over, GM side

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 9, tracer H8.2 (boards GMDesktop, GMTablet). Briefs:
`.omc/plans/combat-hud-briefs.md` "Wave 9 (cut-over)". Parent bead dcm-bxp.99.32 (the orchestrator closes it after this
merge). Mode: replace. No server change, no codegen.

## What landed

- **The classic GM cards are gone** from the GM's column (the HUD's "Map tools" drawer, and the Edit layout): the
  Adversaries card (selected adversary's Attack / feature Use / Fear questions / reaction windows / range and sight
  rows), the GM's own-PC incoming-hit card (`GmOwnHits` is no longer mounted), the "Hit questions" (keyword asks)
  card, the Resolutions card (out-of-range list, Difficulty rows, Cloaked prompt card, latest resolutions with Undo),
  the "Adversary actions" resolutions card and the End scene card.
- **Where each one lives now (the HUD):** stat block + purple picker + FearConfirm (`hud/statblock`, `hud/fear`);
  hit window (`hud/hit`, the GM's own PCs included); "Waiting on you" queue (`hud/queue`: out of range, Set the
  Difficulty, Reactions with Resolve now, Cloaked?, Was this hit fire?, ally rolls, death confirms) and its Resolutions
  with Undo (`hud/queue/resolutions.tsx`); End scene in the GM tools toolbar (`hud/scene/end.tsx`).
- **Map tools keeps** Maps, sprite packs, Play / Edit, Combatants, the token card, class controls (`SheetExtras`,
  H8.1), Reveal, Vision, style, the session chip, and the GM's "Players can see each other's cards" switch (user
  decision: kept as a shortcut; mounted by H8.1 at the end of the drawer).
- **Kept:** `EndSceneButton` (`actions/scene`, the Encounter tab's top bar), the hit flashes (`HitFlashLayer`: the HUD
  draws the page's map layers, so the flashes already show on the HUD map; no move needed), the per-character Charge
  Difficulty box in the HUD sheet's Charge use (`requests/index.tsx`, `drawer/use`).

## Files (owns)

| File | Fate |
|---|---|
| `actions/gm/index.tsx` | Deleted (CA5 Resolutions, Sanctions, `resolutionsOf`, `ResolutionRow`). The flash layer's page size now comes from `hud/queue/model.ts` `RESOLUTION_SCAN` (same 40, so it shares the HUD Resolutions' subscription). |
| `actions/adversary/index.tsx` | Reduced to `export { HitFlashLayer }`. `AdversaryPanel` deleted. |
| `actions/adversary/controls.tsx` | Deleted (AA5 controls). |
| `actions/adversary/resolutions.tsx` | Deleted. |
| `actions/adversary/keyword-asks.tsx` | Deleted. |
| `actions/adversary/part-boundary.tsx` | Deleted (only the deleted controls used it). |
| `actions/adversary/flash.tsx` | Kept; imports `adversary.css` itself and `RESOLUTION_SCAN` from the HUD queue model. |
| `actions/adversary/adversary.css` | Reduced to the flash rules (`cmx-flash*`); the controls' `cmx-adv*` rules removed. |
| `actions/adversary/model.ts`, `sight.ts` | Unchanged (reads; the HUD stat block uses them). |
| `requests/cloak.tsx` | Deleted (the GM column's Cloaked prompts). |
| `requests/index.tsx` | Reduced: `DifficultyRequests` is per character and kind only (`characterId`, `ask` required; the HUD sheet's Charge use); the campaign-wide column list and the Cloaked prompts mount are gone. `difficultyText`, `answerLine`, `useWaitingDifficulty` kept. |
| `requests/requests.css` | Kept (the Charge box), comment updated. |
| `tests/unit/adversary-panel.test.tsx` | Reduced: `AdversaryControls` and `AdversaryResolutions` tests deleted; flashes, range / sight, model and `GmOwnHits` tests kept. Coverage: `tests/unit/hud/statblock-panel.test.tsx` ("Attack opens the purple session…", "a feature with PC targets opens the purple panel…", "rows: in range, out of range…, out of sight", the FearConfirm tests), `tests/unit/hud/queue-cards.test.tsx` "Resolutions", `tests/unit/hud/queue-model.test.tsx` "resolutionRows". |

### Out-of-owns edits (accepted by the orchestrator; owned by H8.1)

| File | Edit |
|---|---|
| `src/app/(gm)/campaigns/[campaignId]/combat-map/page.tsx` | `GmColumn` no longer mounts `AdversaryPanel` or `Resolutions`; `HitFlashLayer` import unchanged otherwise. |
| `src/components/combat-map/actions/index.tsx` | `Resolutions` (adversary resolutions + CA5 Resolutions + End scene card) and its `PartBoundary` deleted; re-exports kept. |
| `tests/unit/combat-actions-ui.test.tsx` | The `resolutionsOf` case removed (the function went with `actions/gm`); covered by `tests/unit/hud/queue-model.test.tsx` "resolutionRows". |

`slots.ts` is untouched: `AdversaryPanelProps` / `ResolutionsProps` and its slot tables are now stale (harmless).

## Specs

| Spec | Fate | Notes / coverage |
|---|---|---|
| `lane4-cloak-prompt.spec.ts` | Drives the HUD | The GM's queue card `hud-queue-cloak` ("Does Ash’s Cloaked end?", "Enrapture on Bandit"), axe on the queue, Yes → `hud-queue-result` "Ash is no longer Cloaked.", feed row. |
| `lane4-fire-ask.spec.ts` (× 2) | Drives the HUD | Queue card `hud-queue-keyword` ("Was this hit fire?", "Ember is Fireproof"), axe; Yes / No through `Yes, fire: …` / `Not fire: …`, the result line, the server state as before. |
| `combat-end-scene.spec.ts` | Drives the HUD | End scene in "GM tools", the "End the scene?" dialog names "1 feature limit refreshes.", End the scene, `end-scene-status`. The 44 px touch check is dropped: the HUD's desktop toolbar buttons are 36 px (QUESTIONS 1). |
| `combat-adversary.spec.ts` (× 2) | Drives the HUD | Stat block → Attack → purple picker (Mira in, Rook out) → result; the queue's Reactions card; the Encounter tab's window; flashes on both pages; the player's HUD feed and "You were hit"; HUD Resolutions Undo. Test 2: the GM's "Rook was hit" window, a flash from an API hit, Roar → picker → FearConfirm → Fear 3 → 2. Ran at 1440 × 900 (was 390 for test 2; the GM at 390 → `hud-phone.spec.ts`, `hud-phone-sheets.spec.ts`, `adversary-actions-a11y.spec.ts`). The classic 44 px touch check on the hit window is dropped at desktop (36 px; phone 48 px is checked by `hud-phone-sheets.spec.ts` / `incoming-hit.spec.ts`). |
| `adversary-actions-flow.spec.ts` | Drives the HUD | Step 1: "Tabby can react" → I Am Your Shield → "You were hit" (instead of Mira) → Mark Armor; HUD feed. Step 2: stat block attack (pays a FearConfirm if the second spotlight asks), Mira's hit window, Tabby passes, HUD Resolutions Undo. Step 5: the Group Attack's "You were hit" shows 9. The network leak scan unchanged. |
| `adversary-actions-a11y.spec.ts` (× 2) | Drives the HUD | Encounter tab part unchanged; the player's "You were hit" axe; the stat block axe; Roar → picker → FearConfirm axe → result axe (1440). At 390 the Fear spend stops at the confirm's axe: the card is off-screen (dcm-bxp.99.32.44, annotated in the run). |
| `combat-map-flow.spec.ts` (× 2) | Drives the HUD | `openMapTools` after landing in Play and after Play; player title `hud-title`, light pill and "Your view" in "Your character"; HUD token names (`Open Ash’s sheet (your character)`, `Open Liriel’s sheet`, `Open the Bear’s stat block`). |
| `visual/CA-AA3.spec.ts` | Unchanged | Encounter tab only. |
| `visual/CA-AA5.spec.ts` | Deleted | Shots of the deleted card: stat block → `visual/HUD-H5.2.spec.ts`; hit window → `visual/HUD-H4.2.spec.ts`; Resolutions → `visual/HUD-H5.1.spec.ts`; flash behaviour → `combat-adversary.spec.ts` (both roles) and `tests/unit/adversary-panel.test.tsx` "HitFlashLayer". |

## Checks

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: clean.
- vitest: 482 files, 10588 passed + 1 expected fail.
- e2e (ports 3651 / 3751, servers by hand, `E2E_REUSE_SERVERS=1`; host load 11-17 during the run, dcm-uh6r): full run
  `--workers=2`: 370 passed, 27 failed, 1 skipped (the H8.1 `test.fixme`). The 27: sign-in stuck on /signin or the
  Convex "Function execution timed out (maximum duration: 1s)" (most), plus `combat-map-flow` at 1024 × 768 (the Bear's
  stat block hid the Map tools button on a tablet; the spec now closes the block with Esc first). Rerun
  `--last-failed --workers=1`: 27 / 27 passed.

## QUESTIONS (sensible defaults taken)

1. **Desktop touch targets.** The HUD's desktop buttons (End scene, the hit window's Take / Mark Armor) are 36 px
   high; the classic cards kept 44 px and their specs checked it. Default: the specs no longer check 44 px at 1440
   (the phone sizes are checked by the HUD phone specs). Raise the desktop HUD buttons to 44 px?
2. **FearConfirm at 390 with the stat block open** is translated off-screen (bead dcm-bxp.99.32.44, `hud/fear/fear.css`
   `.hud-root.hud-sh-open .hud-fc`). Not in H8.2's owns; the a11y spec skips the click at 390 until fixed.
3. **`GmOwnHits`** (`actions/reactions`) is no longer mounted anywhere (the HUD hit window covers the GM's own PCs); it
   stays exported with its unit tests because `actions/reactions` is not in H8.2's owns. Delete it in a follow-up?
