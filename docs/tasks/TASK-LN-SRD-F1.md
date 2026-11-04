# TASK LN-SRD-F1: SRD data, ancestries, H&F heritage, beastforms, transformations, stances

Plan `.omc/plans/lanes.yaml`, tracer SRD-F1 (lane `w2-srd-data`), wave 5, after E1-E8. Data only: the five SRD files
switch to the wave-4 vocabulary (docs/tasks/TASK-LN-V.md) where it can say the feature; no types, runner or engine file
changed. Book pages are printed pages (CB = Core Book, HF = Hope & Fear); every quoted text was checked against
`.reference-private/text/core.txt` and `hopefear.txt`.

## Entries automated

| Entry | Was | Now | Bead | Test |
|---|---|---|---|---|
| Efficient (Clank, CB p.53) | `afterRest` reaction, manual step, check box "This is a short rest" | `timing afterRest, during, restType short` + step `downtime longMoveOnShort` | dcm-2a1 | heritage-hf: rest-time entries, `restFeaturesOfEntry` |
| Celestial Trance (Elf, CB p.56) | `afterRest` reaction, manual step | `timing afterRest, during` + `downtime extraMove` | dcm-2a1 | same |
| Oasis (Duneborne, HF p.27) | as Efficient | `timing afterRest, during, restType short` + `downtime rerollDie` | dcm-2a1 | same |
| Ignition rider (Emberkin, HF p.22) | check box "with your primary weapon" | `whenYouAttack.weaponSlot: "primary"`; only the ablaze effect check is left | dcm-ab5 | heritage-hf: `riderPhase` primary vs secondary host |
| Feed, no tokens (Vampire, HF p.39) | player-confirmed "There are no tokens on Feed" | same text + `StateCheck tokens atMost 0` (the feature's own tokens) | dcm-2g9 | transformations: 0 tokens holds unconfirmed, 2 tokens refuses even ticked |
| Feed rider | check box "A successful Fangs attack against a creature that can bleed" | `whenTargetMarksHp.fromUse` Fangs; check box only "The target is a creature that can bleed" | dcm-bn1 | transformations: `riderPhase` on a Fangs host / another use / none |
| Fangs (HF p.39) | plain trait roll | `attack: true` ("Make an attack"), so attack riders (Wolf Form) fit | dcm-bn1 | transformations: roll shape, `hostMatches("attack")` |
| Howling Rampage (HF p.40) | manual "Drop out of Wolf Form" | step `endEffect of: transformation:werewolf:wolf-form` | dcm-5fc | transformations: no prompt, plan `endEffect` |
| Kick (Faun, CB p.58), Tusks (Orc, CB p.68) | situation "The target is within Melee range" | same text + `StateCheck within melee target` | dcm-9l4 | ancestry-core: distance 1 holds, 6 refuses, no fact needs the tick |
| Devastating Strikes (Terrible Lizard, CB p.35) | same situation | same text + `within` | dcm-9l4 | beastforms |
| Grappling stance (HF p.12) | situation "The attack was within Melee range" | same text + `within` | dcm-9l4 | stances |
| Elemental Breath (CB p.54), Long Tongue (CB p.69) | trait roll vs the target | `attack: true, asWeapon: true` ("treating it as an Instinct weapon") | dcm-gvr | ancestry-core: `rollMatches("attack")`, `isWeaponRoll` |
| Eye of the Storm on an ally (Skykin, HF p.23) | ended by hand on the granter's Severe | `endsOnCaster: ["takeSevere"]` | dcm-wjv | heritage-hf |
| Fireproof (Emberkin, HF p.22) | reaction on any damage + check box | trigger `keyword: "fire"`; the check box stays until hits carry the keyword | dcm-dv6 | heritage-hf |
| Venomous Bite (CB p.32), Venomous Strike (CB p.33) | Poisoned tag + manual prompt | Poisoned `condition.mods` `bearerRider on: "acts"`, 1d10 direct physical to the bearer; prompt kept (below) | dcm-bxp.99.19.3 | beastforms |

The situation texts stay word for word where `MAP_SITUATIONS` (convex/lib/combatActions.ts) decides them from the map:
`requirementMet` reads the check first and falls back to the text when the fact is missing (Q13).
`HERITAGE_SITUATIONS.ignitionWeapon` and `.shortRest` are gone (only the heritage test used them).

## Manual steps (`kind: "manual"` in the source), before / after

| File | Before | After | Left and why |
|---|---|---|---|
| ancestry-core.ts | 0 | 0 | none (2 check boxes now engine-checked) |
| heritage-hf.ts | 1 (`restUse`, 3 entries) | 0 | none |
| beastforms.ts | 5 | 5 | Fragile (feed line; the drop-out is `beastformEndsOn`, dcm-bxp.99.19.6). Bird's-Eye View: the GM's answer is the table's (FE-beastforms "no bead"); its party-wide one-time advantage: new gap dcm-rao5. Venomous Bite / Strike: the rider is written but no bearer engine runs it yet (dcm-mm0f): dropping the prompt would silently lose the damage. Armored Shell in the shell: `reduceDamage` by `stat armorScore` would say it, but the actor's stats aren't filled (dcm-me3, dcm-gl9) and it would reduce by 0 (dcm-bxp.99.19.4, commented). |
| transformations.ts | 2 | 1 | Ephemeral's pass-through is the table's prompt (user ruling Q9 (a)). |
| stances.ts | 1 | 1 | Defensive: `disadvantageAgainst.from` / `.buyOff` exist, but passives.ts sums the mod without them and there is no pay prompt (dcm-eut, E7 "not"): the passive would give every attack disadvantage (commented). |

Other player check boxes left (no vocabulary, or fiction by the book): the social roll options (Q13), Lifespring's
water, Dedicated's principle, Feed's "creature that can bleed", Pack Hunting's "ally who acted immediately before"
and Deadly Raptor's straight-line charge, Refocus's "moment of calm".

Kept as is on purpose: `SHIFT_STANCE_EFFECT` has no `setStance` step: `combatFeatures.shiftStance` sets the stance and
run.ts would show the step as a second manual prompt (dcm-4xl). Know the Tide's `max` stays `level` (a `tideTokens`
max resolves to 0 until dcm-rs1z).

## Beads

- Finished by this tracer (data side; for the orchestrator to close): dcm-2a1, dcm-ab5, dcm-2g9. Data side also done
  for dcm-9l4, dcm-gvr, dcm-bn1, dcm-5fc, dcm-wjv (their engine parts are other lanes' follow-ups below).
- New: dcm-cqwm (Feed's hunger passive is never summed: Feed is classified `combat`, `activePassives` reads only
  `passive` features; lane E5 label), dcm-rao5 (vocabulary gap, Bird's-Eye View's shared advantage).
- Comments added: dcm-bxp.99.19.4, dcm-mm0f, dcm-9z2z, dcm-eut (what the data waits for).

## Engine follow-ups the new data waits on (existing beads)

- dcm-me3 / dcm-aeg / dcm-gl9: fill `cardTokens` (feature runner), `target.distance` (riders) and stats; until then the
  checks fall back to the player's tick.
- dcm-1kvg: feature uses with a roll take riders, so Feed / Wolf Form ride on Fangs and Kick / Tusks on Breath.
- dcm-9z2z: the server applies the runner's `endEffect` (Howling Rampage); until then the player ends Wolf Form.
- dcm-t8c: incoming hits fire `endsOnCaster` (Eye of the Storm on an ally).
- dcm-mm0f: bearer riders (Poisoned).
