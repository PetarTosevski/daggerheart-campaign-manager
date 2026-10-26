# TASK-D5-T6: Tiered equipment, subclass ranks and the multiclass view

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T6 (wave 2).

## What changed

- `src/lib/srd/index.ts`: `WEAPONS` and `ARMOR` are now Tier 1 (`equipment.ts`) plus Tier 2-4 (`equipment-tiers.ts`), so `getWeapon`, `getArmor` and every importer of `@/lib/srd` see all tiers. The wizard still filters to Tier 1 (`wizard-logic.ts`, `tier === 1`).
- `src/lib/domain/characters/derived.ts`: `subclassBonuses(sheet)` sums the always-on numeric subclass features of the cards held (foundation, plus specialization and mastery by `subclassRank`, plus a multiclass foundation card). `derivedDefense` adds the Evasion bonus (`subclassEvasion` returned separately for the label); the new `derivedThresholds(sheet)` returns armor base + level + subclass bonuses.
- Page one: the weapon and armor pickers list the merged tables filtered to the character's tier or lower (same rule as `assertEquipment` in `convex/characters.ts`); the selects got the accessible names "Primary weapon", "Secondary weapon" and "Active armor". Thresholds come from `derivedThresholds`, and the labels show "+N subclass" for Evasion and thresholds.
- Page three: specialization unlocks at `subclassRank` specialization, mastery at mastery; with a multiclass and no mastery, the mastery card shows "Crossed out: you multiclassed". When `multiclass` is set, two cards follow: the second class's class features with the chosen domain, and the chosen subclass's foundation card (with its Spellcast trait).

## Always-on subclass bonuses (decision 11)

| Subclass | Card | Bonus | Source |
|---|---|---|---|
| Stalwart | Foundation, Unwavering | +1 thresholds | CB 36 |
| Stalwart | Specialization, Unrelenting | +2 thresholds | CB 36 |
| Stalwart | Mastery, Undaunted | +3 thresholds | CB 36 |
| Nightwalker | Mastery, Fleeting Shadow | +1 Evasion | CB 42 |
| Winged Sentinel | Mastery, Ascendant | +4 Severe | CB 45 |
| Juggernaut | Foundation, Rugged | +3 Severe | HF 10 |

Ranks add up: CB 110 says to "Take the next card for your subclass", and the earlier cards stay, so a mastery Stalwart has +6. Every other subclass feature stays text. Full automation is a follow-up bead (see the report).

## Book references (re-checked)

- CB 109: "Tier 1 encompasses level 1 only. Tier 2 encompasses levels 2–4. Tier 3 encompasses levels 5–7. Tier 4 encompasses levels 8–10."
- CB 115-125 (primary and secondary weapon tables) and CB 126-127 (armor tables): "Players can choose one Tier 1 … The GM can make other weapons available throughout the campaign as the PCs level up." The plan cited CB 112-123; the armor tables are on 126-127.
- CB 36, Stalwart: "Unwavering: Gain a permanent +1 bonus to your damage thresholds." / "Unrelenting: Gain a permanent +2 bonus …" / "Undaunted: Gain a permanent +3 bonus …"
- CB 110: "When you choose to take an upgraded subclass card: Take the next card for your subclass. If you have only the foundation card, take a specialization. If you have a specialization already, take a mastery."
- CB 111, Multiclassing: "choose an additional class, select one domain from that class, and gain access to their class feature … then choose a foundation card from a subclass of your choice." "you must cross out one available 'take an upgraded subclass card' option … meaning you can't gain the mastery card for any subclass."

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `tests/e2e/equipment-tiers.spec.ts` (with `character-sheet.spec.ts`). The level-5 e2e case calls T2's `levelUp.correctLevel` and skips itself until that function exists.
