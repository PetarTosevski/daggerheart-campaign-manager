# Area-effect sprites (dcm-lqnt overlay; user answer 2026-10-31: generated sprites for each kind)

The server already stores effect areas (`combatAreas`, AreaSpec in src/lib/domain/card-effects/types.ts):
circles (`radius` = a Defined Range, centre on the caster / a target / a point) and walls (`shape: "wall"`, a line).
Nothing draws them on the map yet. This is the art list the overlay needs.

## Format (to match the map painter)
- WebP with transparency, like public/sprite-packs/** (those are ~160 px objects).
- **Circle areas: one tileable fill texture per kind, 256 x 256**, seamless on all four sides, semi-transparent
  (the painter tiles it inside the circle and clips it), plus an optional **edge ring** (512 x 512, transparent centre)
  if the kind should have a visible border.
- **Walls: one tileable strip per kind, 256 x 64**, seamless left to right (the painter repeats it along the line).
- Mid-tone and not too busy: tokens must stay readable on top. Both map styles (Classic and sprites) use the same art.
- Optional: 2-4 frames for an animated kind (fire, fog drift), same size, named `-1`, `-2`, ...

## Kinds (grouped by look; one texture can serve several effects)

| Kind (file name) | Shape | Used by (book) | Look |
|---|---|---|---|
| `darkness` | circle | Dark Cloud (Rogue, CB p.42), Cloud of darkness (adversary), Eclipse / Veil of Night (Midnight) | thick black-violet smoke, blocks sight |
| `fog` | circle | Mysterious Mist (Codex, CB p.332) | pale grey drifting fog, blocks sight |
| `ink` | circle | Ink (underwater adversary, HF) | dark blue-black ink cloud in water |
| `silence` | circle (follows a token) | Hush (Midnight) | muted, desaturated bubble, faint ripple edge |
| `radiant-circle` | circle | Circle of Power (Seraph/Witch) | golden runic circle on the ground |
| `moonlight` | circle | Moonbeam (Witch) | cool silver-blue light pool |
| `healing-barrier` | circle | Rejuvenation Barrier (Sage) | translucent green-gold dome edge, leaves |
| `rune-circle` | circle | Rune Circle (Codex) | glowing arcane runes ring |
| `aura-fire` / `aura-earth` / `aura-water` / `aura-air` | circle (follows the caster) | Elemental Aura (Sorcerer/Druid, one per element) | ember glow / dust and pebbles / mist droplets / swirling wind lines |
| `acid` | circle | Acidic blood (adversary), Acid Bath (Burrower, CB p.210) | bubbling green acid pool |
| `suppressing-fire` | circle | Suppressing Fire (adversary, CB p.220) | streaks of arrows/bolts across the zone |
| `brambles` | circle | Bramble Patch (CB p.230), Tangle Bramble | thorny vines on the ground |
| `storm-hurricane` / `storm-blizzard` / `storm-sandstorm` | circle | Tempest (Sage): Hurricane, Blizzard, Sandstorm | wind streaks with a direction / snow / sand |
| `fire-wall` | wall | Wall of Flame (Codex, CB p.332) | line of flames |
| `force-wall` | wall | Manifest Wall (Codex) | translucent blue force panel |
| `hunger-wall` | wall | Wall of Hunger (Dread, HF p.181) | wall of dark grasping maws/tendrils |
| `fortress` | circle (damageable) | Wild Fortress (Sage, CB p.339) | woven living-wood dome |
| `generic` | circle / wall | any area without its own kind | neutral translucent tint with a dashed edge |

That is 24 textures (21 circle fills, 3 wall strips). Start with `generic`, `darkness`, `fog` and `fire-wall`: they
cover the areas that already run on the server (Dark Cloud, Cloud of darkness) and the next ones to land.

## Where to put them
`public/area-effects/<kind>.webp` (and `<kind>-edge.webp`, `<kind>-1.webp` ...). The overlay maps each AreaSpec to a
kind by its label (a small table in code), falling back to `generic`.
