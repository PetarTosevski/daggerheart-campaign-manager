# TASK-LN3-S2: feature-effect data switches (lanes-2 wave 9)

Tracer S2 (w2-srd-data, branch lane3-s2). Rule: switch only data whose engine path is live at rebuild HEAD, proven by a
test through the real path (`tests/convex/lane3-s2-features.test.ts`, unit tests in `tests/unit/feature-effects/`);
otherwise keep the manual reminder and list it for wave 10.

## What landed (switched to data)

| File | Feature | Change | Proof |
| --- | --- | --- | --- |
| ranger-rogue.ts | Dark Cloud | radius `close` (user answer 2026-10-31, dcm-bxp.99.19.39); point within Close stays; GM adjust is AO's | unit (ranger-rogue) |
| heritage-hf.ts | Fireproof | check box (`situation`) dropped; hits carry the fire keyword (E2 `hitKeyword`) | unit (heritage-hf) |
| heritage-hf.ts | Know the Tide | choice max `tideTokens` (was `level`) | unit (heritage-hf) |
| classification.ts | Fireproof | label text "hits with the fire keyword" | - |
| druid-sorcerer.ts | Elemental Incarnation: Water | trigger `within: "melee"`; manual step became `markStress` on `picked` (`all`, `veryClose`, `excludeSubject`) | convex (map attack, both in and out of Melee) |
| druid-sorcerer.ts | Manipulate Magic | `target` option: `hostRange: true`; `reach` option: `modifyRoll reach 1` fold **plus** the manual reminder (see below) | unit (druid-sorcerer) |
| assassin-brawler.ts | Stance Fighter | `setStance` with `choice: "stance"` (E3 choice + E8 setStance); unpicked = refused | convex + unit |
| assassin-brawler.ts | Toxic Concoctions: Blight Seed | `stacking: "refuse"` (dcm-kkx) | convex + unit |
| assassin-brawler.ts | Toxic Concoctions: Fear Leaf | `dualityDie fear` from the host roll; the dialog's `fearDie` choice removed (dcm-d1b, dcm-n0dv) | convex + unit |
| assassin-brawler.ts | Marked for Death | condition `endsOn: ["gmSpendsFear"]`, `endFear: byTier [1,2,3,4]` (E6 `gmFearToEnd`); `endsWhen` words stay (the GM intent is dcm-kmr) | unit |
| transformations.ts | Howling Rampage | comment only: `endEffect` already applied on the feature path (E6 `applyUseEnds`) | existing tests |

Verified already data, no change: seraph-witch.ts Lunar Phases New (`moonPhase`, filled by `convex/lib/featureRunner.ts`,
read by `availability.ts`); seraph-witch.ts Enchanted Talisman protect is already `unlimited: true` (holding stays the
condition tag: imbuing makes no inventory item a `holdsItem` check could read).

## Kept manual (reminder stays; listed for wave 10)

- ranger-rogue.ts Contacts Everywhere supply gift: the plan `inventory` step is not read by featureRunner `giftsOf`
  (pinned by the convex test). Follow-up **dcm-h1y9** (lane w1-e8).
- druid-sorcerer.ts Manipulate Magic reach: the fold exists but the attack's own targets are range-checked before the
  rider. Follow-up **dcm-lbai** (lane w1-e1). Remove the manual line after it.
- beastforms.ts Armored Shell `stat armorScore`: runs in the hit window, whose actor has no stats. Follow-up **dcm-i9c1**
  (lane w1-e2; related dcm-91tx).
- guardian-warrior.ts Weapon Specialist `rerollHeld`: separate use has no held dice to reroll. Follow-up **dcm-7l0g**
  (lane w1-e3; related dcm-q40t / dcm-inou).
- guardian-warrior.ts Attack of Opportunity `anyTrait`: no server path offers a `whenEnemyLeavesRange` reaction yet; kept
  one use per trait.
- seraph-witch.ts Spirit Weapon (dcm-xbtw): engine half is E1.3b this wave; data switch is wave 10's.
- seraph-witch.ts Prayer Dice picks (dcm-ef77, E1.3a this wave): wave 10.
- beastforms.ts Bird's-Eye View `sharedGrant` (dcm-79v1): wave 10, after E1.3a/b.
- warlock.ts Otherworldly Ire count from the Favor: drawer input is combat-ui; kept.
- Perfect Recall stays a rider.

## Data switches ready for wave 10 (per file)

- ranger-rogue.ts: Contacts Everywhere `inventory` giveGold / giveItem once dcm-h1y9 lands.
- druid-sorcerer.ts: drop the Manipulate Magic reach reminder once dcm-lbai lands.
- beastforms.ts: Armored Shell `reduceDamage` by `stat armorScore` once dcm-i9c1 lands; Bird's-Eye View `sharedGrant`
  after dcm-79v1.
- guardian-warrior.ts: Weapon Specialist reroll on the Slayer rider once dcm-7l0g lands; Attack of Opportunity `anyTrait`
  once a leaves-range reaction path exists.
- seraph-witch.ts: Spirit Weapon (dcm-xbtw, after E1.3b), Prayer Dice picks (dcm-ef77, after E1.3a).
- assassin-brawler.ts: drop Marked for Death's `endsWhen` reminder of the GM Fear end once dcm-kmr's GM intent exists.

## Beads

- Done (data half): dcm-bxp.99.19.39 (Dark Cloud radius), dcm-awh / dcm-4xl data (Stance Fighter), dcm-kkx Blight Seed,
  dcm-d1b / dcm-n0dv Fear Leaf, dcm-ssf (Water), dcm-x7p `hostRange` half, dcm-78x / dcm-rm9 (Know the Tide), dcm-dv6
  Fireproof data, dcm-8bv Marked for Death data.
- Partly done: dcm-x7p (reach reminder stays, dcm-lbai), dcm-kmr (data only; intent left).
- Follow-ups filed: dcm-h1y9, dcm-lbai, dcm-i9c1, dcm-7l0g (label `s2-followup`).

## QUESTIONS

1. Fireproof on a hit with no known keyword (a standard attack, whose damage type is not stated as flame): the reaction
   is still offered and picking it is the player's confirmation. HF p.22: "You are immune to damage from magical or
   mundane flame." CB p.99: "If a target is immune to a damage type, they ignore incoming damage of that type."
   Simplest reading kept; confirm, or should only keyword-tagged fire hits offer it?
2. Manipulate Magic "Extend the spell or attack's reach by one range" (CB p.47): the option is picked after the roll in
   the current flow. Should picking reach be part of the attack setup (before targets are chosen), so the widened range
   applies to the attack's own targets? (dcm-lbai assumes yes.)

## Checks

`pnpm lint` clean, `pnpm typecheck` clean, full vitest (`--maxWorkers=1 --testTimeout=120000`): 393 files, 9583 passed
+ 1 expected fail; `tracer-guard S2` OK.
