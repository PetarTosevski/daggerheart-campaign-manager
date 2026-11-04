# TASK LN-SRD-F3: SRD data, Ranger, Rogue, Seraph, Witch, Warlock

Plan `.omc/plans/lanes.yaml`, tracer SRD-F3 (lane `w2-srd-data`, wave 5). Wave 4 (E1-E8) taught the engines the widened
vocabulary (`docs/tasks/TASK-LN-V.md`) with fixture entries; this tracer switches the real entries of three files over
and checks every remaining `manual` step against the vocabulary. No types, runner or engine file was touched.

Book pages are printed pages (CB = Core Book, HF = Hope & Fear). Every quote was checked against the book text.

## Entries automated

| Entry (file) | Book | Before | Now | Bead |
|---|---|---|---|---|
| Favor (`warlock.ts`) | HF p.14: "when you succeed on an action roll with Hope, you can choose to gain a Favor instead of a Hope" | `result: "success"` + the player's check box | `afterYouRoll.result: "successWithHope"` (E1 `rollResultHolds`; a critical counts, CB p.90), no box | dcm-a9n |
| Diminish My Foes (`warlock.ts`) | HF p.15: "When you succeed with Hope on an action roll against a target" | as Favor | as Favor | dcm-a9n |
| Patron's Mantle (`warlock.ts`) | HF p.14: "have advantage on action rolls to intimidate a target" | manual step | `advantage` mod with `situation` (`MANTLE_INTIMIDATE`) in the effect (E1 `dualityFields.situations`) | dcm-733 |
| Menacing Reach (`warlock.ts`) | HF p.15: "ends when you make a successful attack with that weapon" | `endsOn: ["attackSucceeds"]` (a spell ended it too) | `endsOnRoll: { roll: "weaponAttack", result: "success", weapon: "primary" }` (E6 `rollEndHolds`) | dcm-ffk |
| Ethereal Visage, fear (`seraph-witch.ts`) | CB p.45: "When you succeed with Hope on a Presence Roll" | `result: "withHope"` (a failure with Hope matched) | `result: "successWithHope"` | dcm-nhr |
| Night's Glamour (`seraph-witch.ts`) | HF p.17: "Unless you mark a Stress to maintain your Glamour, it drops when you mark a Hit Point or deal damage" | two manual maintain reactions | `maintain: { costs: [1 Stress] }` on the Glamoured effect (E6 `endEffects` `maintainable` / `maintained`, `payMaintain`); the two reactions are removed | dcm-4qv |
| Lunar Phases, bump (`seraph-witch.ts`) | HF p.17: "Once per rest, you can spend a Hope to increase the value of this die by one. If you increase the value of a 6, it becomes a 1." | manual step, own limit key | `delegate` `lunarPhasesBump` (E8 `raiseMoonDie`, key `LUNAR_BUMP_KEY` shared with the sheet button); the use's own `limit` is dropped (the delegate's key exhausts it) | dcm-lk8 |
| Lunar Phases, New (`seraph-witch.ts`) | HF p.17: "1 New: Spend a Hope to negate Minor damage" | check box only | situation check `moonPhase: 1` (E5) | dcm-lk8 |
| Enchanted Talisman, protect (`seraph-witch.ts`) | HF p.16: "When the person holding the talisman takes damage" | window range Very Far | `unlimited: true` (Very Far kept as the fallback) | dcm-3i4 |
| Circle of Power (`seraph-witch.ts`) | HF p.16: "Remove a token each time you or an ally within the circle makes an action roll or evades an attack. This spell lasts until the last token is removed or you exit the circle." | token uses ungated; area ended by hand | both token uses require `inArea` `who: "subject"`; the roll use takes action rolls only (`roll: "action"`); the area `endsOn: ["tokensGone", "ownerLeavesArea"]` | dcm-ii4 |
| Companion (`ranger-rogue.ts`) | CB p.40: "On a success with Hope, if your next action builds on their success, you gain advantage on the roll." / "their damage roll uses your Proficiency and their damage die" | two manual steps; d6 fixed | a `nextRoll` effect on you with an `advantage` mod whose `situation` the player marks (both commands); damage dice `sidesOf: "companion"` (d6 fallback); targets `companionRange: true` (Melee fallback) | dcm-2z2 |
| Sneak Attack (`ranger-rogue.ts`) | CB p.42: "while Cloaked or while an ally is within Melee range of your target" | check box only | situation check `anyOf` [`hasCondition` Cloaked, `allyNear` Melee of the target] (E5) | dcm-85u |
| Cloaked (`ranger-rogue.ts`) | CB p.42: "Any time you would be Hidden, you are instead Cloaked." | passive with no mod | `replaceCondition` hidden → cloaked | dcm-bhp |
| Shadow Stepper (`ranger-rogue.ts`) | CB p.42: "After you make an attack or end a move within line of sight of an adversary, you are no longer Cloaked." | Cloaked ended by hand | condition `endsOn: ["bearerAttacks", "endsMoveInSight"]` | dcm-bhp |
| Dark Cloud (`ranger-rogue.ts`) | CB p.42: "create a temporary dark cloud that covers any area within Close range … You're considered Cloaked from any adversary for whom the cloud blocks line of sight." | circle of Close radius on the rogue | user answer 2026-10-29 (R2, dcm-bxp.99.19.39): centre `point`, `placeWithin: "close"`, radius Very Close (the user asked to flag it for confirmation); `perObserver: "cloaked"` | dcm-bxp.99.19.39, dcm-bhp |
| Contacts Everywhere, backup (`ranger-rogue.ts`, Reliable Backup's option) | CB p.43: "When you make a Presence Roll in conversation, they back you up." | `endsWhen` text only | `endsOnRoll: { roll: "presence" }`; "in conversation" stays the rider's check box (E6 Q5) | dcm-3ea |

Vanishing Act was already in the shape lane C2 builds against (duration `rest`, `endsOn: ["rollWithFear"]`); not
changed. Lane C2's engine work on Cloaked endings can read Shadow Stepper's new `endsOn` to tell its Cloaked apart.

## Manual steps

| File | Before | After |
|---|---|---|
| `ranger-rogue.ts` | 4 (Companion attack: advantage; Companion command: the action, advantage; Contacts Everywhere: supply) | 2 |
| `seraph-witch.ts` | 4 (Wings of Light carry; Night's Glamour maintain x2; Lunar Phases bump) | 1 |
| `warlock.ts` | 2 (Patron's Mantle intimidate; Otherworldly Ire targets) | 1 |

Left and why:

- **Companion: "Your companion takes the action you commanded."** (CB p.40) Narrative: the GM resolves what the companion
  does. Not a vocabulary gap.
- **Contacts Everywhere, supply** (CB p.43: "1 handful of gold, a unique tool, or a mundane object"): no step gives a PC
  gold or an item (`inventory` only takes). Bead dcm-vf7i (`vocabulary-gap`).
- **Wings of Light, carry** (CB p.45: "pick up and carry another willing creature"): no step moves a carried token with
  the carrier. Bead dcm-lvgm (`vocabulary-gap`).
- **Otherworldly Ire** (HF p.15: "roll that many Patron Dice and target a number of creatures within Close range equal
  to the highest result"): the vocabulary has it (`TargetCount.upTo.rolledFirst`), but `run.ts` `rollTargetCount` on
  `rebuild` takes no choices, so the Favor count can't reach the dice (E8 "not"). Kept manual; beads dcm-gov, dcm-q3t1,
  dcm-nw7h.

## Engine readiness (what the data waits on)

The data is the final shape; these server paths are open in other lanes:

- Situation checks fall back to the player's box until the facts are filled: `allyNear` / attacking weapon (dcm-aeg),
  subject areas and moon die in the feature runner (dcm-me3).
- Roll ends (`endsOnRoll`) and Glamour's maintain offer fire once dcm-wn7 / dcm-t8c land.
- `companionRange`, `DamageRoll companion` and the companion die size reaching the runner: dcm-b9hc.
- `whenAllyWouldTakeDamage.unlimited` in the reaction window: dcm-ofo.
- Areas at a picked point (Dark Cloud, Circle of Power) need the point on `useFeature` and `tokensGone`: dcm-u2wx.
- New: **dcm-i2tv** (E6): `cardRows.srdUses` / `stepEnds` don't read options added by upgrades, so Reliable Backup's
  shield and backup effects never end by themselves. The test proves the data with the upgraded entry as lookup.

## Not changed (doubts)

- Sacred Resonance / Spirit Weapon keep the player's check box: which attacks are Spirit Weapon attacks is the open
  question 1 of `docs/tasks/TASK-SD-FE-seraph-witch.md` (dcm-13s). A `weaponRange` check alone would offer them on every
  Melee attack.
- Enchanted Talisman keeps the holder's condition tag: imbuing makes no inventory item a `holdsItem` check could read.

## Beads

- Done here (left open for the orchestrator to close at merge, notes added): dcm-a9n, dcm-nhr.
- Switched in data (their engine parts belong to wave-4 lanes, still open): dcm-733, dcm-ffk, dcm-4qv, dcm-lk8, dcm-3i4,
  dcm-ii4, dcm-2z2, dcm-85u, dcm-bhp, dcm-3ea.
- Filed: dcm-lvgm, dcm-vf7i (`vocabulary-gap`, `lane:w2-srd-data`), dcm-i2tv (`follow-up`, `lane:w1-e6-endings-durations`).

## Tests

`tests/unit/feature-effects/{ranger-rogue,seraph-witch,warlock}.test.ts`: per entry, the new data runs through
`runFeature` and the engines' own readers prove it: `rollResultHolds` (success with Hope, critical, not failure with
Hope, not success with Fear), `stepEnds` + `endsOnOccurrence` (Menacing Reach: primary weapon success only; Reliable
Backup: a Presence Roll only), `endEffects` / `payMaintain` (Glamour dropped, maintainable, kept when maintained), the
`lunarPhasesBump` delegate on a sheet (6 → 1, the shared key exhausts the drawer use), `stateCheckMet` through the
requirements (Sneak Attack Cloaked / ally near / neither / unknown; Circle of Power inside / outside; moon die New), the
companion die from `dieSides.companion`.
