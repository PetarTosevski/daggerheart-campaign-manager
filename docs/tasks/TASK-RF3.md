# TASK-RF3: Combat Training only on physical damage

Status: Review. Plan: `.omc/plans/rules-fixes.yaml`, tracer RF3 (wave 1). Decision 25, settled by CB 48: "Combat
Training: You ignore burden when equipping weapons. When you deal physical damage, you gain a bonus to your damage
roll equal to your level."

## What changed

- **Types** (`src/lib/domain/class-features/types.ts`): `RollOption.physicalOnly` marks an option that only applies to
  physical damage; `WeaponOverride.damageType` (`"physical" | "magic"`, unset = physical) states an override's damage.
- **Warrior** (`src/lib/domain/class-features/classes/warrior.ts`): Combat Training is `physicalOnly`.
- **Server** (`convex/rolls.ts`): `prepareDamage` resolves the damage source first, asks `magicDamage` whether it deals
  magic damage and drops `physicalOnly` options for a magic source before `applyRollOptions`. No new argument: the
  server reads the type from what it already has.
  - Weapon: the weapon's `damageType` (SRD). `"either"` (Shadowblade family: "you can deal physical or magic
    damage") counts as physical, so the bonus applies.
  - Override: its `damageType`; Brawler's Strike (the only one) leaves it unset, so physical.
  - Ikonis: physical; moot, since Motherboard has no Combat Training (CB 295).
  - Custom dice: physical (documented minimum, no new option in the dice box).

## Deliberate choices

- Combat Training is an auto option, so the dice box never sends its key; the server drops it on its own for a magic
  source and the dice box needs no change for the roll to be right.
- The dice box (`src/components/party/dice/dice-box.tsx`, not owned) still lists "Combat Training +N (always)" for a
  magic source. To match, it would filter `options` with `!(o.physicalOnly && magicSource)`, where `magicSource` is the
  selected weapon's `damageType === "magic"` or the override's `damageType === "magic"`.

## QUESTIONS

1. "Either" weapons (Shadowblade, Ghostblade): treated as physical (bonus applies). Should the player choose per roll?
2. Custom dice: always physical. Is a "magic" toggle for custom damage wanted?

## Verification

See the tracer report (lint, typecheck, unit and convex tests).
