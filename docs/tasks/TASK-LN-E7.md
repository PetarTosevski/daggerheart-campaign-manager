# TASK LN-E7: adversary engine, passives and attack modifiers

Plan `.omc/plans/lanes.yaml`, tracer E7 (label `w1-e7-adversary-engine`), wave 4, after V (docs/tasks/TASK-LN-V.md).
Engine and server only; SRD entries are untouched (wave 5 switches them over), so every test uses fixture entries
(`tests/unit/adversary-effects/lane-e7-engine.test.ts`, `lane-e7-server.test.ts`). Book pages are printed pages.

## What changed

`src/lib/domain/adversary-effects/run.ts`
- A follow-up `adversaryAttack` of a use with no attack roll of its own gets d20 + ATK, the dice Attack Modifier, the
  passive and the instance attack bonuses (dcm-vv2 1). An entry that wrote its own `modifier` on the follow-up keeps it
  as written (Discordant Visions, "Get Over Here!" carry the ATK there today; bead filed for the SRD lane).
- `RollSpec.halveEvasion` on the use's or a follow-up's roll halves the targets' Evasion, rounded up (dcm-xyw).
- New context `attackedRiders` (by target id; the caller filters `by`): advantage when every target of the one roll
  carries it (AR7), halved Evasion, direct damage and a damage change (`add` with type → the hit is both types,
  `multiply`, `halve`) on that target's hit (dcm-xyw, dcm-51s, dcm-346).
- `groupAttack.advantage` adds one d20 (dcm-1ch).
- Plan steps the card runner leaves as prompts: `deathMove` names its PCs in `deathMoves` (dcm-702); `revive` clears HP
  (all / half rounded up) and Stress of itself or a known creature and lifts `defeated`, listed in `revived` (dcm-145);
  `move` with `mode: "leaveScene"` lists who fled in `fled` and keeps the move prompt (dcm-icd).
- Summon prompts carry `hp` (resolved) and `duplicate`; countdown prompts carry `direction`, `onZero`, `tickOn` (dcm-145,
  dcm-m5s, dcm-bxp.78).
- A passive's `selfConditions` count for its own requirements ("While Hidden" with Hand of Glory's tokens; dcm-cdz).

`src/lib/domain/adversary-actions/features.ts`
- `adversaryStateCheck`: the V `StateCheck`s the adversary's own state answers (conditions, stat-block tokens, HP /
  Stress marked or free, `not`, `anyOf`); undefined otherwise. A `situation` requirement with a readable `check` decides
  by itself; otherwise the GM's confirmation as before. `hasCondition.lacks` (dcm-2f3, adversary side; dcm-cdz).
- `passiveSummary`: `selfConditions` (dcm-cdz), `weaknesses` (dcm-dv6), Relentless `timesFrom` (at least 1; dcm-gx1).
- `matchesTrigger` (dcm-2gn): every `RollResult` plus `failureWithHope` and `notCritical` on `pcRolls` (`RollFacts.critical`);
  `onDamaged.weaponAttack` / `.keyword` (the event must say so, like `fromAttack`); `onMarkHp.includeZero` (0 HP from a
  successful attack); `onMarkStress.stage`; `allyDefeated.allyType`; `onSpotlight.byFear`; the four V kinds `pcSpotlit`,
  `allyAttacks` (`made` matches every stage), `pcDealsDamage` (default `did`), `pcsRest`.
- Countdown helpers for dcm-bxp.78: `adversaryCountdownLabels`, `adversaryCountdownArmed` (the entry's `tickOn`, else
  the text: "ticks down when …" anything but an action roll starts unarmed; CB p.162), `adversaryCountdownName`,
  `countdownLabelBonus` ("1d6+1").

`convex/lib/adversaryFeatures.ts`
- Once per GM turn (`Limit.period: "gmTurn"`, dcm-c5h): the stored key gets `@gmTurn<N>`; `instanceUses` gives the
  runner the plain key only during that GM turn and `storedUses` drops older turns. No stored shape changes. featureAsk
  says "Used up this GM turn". `limitOf` returns the whole limit.
- `countdownTickOn(block, feature)`; `BlockFeature.countdown` (the SRD label was already there at runtime).

`convex/lib/adversaryActions.ts`
- `exclusive` uses (dcm-vkp, Judgment CB p.236): a new use takes the feature's effects and tags off every other PC.
- GM lines: "must make a death move", "flees the scene", "comes back"; summon prompts show the HP / duplicate,
  countdown prompts the direction and the event at 0.

`convex/adversaryActions.ts`
- New `startCountdown` (keyedGmMutation; dcm-bxp.78): `{ instanceId, feature, label?, characterId? }` → a dashboard
  countdown from the feature's label (Loop / Increasing / Decreasing, fixed or rolled start, "+N" on dice), Private,
  armed only for action-roll countdowns, per-PC name `<Adversary>: <Feature> - <PC>`. Needs the authz entry below.

## Beads

| Bead | State | Notes |
|---|---|---|
| dcm-vv2 runner gaps | partly | (1) done here. (2) damage cache / follow-up crit is E3's (card run.ts). (3)-(10) were done by AA2b (8: absorb folds a later plan's forced Armor Slot into the open hit). |
| dcm-bxp.78 countdown Start | partly | Server mutation + helpers done. Left (bead filed): `countdowns.sourceInstanceId` link, "End this countdown?" on defeat, the UI buttons (src/components/adversaries/** is not in E7's owns), authz entry. |
| dcm-2gn trigger narrowings | partly | Matching done. Emitting the new event facts from the PC side is E1's (convex/lib/combatActions.ts; bead filed). |
| dcm-c5h once per GM turn | done | Key suffix, see above. |
| dcm-cdz passive condition on itself | partly | Engine done; the PC attack side reading `selfConditions` is E1's (bead filed). |
| dcm-gx1 Relentless (X) | done | `timesFrom` read from the instance's tokens via passiveSummary (spotlightFearFor already prefers it). |
| dcm-702 death move | partly | `deathMove` step done. "Mark all HP" needs `NumberSource free` in numbers.ts (E5). |
| dcm-145 revive / Horde HP | partly | Revive of itself or a creature named in the use; summon `hp` passes through to the GM prompt. A defeated ally can't be named yet (resolveCreatures refuses defeated instances), summons stay GM prompts. |
| dcm-icd flee | partly | `plan.fled` + GM line; what fleeing does to the instance is a question (below). |
| dcm-xyw target-keyed attack mods | partly | Engine done (`halveEvasion`, `attackedRiders`). The server does not yet build `attackedRiders` from the PCs' tags (the tag's condition step → its `mods`); `cannotBeHidden` is a PC-side flag. |
| dcm-1ch On My Signal | partly | `groupAttack.advantage`. `name` (other adversaries) and `eachRolls` (separate rolls, combined damage) not done. |
| dcm-m5s increasing / decreasing | done (engine) | Prompt carries direction / onZero; startCountdown builds a `repeat: decreasing` countdown (countdowns-advanced R7 already resets one lower). |
| dcm-vkp one target at a time | done | Effects and tags; a standard condition has no source and stays. |
| dcm-tal count dice at or above | done (covered) | Test: Cracked Scales 3d6 → 2 Fear. |
| dcm-dv6 fire | partly | `onDamaged.keyword` matching and `weaknesses` summary; doubling on the damage side is E1 / E2 (bead filed). |
| dcm-yea immunities | partly | Flags already summed; enforcement on PC damage / forced Stress is E1's (bead filed). |
| dcm-51s riders for its condition | partly | Advantage / extra damage via `attackedRiders`; `casterSpotlit` riders, `disadvantageAgainst.situation`, `best` not done. |
| dcm-346 third-party mods | partly | `attackedRider by: "others"` via `attackedRiders`; `disadvantage.unlessTarget`, `creatureCount` not done. |
| dcm-mhn crit 19-20 | not | Card runner's `rollOnce` (E3) must read `critRange` (bead filed). |
| dcm-i55 Slash and Burn | not | Covered by vocabulary (DamageChange.add.type); the hit-type merge is the card runner's fold (E3). |
| dcm-1jg Deadly Drop | not | Needs a server hook after the PCs' next action. |
| dcm-4dc Sandstorm | not | Needs the attacker's band on the adversary attack path. |
| dcm-63j Mind Meld | not | Needs `markStress.distribution: split` (card runner) and a would-mark-Stress hook. |
| dcm-e75 Goad Them On | not | `mustAttack` on an instance; instance `disadvantage` already exists. |
| dcm-eut Defensive stance | not | `disadvantageAgainst.from/buyOff` on PC targets: needs a pay prompt in the pre-roll window. |
| dcm-gx3 evolution | not | `Mod standardAttack / features` on a permanent self effect: needs the instance effect shape widened (below). |
| dcm-idz GM control | not | A PC as a GM-controlled combatant: UI and server, unanswered design. |

## Orchestrator edits

- `tests/convex/authz/adversary-actions.entries.ts`, add:
  `{ fn: api.adversaryActions.startCountdown, access: "gm", args: (w) => ({ instanceId: w.ids.bear, feature: "Bite" }), okCodes: ["INVALID"] }`
  (the Bear names no countdown: the GM gets INVALID, which is access granted).
- Wave 5 (SRD lane): drop the ATK workaround `modifier: fixed(2)` on Discordant Visions (t1-hf.ts:1040) and
  `fixed(3)` on "Get Over Here!" (t3-hf.ts:672) together with their test expectations (bead filed).

## Validator steps (not needed yet)

Nothing stored changed shape. When dcm-gx3 / dcm-e75 store `standardAttack`, `features` or `mustAttack` on an instance:
1. widen `convex/lib/validators/encounters.ts` `instanceEffectValidator` with optional `standardAttack:
   v.optional(v.object({ name, range, damage, type }))`, `features: v.optional(v.object({ remove: v.optional(v.array(v.string())), add: v.optional(v.array(v.string())) }))`, `mustAttack: v.optional(v.literal("caster"))`;
2. no migration is needed for optional fields (absent = none); a migration only if an existing field changes shape
   (`@convex-dev/migrations`, batched);
3. narrow only if a field is replaced.

## QUESTIONS (not blocking)

1. **Halved Evasion rounding** (dcm-xyw). CB p.224 Peerless Accuracy: "On a result of 4 or higher, the target's Evasion is
   halved against this attack." The book names no rounding; elsewhere it rounds halves up ("at least half of their Hit
   Points (rounded up)", CB p.199). Built: rounded up.
2. **What fleeing does** (dcm-icd). HF p.62 Survival Instinct / Bolt, HF p.64 Cowardly: the adversary "flees the scene".
   Built: a GM line and the move prompt; the instance stays. Options: remove it from the encounter, or mark it defeated
   (counts for "when defeated" triggers?), or a Fled tag.
3. **Corpse Whisperer "half its HP cleared"** (HF p.80). Built: clears half the HP max rounded up.
4. **Rider advantage with several targets** (AR7: one roll for all targets). Built: advantage only when every target
   carries the rider (Sunsear Arrows, CB p.224: "Attack rolls made against a Glowing target have advantage").
