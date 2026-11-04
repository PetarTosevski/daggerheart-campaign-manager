# TASK LN-M: Combat map visuals, sprites, night and lights

Plan `.omc/plans/lanes.yaml`, tracer M (lane `w2-map-visuals`), wave 5. Beads: dcm-bxp.54, dcm-p40, dcm-bxp.86,
dcm-bxp.97 and dcm-bxp.129 built. dcm-bxp.84 was not built: it needs files outside this tracer's owns (follow-up dcm-klr8).

## What landed

| File | What |
|------|------|
| `src/lib/domain/combat-map/light.ts` | dcm-p40: `DIM_PHASES` = Dawn, Nautical Twilight, Nightfall, Nautical Dawn (days 1 and 7 of both cycles); other day phases day, other night phases night. `lightOf` also reads a light level (`day`/`dim`/`night`) as itself. New `LIGHT_LEVELS`, `LIGHT_LEVEL_LABEL`, `isLightLevel`. |
| `convex/tables/campaigns.ts` | dcm-bxp.54: optional `campaigns.timeOfDay` (`timeOfDayValidator`: day / dim / night; unset = day). Widen only. |
| `convex/lib/combatVision.ts` | `campaignLight(ctx, campaign)`: Witherwild = `lightOf(phase)`, else the stored time of day. `Scene.phase` is now what the engine reads (the phase name, or the light level outside the Witherwild); new `Scene.phaseName` (display, null outside the Witherwild). So every caller that passes `scene.phase` to `createView` / `lightOf` (combatMovement's enemy sight and Cloaked dim check, combatActions, adversaryActions, `viewOf`) follows the campaign light with no change. `loadScene`'s Sprites glow uses a pack setting's `extends`. |
| `convex/campaigns.ts` | `timeOfDay` (campaignQuery, view; returns phase, light, `canSet`) and `setTimeOfDay` (campaignMutation, `need: "edit"`, one field; INVALID in a frame with campaign time). |
| `convex/lib/spriteSources.ts`, `convex/combatMapStyle.ts` | dcm-bxp.86: `packExtends`, `resolveSetting` returns `extends`; `spriteSources` returns `extends` (GM and player). dcm-bxp.97: new GM query `combatMapStyle.thumbnail` (a map's terrain and texture tiles, palette, extends; null for a map not of this campaign). |
| `src/components/combat-map/map-view/paint-spec.ts`, `map-canvas.tsx` | `paintSetting(layout, packExtends)`, `hasPackSetting`; a pack-setting map reads `spriteSources` and draws unreferenced objects and terrain from the extended setting + common. |
| `src/components/combat-map/maps/thumbnail.tsx` | Thumbnails draw hand-painted terrain and texture cells in both styles (one `thumbnail` subscription per card, behind its own boundary; uploaded textures still show their Classic terrain). |
| `src/components/combat-map/vision/use-campaign-light.ts`, `header.tsx`, `vision.css` | One query (`campaigns.timeOfDay`); `useSetTimeOfDay` with an optimistic update. Header: Witherwild = read-only phase linking to `/campaigns/<id>#time-arc`; elsewhere a GM "Time of day" select, read-only pill for players. |
| `src/app/(gm)/campaigns/[campaignId]/time-of-day.tsx`, `campaign-shell.tsx`, `time-arc.tsx` | Dashboard: Day / Dim / Night segmented control where TimeArc sits for non-Witherwild frames (read-only for players, in a SlotBoundary). TimeArc gets `id="time-arc"` and a read-only "Light: …" line. |
| `src/components/combat-map/generate/scene-chips.ts`, `scene-panel.tsx`, `generate.css` | dcm-bxp.129: suggestion chips under the description; a click fills the whole editable description. Setting chips verbatim from `.omc/plans/scene-chips.md` (19 x 4); 6 frame chips per published frame, drafted from the frame chapters (CB ch. 5, HF ch. 4), shown only in that frame's campaigns. A GM pack shows the chips of the setting it extends; "Let Claude choose" the map's last setting, else DEFAULT_SETTING. |
| Tests | `tests/convex/lane-m-time-of-day.test.ts`, `tests/unit/combat-map/lane-m-light.test.ts`, `tests/unit/combat-map/lane-m-scene-chips.test.ts`, `tests/e2e/lane-m-time-of-day.spec.ts`; authz entries in `tests/convex/authz/core.entries.ts` (`campaigns.timeOfDay`, `campaigns.setTimeOfDay`, `combatMapStyle.thumbnail`). |

Outside owns (needed; orchestrator to accept): `tests/unit/combat-map-vision.test.ts` asserted the old dim rule
(Nautical Dawn = day); updated to dcm-p40.

## Answers used

- dcm-bxp.54, user 2026-10-21 / 2026-10-30: every campaign has Day / Dim / Night; the GM sets it on the dashboard and
  the map header (one value), players read-only; Witherwild: the phase drives it, read-only with a link to the arc.
- dcm-p40, user 2026-10-30: dim on the last/first days of the day and night cycles.
- dcm-bxp.129, user 2026-10-22 / 2026-10-30: per-setting list approved verbatim; frame chips 4-6 each from the books.

## Notes for merge

- `docs/data-model.md`: add `campaigns.timeOfDay` (optional day | dim | night, unset = day; ignored in frames with
  campaign time).
- combatMovement needs no change: `scene.phase` now carries the light level outside the Witherwild.
- E2E specs outside owns that read the old rule: `tests/e2e/combat-vision.spec.ts` (~line 165, "NIGHT 7, Nautical Dawn
  = day": still passes the token check, since dim shows tokens) and `tests/e2e/visual/C8.spec.ts` (~line 102 comment,
  "Nautical Dawn, day"; screenshots there will now show the dim tint).

- `tests/convex/combat-riders.test.ts:556` ("inSightOfAdversary reads the map's line of sight …") fails after dcm-p40: it
  builds a new Witherwild campaign, which starts at DAY day 1 (Dawn), now dim, so the enemy sees the rogue only dimly
  and `inSightOfAdversary` is false (DA18: dim light asks for the Finesse roll). This is expected behaviour, not a bug.
  The fix is in the test (not lane M's file): set the arena's campaign time to a bright day (for example DAY day 3)
  before `loadScene`.

## Checks

- `pnpm typecheck`: clean. ESLint on every changed file: clean (a full `pnpm lint` timed out at load average 98).
- `pnpm test`: 51 failures on the first run were 15 s timeouts at load 98. A rerun of those 26 files at load about 22
  leaves only the combat-riders test above.
- `tests/e2e/lane-m-time-of-day.spec.ts` (ports 3167 / 3446): 2 passed.

## Follow-ups

- dcm-klr8: dcm-bxp.84 (per-object light override) needs `convex/lib/validators/combatMaps.ts`, `convex/combatMaps.ts`
  and `src/lib/combat-map/sprites/objects.ts`.
