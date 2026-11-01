# TASK-LN4-S2: feature-effect data switches round 2 (lanes-2 wave 10, tracer S2.4)

Branch `lane4-s2`, lane `w2-srd-data`, batch B (after E1.4b, E2.4, E6.4, E8.4). Rule: switch only data whose engine path
is live on rebuild, proven through the real path (`tests/convex/lane4-s2-features.test.ts`, unit tests in
`tests/unit/feature-effects/`); otherwise keep the manual reminder and list it for wave 11.

## What landed (switched to data)

| File | Feature | Change | Proof |
| --- | --- | --- | --- |
| assassin-brawler.ts | Marked for Death | condition `endsOn: ["targetDefeated", "gmSpendsFear"]` (E6.4 note); the `endsWhen` reminder is gone (rest = duration, defeat = E6.4 `endOnDefeat`, tier Fear = the GM's `combatEffects.endByFear`) | convex (real lookup: named instance ends, another doesn't, tag link, tier Fear 1 / 3) + unit |
| stances.ts | Defensive | passive `disadvantageAgainst` `on: attack`, `from: melee`, `buyOff: 1 Stress`; the auto manual step is gone (dcm-eut) | convex: GM attack from Melee rolls 2 d20s and the feed offers the buy-off; `buyOffs` paid → 1 d20, attacker marks 1 Stress; from beyond Melee → 1 d20, nothing offered |
| ranger-rogue.ts | Contacts Everywhere supply | a nested `choose` (`supply`): `gold` = `inventory giveGold` 1 handful, `item` = `giveItem` with no text (the GM's pick: a feed note, nothing written) (dcm-h1y9) | convex: `useFeature` writes 1 handful; the item writes nothing; without the pick it asks (`needsChoice`) |
| ranger-rogue.ts | Reliable Backup "backup" | the waiting effect carries `dualityDie hope d20` with `situation` "in conversation" and `endsOnRoll { roll: presence, situation }`; the `backup` rider is gone (dcm-hqk1) | convex: a plain Presence Roll keeps a d12 Hope Die and the effect; one marked "in conversation" rolls a d20 and ends it |
| beastforms.ts | Armored Shell (in your shell) | `reduceDamage` by `{ stat: armorScore, who: self }`; the manual step is gone (dcm-i9c1) | convex: retract through `useFeature`, then the window's `featureActor` + the real entry fold the sheet's Armor Score (4), no manual prompt |
| warlock.ts | Otherworldly Ire | the E8 `ire` shape: `choices favor`, Favor cost, `targets` enemy Close `upTo rolledFirst` (chosen Favor's Patron Dice, keep highest), `markHp 1` each; activation is a drawer `action` with the situation "You just took damage" (Q1) | convex: `featurePrompts.rollCount` (2 Favor, dice 1 / 2 → count 2, Favor paid at the roll), 3 targets refused, 2 targets each mark 1 HP, nothing paid again |
| seraph-witch.ts | Spirit Weapon, Sacred Resonance | both are passives with nothing to apply: the Attack bar box (`spiritWeapon`, `spiritWeaponOn`, `sacredResonance`) decides; the confirm riders and the unread `meleeWeaponRange` mod are gone (dcm-xbtw) | convex: two targets refused unticked; ticked, two targets in Close with a broadsword resolve and mark 1 Stress |
| druid-sorcerer.ts | Manipulate Magic reach | the manual line narrowed to spells ("On a spell: …"); a weapon attack's reach is widened at setup (dcm-lbai) | unit |
| guardian-warrior.ts | Weapon Specialist | comment + fallback text only: the reroll is automatic on Slayer's rider (E8.4); `slayer-ones` stays as the hand fallback (same key; `run.ts` and the E8 test read it) | existing E8.4 tests |
| heritage-hf.ts | Fireproof | comment only (E2.4: the GM decides an unsettled hit) | - |
| classification.ts | Spirit Weapon, Otherworldly Ire | labels (`how` of Ire: action) | - |

Verified already data, no change: seraph-witch.ts Prayer Dice picks (dcm-ef77): `heldDicePicks` reaches the pick
(convex: gain Hope spends the picked d4 showing 4, the other stays). At Ease: `slots.ts` already adds the Stress slot
(`"subclass:vengeance": { stress: 1 }`); a `stressMax` mod would count it twice, so no change.

## Kept manual (reminder stays)

- beastforms.ts Bird's-Eye View: tried through the real path and reverted. The copies are written (druid + picked ally)
  and the first marked roll has advantage, but the druid's copy stays: both sheets number the feature's effects from 1
  (`feat:<hash>:1`), and cardRows `endSharedGrants` skips a copy whose id equals the ended one. Follow-up **dcm-q9wc**
  (lane w1-e6). The data shape is in the entry's comment. (The lane3-e1a sharedGrant test renames the copy's id, which
  hides it.) The drawer also needs an ally pick for a feature use (combat-ui).
- druid-sorcerer.ts Manipulate Magic reach on a spell: no card path widens a spell's range. Follow-up **dcm-kc2m**
  (lane w1-e1).
- guardian-warrior.ts Attack of Opportunity `anyTrait`: no leaves-range reaction path (kept, as briefed).
- Perfect Recall stays a rider.

## Data switches ready for wave 11 (per file)

- beastforms.ts: Bird's-Eye View once dcm-q9wc lands (shape in the comment: `effect` to `selfAndAllies`, pick ally
  unlimited `any`, `advantage` on `any` with a situation, `endsOn: ["benefitGranted"]`, `sharedGrant: true`).
- druid-sorcerer.ts: drop the spell line once dcm-kc2m lands.

## Beads

- Done (data half), closable: dcm-eut (Defensive), dcm-hqk1 (Reliable Backup; non-plain roll paths are dcm-nxp4),
  dcm-h1y9 (supply gift data), dcm-i9c1 (Armored Shell), dcm-xbtw (Spirit Weapon / Sacred Resonance), dcm-lbai (attack
  half; spell half dcm-kc2m), dcm-kmr (data: no reminder left), dcm-mvoo data switch (`targetDefeated`), dcm-q3t1 /
  dcm-szfg data (Otherworldly Ire), dcm-7l0g data (nothing left: automatic reroll, fallback kept).
- Partly done: dcm-qxb6: data done; the attack path stamping `withEffectTarget` is dcm-gfi0 (E1). dcm-rao5 / dcm-79v1:
  data reverted, blocked on dcm-q9wc.
- Verified, no change: dcm-ef77 (Prayer Dice picks).
- Follow-ups filed: dcm-q9wc (lane w1-e6, endSharedGrants id collision), dcm-kc2m (lane w1-e1, spell reach).

## Edits outside owns (forced by an existing test)

- `tests/convex/lane3-s2-features.test.ts` (Contacts Everywhere pin): the real entry now asks the supply pick
  (`prompt: "choose"`) instead of the manual prompt. One assertion and its comment changed.

## QUESTIONS

1. **Otherworldly Ire's timing and targets.** HF p.15: "Once per rest when you take damage, you can spend any number of
   Favor to roll that many Patron Dice and target a number of creatures within Close range equal to the highest result.
   Each target must mark a Hit Point." The count must be rolled before the targets are picked, which the drawer does
   and the incoming-hit window does not. Built: a drawer action right after you take damage (the player ticks "You
   just took damage"), once per rest, enemies only. Confirm (a) as built, or (b) it must be a hit-window reaction (then
   the window needs a count-first roll), and whether "creatures" may include allies.
2. **Bird's-Eye View's grant (for wave 11).** CB p.33: "The first time a character makes a roll to act on this
   information, they gain advantage on the roll." Planned: the druid picks which allies may use it (any range), and the
   copies last until one is used or the GM ends them (no duration). Should every party PC get it without a pick, and
   should it end at the scene's end?
3. **Contacts Everywhere's supply.** CB p.43: "They provide 1 handful of gold, a unique tool, or a mundane object that
   the situation requires." Built: the player picks gold (written) or an item, which the GM names (a feed note, nothing
   written to the inventory). Confirm, or should the player name the item?

## Checks

`pnpm lint` (eslint on the changed files), `pnpm typecheck` clean; focused vitest (lane4-s2-features + all of
tests/unit/feature-effects): 446 passed; full vitest (`--maxWorkers=1 --testTimeout=120000`): 434 files, 10017 passed + 1 expected fail; `tracer-guard S2.4` OK.

## Merge-time actions

None: no public function, args or schema changed; no codegen needed.
