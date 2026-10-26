# TASK FE-guardian-warrior: Feature effects of Guardian and Warrior

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-guardian-warrior (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status:
Review.

Every Guardian and Warrior Hope, class and subclass feature classified combat or passive has one entry in
`src/lib/srd/feature-effects/guardian-warrior.ts` (21 of 22; Martial Preparation is out of combat, a downtime move).
The vocabulary is unchanged. What it can't express is a `manual` step or a situation, with a bead.

## User answers implemented

- **Q8 (a)** Act of Reprisal: the damaged ally is within Melee range of you (`whenAllyTakesDamage` range `melee`; the
  bonus is keyed to that adversary with `versus: damagedAlly`).
- **Q7 (a)** Unstoppable's sheet effect lasts until the end of the scene (`duration: "scene"`).
- **Q13 (a)** Battle Ritual's situation is the player's check box.
- **Q2 / combat-actions Q13, Q17** Iron Will, Partners-in-Arms, Loyal Protector and Revenge are reactions; Iron Will and
  Partners-in-Arms are tested in the adversary-hit reaction window.
- **CB p.107** Frontline Tank is repeatable (`times`); the Hope on a roll can't be repeated.

## Entries (book text: Guardian CB p.36, Warrior CB p.48, printed pages)

| Feature | Id | Activation | What runs |
|---|---|---|---|
| Frontline Tank | `hope:guardian` | action | 3 Hope, clear 2 Armor Slots; ×N |
| Unstoppable | `class:guardian:unstoppable` | action / auto / auto | `main`: delegate D5 `unstoppable` (die d4 / d6 at 1, its key `unstoppable` per long rest, Restrained and Vulnerable cleared) + effect "Unstoppable" (cannotBeRestrained, scene) + manual "can't be Vulnerable". `severity`: physical damage −1 severity while the effect is active. `grow`: target marks HP → delegate D5 `unstoppableHit`. The +die to damage stays D5's auto roll option. |
| Unwavering / Unrelenting / Undaunted | `subclass:stalwart:*` | passive | +1 / +2 / +3 to Major and Severe thresholds (each card its own mod, cumulative as `derived.ts` today) |
| Iron Will | `subclass:stalwart:iron-will` | reaction (you would take physical damage) | one extra Armor Slot |
| Partners-in-Arms | `subclass:stalwart:partners-in-arms` | reaction (ally within Very Close would take damage) | mark your Armor Slot, ally severity −1 |
| Loyal Protector | `subclass:stalwart:loyal-protector` | reaction (ally within Close would take damage) | ally has ≤2 HP unmarked (engine check); 1 Stress; move prompt; damage redirected to you |
| At Ease | `subclass:vengeance:at-ease` | passive | no mods (no Stress-slot ModStat; `slots.ts` adds it) |
| Revenge | `subclass:vengeance:revenge` | reaction (attack from Melee succeeds on you) | 2 Stress, attacker marks 1 HP |
| Act of Reprisal | `subclass:vengeance:act-of-reprisal` | auto (ally within your Melee takes damage) | effect +1 Proficiency vs that adversary, ends on your next successful attack |
| Nemesis | `subclass:vengeance:nemesis` | action / rider | `main`: 2 Hope, tag Prioritized until rest, exclusive. `swap`: on an attack against the Prioritized target (engine check), swap Hope and Fear |
| No Mercy | `hope:warrior` | action | 3 Hope, effect +1 attack until rest |
| Attack of Opportunity | `class:warrior:attack-of-opportunity` | reaction (enemy leaves your Melee) | one use per trait (reaction roll vs its Difficulty); choose 1 on a success, a second on a critical: can't move (manual), primary weapon damage, you move with them (prompt) |
| Combat Training | `class:warrior:combat-training` | auto (you deal physical damage) | +level to damage |
| Courage | `subclass:call-of-the-brave:courage` | auto (your action roll fails) | situation "with Fear" (server confirms), +1 Hope |
| Battle Ritual | `subclass:call-of-the-brave:battle-ritual` | action | once per long rest, check box; clear 2 Stress, +2 Hope |
| Rise to the Challenge | `subclass:call-of-the-brave:rise-to-the-challenge` | rider (before an action roll) | ≤2 HP unmarked; d20 Hope Die |
| Camaraderie | `subclass:call-of-the-brave:camaraderie` | passive | `tagTeamUses` +1, `tagTeamAllyCost` 2 |
| Slayer | `subclass:call-of-the-slayer:slayer` | rider ×2 | spend N Slayer Dice (pool `slayer`), roll, add to the attack roll / the damage. Storing, the Proficiency cap and the session-end Hope stay in session features (`slayerStore` prompt). |
| Weapon Specialist | `subclass:call-of-the-slayer:weapon-specialist` | rider / action | `main`: on a success, 1 Hope adds a secondary weapon die. `slayer-ones`: once per long rest, manual reroll of Slayer 1s |

## Manual steps and beads (vocabulary unchanged)

- dcm-v17: Unstoppable: no "can't be Vulnerable" flag (manual step); no number source for the die's value (D5 roll
  option keeps the damage add); D5 removing the die past its maximum does not end the scene effect (SD3 / SD8 should).
- dcm-5z3: Courage: `afterYouRoll` has no "failure with Fear" result; written as failure + situation.
- dcm-sa2: Weapon Specialist: no reroll of spent held dice; manual Use.
- dcm-fjh: Attack of Opportunity: a reaction roll takes one trait (six uses); "can't move" is manual; the critical's two
  picks can't be forced distinct. At Ease: no Stress-slot ModStat.

## Notes for the integration tracers

1. **Double counting (SD5).** D5 `rollOptions` already add Combat Training (`combatTraining`) and the Unstoppable Die
   (`unstoppable`) on map attacks (`convex/lib/combatActions.ts`). When SD5 runs this table's Combat Training auto use,
   it must drop the D5 option (or skip the auto use). Motherboard's Ikonis Training replaces Combat Training (CB p.295);
   D5 checks `scope.ikonis`, the auto use does not.
2. **Unstoppable `grow`** fires once per damage roll that deals 1+ HP to a target ("After you make a damage roll that
   deals 1 or more Hit Points to a target"), not once per target.
3. **Act of Reprisal's end** event `attackSucceeds` fires on any successful attack; the book ends it only on a success
   against that adversary. SD4 / SD5 should end it only when the `versus` creature was hit.
4. **Courage** is an auto use with a situation: the server confirms "with Fear" from the roll it knows.
5. **Default use.** Weapon Specialist's first action use is `slayer-ones`; callers pass `main` for the rider.
6. **Stalwart (SD2)** reads the three passive mods instead of `derived.ts`'s `SUBCLASS_BONUSES.stalwart` row.

## Open rulings (multiple choice; recommendation first)

1. **Stalwart thresholds stack?** CB p.36: Unwavering "Gain a permanent +1 bonus to your damage thresholds",
   Unrelenting "+2", Undaunted "+3". (a) Cumulative: +6 at mastery (today's `derived.ts`, the entries). (b) Each replaces
   the previous: +3 at mastery.
2. **When are Slayer Dice spent?** CB p.48: "When you make an attack roll or damage roll, you can spend any number of
   these Slayer Dice, rolling them and adding their result to the roll." (a) Before the roll (the entries: a toggle in the
   roll dialog). (b) After the roll, in the after-roll step (Q1).
3. **Loyal Protector's "2 or fewer Hit Points"** (CB p.36: "When an ally within Close range has 2 or fewer Hit Points and
   would take damage"). (a) 2 or fewer HP unmarked (the analysis reading, the entry). (b) 2 or fewer HP marked.

## Tests

`tests/unit/feature-effects/guardian-warrior.test.ts` (36): table coverage against the classification (21, Martial
Preparation excluded), source / owner / card against the subclass data, passives without action uses; each feature
through `runFeature` with fixed dice (Frontline Tank once and twice, Unstoppable with D5 at level 1 and 5, its severity
gate and die growth / drop-out, thresholds, Loyal Protector's HP check, Revenge, Act of Reprisal's keyed mod, Nemesis tag
and swap gate, No Mercy, Attack of Opportunity success / critical / failure with no Hope or Fear, Combat Training,
Courage, Battle Ritual's limit, Rise to the Challenge, Camaraderie, Slayer Dice on attack and damage, Weapon
Specialist); Iron Will and Partners-in-Arms in the adversary-hit reaction window (offered, folded, resolved, not offered
for magic / at Close).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-guardian-warrior`: OK.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 301 files, 7923 passed, 1 expected fail, 1 failed: the old SD0
  assertion that every group table is empty (`tests/unit/feature-classification.test.ts`, outside `owns`). On `rebuild`
  that test now checks that entries are classified instead, so the failure goes away on merge.
