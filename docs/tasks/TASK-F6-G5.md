# TASK-F6-G5: Map rules: door and light reach, catalog lights, default map style

Status: Review. Plan: `.omc/plans/followups-6.yaml`, tracer G5. Beads: dcm-bxp.130, dcm-bxp.90, dcm-bxp.89.

## dcm-bxp.130: the character next to the door or light must be one who has seen it

User answer (2026-10-22): "same character". Before this change, B4 checked two things separately: some character of the
player has seen the object, and some token of the player is within Melee. Now one character must do both. It has seen
the object (now, or explored) and has a token within Melee of it.

- `convex/combatVision.ts`: `inReach(viewers, object, seen)` takes a per-viewer "has seen" check. `toggleLight`
  passes `viewerSeesLight` (the centre is in view now, or its square is explored). `toggleDoor` and the `doors` query's
  `reach` flag go through `doorInReach`, which uses the same footprint rule as `doorSeen`. The order of refusals is
  unchanged: an object nobody has seen still answers COMBAT_LIGHT_NOT_SEEN or COMBAT_OBJECT_NOT_FOUND, and an object
  seen only by a character out of reach answers COMBAT_OUT_OF_REACH.
- Client (`src/components/combat-map/vision/vision-layer.tsx`): the light switches' `reachFrom` is now the viewing
  character's tokens (`mine`), not every PC token the player may move. The fog masks that decide which switches show
  belong to that character.
- Tests (`combat-doors.test.ts`, `combat-vision.test.ts`): the player plays Ash and Cole (XC1 extra characters). Ash sees
  the door or light from afar. Cole stands next to it with his back turned and has explored nothing, so the switch is
  refused with COMBAT_OUT_OF_REACH and the door's `reach` is false. Once Cole turns round, it works.

## dcm-bxp.90: catalog lights (Q-P1-1, Q-P1-2, Q-P1-4)

User answers (2026-10-22):

- The witch's cauldron (swamp) and the incense burner (temple) now glow faintly (`light: "faintglow"`).
  `tests/unit/sprite-catalog.test.ts` pins both in the faint-glow list.
- Everything else stays as built: the lantern on a hook (torch), the desert campfire (campfire), the crystal outcrop,
  lava bridge and fire geyser (faint glow), and glowing terrain that is always on and visible at night. The fallen
  trunk and rotting log stay 2 x 1. Dead trees stay see-through (R7).
- `docs/tasks/TASK-SP-P1.md` still lists the cauldron and incense burner under "None, deliberately". That file is
  outside G5's owns; the orchestrator can update it at merge time.

## dcm-bxp.89: default map style setting

User answer (2026-10-21): a GM setting in Settings, a slider between Classic and Sprites, that picks the style of new
maps. It defaults to Classic.

**Where it lives: per GM, in `convex/settings.ts`.** It is not stored per campaign. Settings are one `settings` row per
user (`by_owner`), and that row already holds the defaults for new campaigns (`expansions`). No campaign-level
map-style setting exists. Style is stored per map (`combatMaps.style`, switched by `combatMapStyle.setStyle`). The
bead calls it "a GM setting in Settings", and the Settings dialog is per GM.

- Schema (`convex/tables/campaigns.ts`): `settings.defaultMapStyle: v.optional(mapStyleValidator)`. This only widens
  the table: when the field is absent, the style is Classic.
- `settings.get` returns `defaultMapStyle` (always set, `"classic"` by default). `settings.update` takes an optional
  `defaultMapStyle`, one intent. `restore` replaces it: a backup without the field puts Classic back. `reset` deletes
  the row, which also means Classic. `defaultMapStyleOf(ctx, user)` is the reader for other modules.
- `combatMaps.create` reads the calling GM's default. Sprites stores `style: "sprites"` and the keyword-picked
  setting (`settingPicked: false`), the same as a first `setStyle` switch to Sprites (D7). Classic writes no `style`
  (E3: a map without a style is Classic). `combatMapGenerate.generate` lays out an existing map and already reads its
  stored style, so the scene panel's create-then-generate makes a Sprites layout when the default is Sprites.
  Duplicates and uploaded image maps are unchanged. Existing maps keep their stored style.
- Backup (`src/lib/validation/settings-backup.ts`): schemaVersion 1 widened with an optional
  `defaultMapStyle: "classic" | "sprites"`. Older backups still parse. An unknown value is refused (INVALID).
- UI (`src/app/(gm)/settings-dialog.tsx`): a "Maps" section with a Classic / Sprites slider (`role="switch"`, labelled
  "Style of new maps"), updated optimistically. The reset confirmation now mentions the map style.
- No new public function, so the matrix entries are unchanged (`settings.update` and `settings.get` keep theirs).
- Tests: `tests/convex/settings.test.ts` (default Classic, saving Sprites, other updates leaving it alone, the backup
  carrying it, older backups and reset restoring Classic, an unknown style in a backup refused);
  `tests/unit/settings-backup.test.ts` (the widened v1); `tests/convex/combat-maps.test.ts` (new maps follow the
  default, Sprites stores the keyword setting, old maps keep their style).
