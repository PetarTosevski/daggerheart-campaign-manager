# TASK-F7-H1: Sprites as the default style for new maps

Status: Review. Plan: `.omc/plans/followups-7.yaml`, tracer H1. Bead: dcm-bxp.135. Builds on TASK-F6-G5 (dcm-bxp.89).

## dcm-bxp.135: Sprites when the GM has not chosen

User answer (2026-10-22): keep the Classic | Sprites switch in Settings, but make Sprites the default for new maps when
a GM has not chosen. `settings.get` defaults to `'sprites'`. A missing field means Sprites for new maps only; existing
maps keep their stored style. Restoring an old backup without the field gives Sprites. The bead also confirms, as built:
a blocked Lorekeeper composer moves to the top; an adversary's "once per session" uses with no session running reset at
encounter end; each adversary copy has its own limits.

- `convex/settings.ts`: `DEFAULT_MAP_STYLE` is `"sprites"`. Nothing else had to change: `get`, `defaultMapStyleOf` and
  `restore` already read a missing `settings.defaultMapStyle` as the default. So a GM with no settings row, or with a
  row but no field (anyone who never moved the switch), gets Sprites. A backup without the field removes the stored
  field, which means Sprites. `reset` deletes the row, which also means Sprites. No schema change and no migration: a
  stored `"classic"` stays Classic, and a missing field now means Sprites.
- `convex/combatMaps.ts`: `create` is unchanged. A Sprites default stores `style: "sprites"` and the keyword-picked
  setting (`settingPicked: false`). A Classic choice writes no `style` (E3). Maps already in the database keep their
  stored style, and maps without one stay Classic.
- `src/lib/validation/settings-backup.ts`, `src/app/(gm)/settings-dialog.tsx`: comments only. The switch reads
  `settings.get`, so it shows Sprites for a GM who never chose.
- No new public function; the matrix entries are unchanged.

## Tests

- `tests/convex/settings.test.ts`: Sprites by default, also with a settings row that lacks the field. Saving Classic
  alone, with other updates leaving it alone. The backup carries Classic. An older backup without the field restores
  Sprites, both on an account with settings and on one without. Reset gives Sprites.
- `tests/convex/campaigns.test.ts`: the default settings show `defaultMapStyle: "sprites"`.
- `tests/convex/combat-maps.test.ts`: a GM who never chose gets Sprites maps, with or without a settings row. After
  picking Classic the next map has no stored style. Maps keep their style when the setting flips either way.
- Tests written for Classic maps now pick Classic first (orchestrator option A): `combat-map-generate.test.ts` (the
  board's scene prompt is the Classic path; the Sprites path is covered by `combat-map-generate-sprites.test.ts`),
  `combat-map-generate-sprites.test.ts` (maps start Classic and switch as before), `combat-map-style.test.ts` and
  `sprite-fields.test.ts` (the D9 read). The "unusable layout" failures they showed under the new default are not a
  bug. A Sprites map asks Claude for a setting and then for a sprite layout. The stub answered both calls with the
  Classic layout JSON, which has no sprite kinds, so the cleaner rightly refused it.
- e2e: `signInAsTestGm` (`tests/e2e/fixtures.ts`) sets the signed-in account's default map style to Classic once
  sign-in completes, so the existing specs keep their meaning. Specs about Sprites still switch their maps themselves.
  A refused sign-in (the form's alert) skips this. `settings-backup.spec.ts` expects the shown backup to carry the
  account's `defaultMapStyle`.
