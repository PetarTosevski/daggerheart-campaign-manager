# TASK-LN4-E4: areas and map visuals, round 4 (lanes-2 wave 10, tracer E4.4)

Branch `lane4-e4`. Lane `w1-e4-targeting-areas`. Changed (all in owns): `convex/combatAreas.ts`, `convex/combatTokens.ts`,
`convex/combatMaps.ts`, `convex/combatVision.ts`, `convex/lib/combatVision.ts`, `convex/lib/spriteSources.ts`,
`convex/lib/validators/combatMaps.ts`, `src/components/combat-map/drawer/use/{index.tsx,model.ts}`,
`src/components/combat-map/editor/{edit-tools-panel.tsx,use-edit-mutations.ts}`, `src/lib/combat-map/sprites/objects.ts`,
`tests/convex/lane4-e4-areas-light.test.ts`, `tests/unit/lane4-e4-picks-glow.test.ts`, this doc. No edit outside owns.

## What landed

### (1) dcm-ii4: Circle of Power ends on its last token and when its caster exits it (HF p.16)
HF p.16: "This spell lasts until the last token is removed or you exit the circle." The data (seraph-witch.ts) already
says `endsOn: ["tokensGone", "ownerLeavesArea"]`; before this tracer only the caster's own use (`applyUseEnds` →
`endTokensGone`) and the caster's own step out (`areasAfterMove`) ended it.
- **Tokens gone, any path**: `activeAreasOnMap` (every area reader: overlay `list`, vision, the runners' `inArea` facts,
  move rules, hits) leaves out an area whose spec ends on `tokensGone` while its caster holds no tokens of its source
  (`areaTokenKey`: the card id, or `feat:<featureId>`). So an ally's roll (`allyAutoRuns`), an evaded attack, or a hand
  edit of the sheet that removes the last token ends it at once without touching those lanes' files. It is a read, not a
  write: undoing the spend brings the circle back. `placeArea` ends old copies through the raw rows (`liveAreaRows`), so a
  redrawn circle never resurrects the spent one.
- **Caster exits, any path**: `endAreasOwnerLeft` (exported) ends live `ownerLeavesArea` areas whose caster's token is
  outside them or off the map, one public feed row each ("Circle of Power ends: its caster left it"). Called after a
  carry (`combatTokens.move` with `carry`), a forced move (`forcedMove`, so `pullIntoMelee` too), `combatTokens.remove`
  and `combatTokens.clear`. The caster's own step stays `areasAfterMove`'s.

### (2) AO follow-up: the feature drawer picks two squares for a wall and N for a `count` area
`pickAreaOf(use)` (drawer/use/model.ts) finds the first `point`-centred area step, walls and `count` areas included, and
says how many squares it takes (`AreaPicks`: one / wall / count with a `fixed` number or a player-chosen `choice`).
`AreaUse` asks "How many" for a chosen count (1..`MAX_PICKED_SQUARES` = the server's `MAX_AREA_COUNT`, 10), then
`pickSquaresInTurn` runs one banner pick after another (`startAreaPick` from inside `onPick`, which `finishAreaPick`
keeps running) and sends `useFeature` with `point` + `points` (`areaUseArgs`; a chosen count also goes as
`n:<choice>`). The old `pointAreaOf` is unchanged (tests/unit/area-effects-kinds.test.ts reads it). No SRD feature has a
wall or count area today (Wall of Flame and Forest Sprites are cards, whose Hand is E1.4a's): tested with fixtures.

### (3) dcm-bxp.84 + dcm-klr8: per-object light override (widen only)
- `combatObjectFields.light?: "none" | "faintglow" | "torch" | "campfire"` (`OBJECT_LIGHTS` / `objectLightValidator`
  defined in validators/combatMaps.ts; validators/spritePacks imports that module, so `SPRITE_LIGHTS` could not be
  imported back). The table takes it through `combatObjectFields`. Optional field: no migration.
- `combatMaps.get` / `live` views carry it; a map copy copies it (`...rest`).
- `objectTraits` (spriteSources) puts the override over the sprite's light trait, so `visionObjects` (vision, lights at
  night), `toggleLight`, `combatMapEdit.updateObject`'s `lit` check (`loadObjectTraits`) and combatMovement read it.
- The sprite painter's `placeObject` puts it on the art, so the glow and its bounds follow (and the canvas repaints:
  the object's JSON changes).
- New GM mutation **`combatVision.setObjectLight { objectId, light: none|faintglow|torch|campfire|default }`**: one
  field, `default` drops it (always ok), a light on an object without a sprite is INVALID. Optimistic in
  `use-edit-mutations.ts` (`setLight`).
- The editor's selected-object panel shows a Light select for sprite objects ("Default (faint glow)", None, Faint glow,
  Torch, Campfire); its light switch and "At night" reach read the override.

### (4) dcm-bxp.99.19.64 vision half
`instinctOf` already read `derivedTraits(withEffects(sheet))` (lanes E4). Now it also passes the campaign's feature
scope (`Scene.scope = featureScope(campaign)`, set in `loadScene`), as the rolls do, so a frame option that gates a
passive feature counts the same in vision as at the roll.

### Not done
- dcm-lvgm / dcm-z5a6 carry offer: the server half (`carryAlong`, `move.carry`) is in; offering the carry from a
  `casterMoves` rider needs the runners (featureRunner / cardRunner / adversary runner), not E4.4's files. Left.

## Beads
- dcm-ii4: **closable** for the area ends (tokens gone on any path, caster exiting on any path). The `inArea` gate for the
  trigger's subject is dcm-753y (separate, open).
- dcm-bxp.84: **closable** (server, painter, editor). The players' light-switch buttons in vision-layer.tsx are follow-up
  dcm-04cj.
- dcm-klr8: **closable** (same work).
- dcm-bxp.99.19.64: vision half **done** (now with the frame scope). The display halves (dice box, Attack bar) are E1.4b's
  (12) this wave; closable once those land.
- dcm-lvgm, dcm-z5a6: unchanged (see "Not done").

## Follow-ups filed
- dcm-04cj (lane:w2-map-visuals): `vision-layer.tsx` `LightSwitches` and `use-sprite-editing.ts` `traitsOf` read the
  sprite's own light, not the override (a sprite set to none still shows a switch; a dark sprite set to torch shows none).

## Data switches ready for wave 11
None needed: seraph-witch.ts Circle of Power already writes `endsOn: ["tokensGone", "ownerLeavesArea"]`, now honoured on
every path. A feature with a wall or `count` area can be written as data; the drawer places it.

## QUESTIONS
1. Circle of Power, HF p.16: "This spell lasts until the last token is removed or you exit the circle." Built the simplest
   reading: the circle ends whenever the witch's token is no longer inside it, however that happens: her own move, being
   carried, a forced move (knockback, a pull), or her token taken off the map by the GM. An ally walking out does not end
   it. Should a forced move (she did not "exit", she was thrown out) or the GM removing her token end it too? Core rule
   reading; kept as built until answered.
2. A spent circle reappears when its tokens come back (an undo of the token spend; nothing else sets those tokens but
   the use that redraws the circle). Kept, since undo should restore it.

## Merge-time actions
- **Authz entry** (tests/convex/authz/combat.entries.ts, not E4.4's): the new public `combatVision.setObjectLight` needs
  a row, else the inventory guard fails `pnpm test`. Suggested, next to `toggleLight`:
  `{ fn: api.combatVision.setObjectLight, access: "gm", args: (w) => ({ objectId: w.ids.campfireId, light: "default" }) },`
  (`default` on the setup's Classic campfire is ok for the GM; players FORBIDDEN, as the gm wrapper gives).
- Regenerate `convex/_generated` (new function `combatVision.setObjectLight`).
- No migration (optional field). No SRD data change.
