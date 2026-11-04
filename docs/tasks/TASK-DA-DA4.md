# TASK DA4: One End scene path, areas closed at session end, End scene on the Combat Map

Plan `.omc/plans/drawer-answers.yaml`, tracer DA4 (bead `dcm-bxp.99.19`; pin `dcm-bxp.99.19.49 (4)`). Status: Review.

These are the SD8 follow-ups (docs/tasks/TASK-SD-SD8.md, "Follow-ups"). User answer Q7 (a): a scene ends when the GM
ends the running encounter, when the GM presses End scene, or when the session ends.

## Book passages

- CB p.107, End of the Scene: "Sometimes certain effects, bonuses, or conditions state that they last until the end of
  the scene. At the GM's discretion, a scene continues until the current narrative situation has played out."
- HF p.16, Walk Between Worlds: "When the last token is removed or at the end of the scene, you return to the Mortal
  Realm in the same spot you left it."
- HF p.25, Flicker Step (gnome): "Once per scene, you can teleport to another point you can see within Far range." (the e2e
  spec's once-per-scene limit)

## What changed

| File | What |
|------|------|
| `convex/scenes.ts` | The dashboard's `scenes.end` (RF1) now runs `endScene` from `convex/combatScenes.ts`. A PC whose only scene state is a feature limit, the Unstoppable Die, a stance or Walk Between Worlds tokens is now covered too, and scene areas close. Args, the `returns` shape (`{ ended, entryId }`), the idempotency scope (`scene_end`) and the single undoable `actionLog` group are unchanged. `ended` now also counts limits and states. |
| `convex/combatScenes.ts` | `endSceneAreas` takes an optional list of `expires` values (default `["scene"]`). Doc comment names both callers. |
| `convex/sessions.ts` | `runEnd` (used by `sessions.end`, and by `sessions.start` when it ends a live session first) calls `endSceneAreas(ctx, campaignId, now, ["scene", "session"])` before its no-op check. So the areas close even when no session is live or no sheet changed. Areas keep their own history, so this happens outside the undo group, as with `combatScenes.end`. The sheets already ended the scene (`expire(sheet, "session")` covers the scene, SD8). |
| `src/components/combat-map/actions/index.tsx` | The GM column's `Resolutions` ends with a "Scene" card that holds `EndSceneButton` (`className="cm-btn"`). |
| `tests/convex/scenes.test.ts` | Adds: `scenes.end` ends a once-per-scene limit, the Unstoppable Die, the stance and Walk Between Worlds tokens (pin), and closes scene areas but not session or manual ones. It is one group, and undo restores the sheets. Existing tests are unchanged. |
| `tests/convex/session-scene-end.test.ts` | New. `sessions.end` closes `scene` and `session` areas and leaves `rest`, `longRest` and `manual` ones. It closes them with no live session too, and a second End closes nothing new. It also ends the scene's sheet state, including Walk Between Worlds tokens (pin). |
| `tests/e2e/combat-end-scene.spec.ts` | New. A gnome uses Flicker Step and a second use is refused (FEATURE_EXHAUSTED). The GM ends the scene from the map's GM column, the status reads "1 scene effect and limit ended", and Flicker Step works again. |

No new public function. The authz rows for `scenes.end`, `sessions.end` and `combatScenes.end` are unchanged.

## QUESTIONS

None. Every mechanic here was already decided: Q7 (a), and SD8 Q1 (Walk Between Worlds tokens clear at scene end) for the pin.

## Notes for the orchestrator

- The dashboard's `EndScene` (`src/app/(gm)/campaigns/[campaignId]/end-scene.tsx`, outside DA4's `owns`) still says
  "N scene effects ended" / "No scene effects were active". `ended` now also counts limits and states, so that text could
  read "scene effects and limits" like `sceneReport`, and its confirmation text could mention limits.
