# Overnight defaulted questions (2026-10-31)

The user went to bed and asked: take a default on every open question; ask on return whether to keep or change it.

| # | Bead | Question | Default taken | Where it is in the code |
|---|------|----------|---------------|-------------------------|
| 1 | dcm-cfpv | Perfect Recall became an automatic recall discount (rider), but the Hand / moveCard do not pass recall riders yet, so until dcm-cfpv lands the player loses the old manual button. Keep the rider now or keep the button until dcm-cfpv? | Keep the rider (data is right; dcm-cfpv wires it) | src/lib/srd/feature-effects/bard-wizard.ts |
| 2 | dcm-bxp.99.19.52 | A rogue already Cloaked by Vanishing Act before this deploy has no source marker, so it acts as an ordinary Cloaked (an attack ends it) until it ends. Migrate old data, or accept it? | Accept, no migration (it ends at the next rest anyway) | convex/lib/combatMovement.ts sourcedCloak |
| 3 | (SRD-C2) | Tempest / Hurricane: "choose a direction the wind is blowing" - how is the direction picked? | One of the eight map directions (N, NE, E ... NW) | src/lib/srd/card-effects/sage.ts Tempest |
| 4 | dcm-903q | Lead by Example: does "the next PC to make an attack" include the caster? | Stays a manual step (table decides) until answered | src/lib/srd/card-effects/valor.ts |
| 5 | dcm-lezi | 21 narrative manual steps (Dark Whispers, Final Words, Natural Familiar ...) have nothing to automate. Close as won't-fix? | Left as P4 bead, steps stay manual | docs/tasks/TASK-LN-SRD-C2.md |
| 6 | dcm-trz9 | The Weight of Opulence (Catrin, HF p.81): "lose a Hope for each bag of gold ... If the PC loses their last Hope or has no Hope to lose, they mark Stress instead." One Stress or one per bag? Does losing the last Hope also mark Stress? | Stays a manual step (GM decides) | src/lib/srd/adversary-effects/t3-hf.ts |
| 7 | dcm-6rke | Power Slide (Xero, HF p.97) / Fire Beam (Adonix, HF p.96): "take Severe / Minor damage" with no number or type. Damage equal to the PC's threshold (armor can reduce) or 3 / 1 HP marked outright? Physical or magic? | Stays a manual step (GM decides) | src/lib/srd/adversary-effects/t4-hf.ts |
| 8 | dcm-bxp.99.19.39 | Dark Cloud (CB p.42 "covers any area within Close range"): you asked to confirm the radius. Built: placed at a point within Close, radius Very Close. | Very Close radius (your 2026-10-29 answer) | src/lib/srd/feature-effects/ranger-rogue.ts |
| 9 | dcm-9z2z, dcm-a9c, dcm-yd5h, dcm-erhv | SRD-C1 switched some cards (Confusing Aura, Avatar of Terror, Time Lock endEffect; Rune Ward exhaust; Breaking Blow rider; Flight/Invisibility token end) to data the server does not act on yet, so their old manual reminder no longer shows until those engine beads land. Other SRD tracers kept the manual step in that case. Keep, or restore the reminders until the engine lands? | Keep (engine beads are next; listed in TASK-LN-SRD-C1.md) | src/lib/srd/card-effects/{arcana,codex,blade}.ts |
| 10 | dcm-gzmo | Mysterious Mist (CB p.332): "a thick fog ... in a stationary area within Very Close range. The fog heavily obscures this area": how big is the area, and does "heavily obscures" block sight? | Stays a manual step | src/lib/srd/card-effects/codex.ts |
| 11 | dcm-72qk | Four readings built for tier 1-2 adversaries: (a) Covered in Spiders: the PC picks Stress or the GM gains Fear; (b) Taunted disadvantage lasts the whole Taunt; (c) Exile hits the target plus PCs the GM picks; (d) half of an odd fate roll rounds up (CB p.107). | All four as listed | src/lib/srd/adversary-effects/t1-*.ts, t2-*.ts |
| 12 | dcm-bxp.93 | An upload whose bytes are not a real png/jpeg/webp/gif is deleted after attach. Should the GM/player see a toast or feed line, or does the image just disappear (server logs it)? | Just disappears, server log only | convex/lib/files.ts rejectUpload |
| 13 | dcm-bxp.93 | A real image with the wrong label (PNG bytes recorded as image/jpeg) - reject or accept? | Reject (storage serves the recorded type; photo import sends it to the API) | convex/lib/files.ts checkUploadBytes |

## Answers 2026-10-31 (batch 1-2)
- 3 Hurricane: eight map directions (kept).
- 4 dcm-903q Lead by Example: other PCs only.
- 5 dcm-lezi / dcm-by2d narrative steps: keep open as P4.
- 6 dcm-trz9 Weight of Opulence: each bag a Hope, each unpaid bag a Stress.
- 7 dcm-6rke Severe / Minor damage with no number: mark 3 / 1 HP outright.
- 8 Dark Cloud: Close radius by default, GM can draw it (change from Very Close).
- 10 dcm-gzmo Mysterious Mist: point within Very Close, Very Close radius, blocks sight.
- 11 dcm-72qk: (a) player picks via a two-half popup, (b) until next successful attack, (c) whole party, (d) round up (book convention).

## Answers 2026-10-31 (batch 3-4)
- 1 Perfect Recall: keep the rider; build dcm-cfpv in wave 8.
- 2 Old Vanishing Act Cloak: write a migration (dcm-3ias).
- 9 Silent reminders: restore them until the engine lands (dcm-s9md).
- 12 Bad upload: toast to the uploader; 13 wrong label: accept and fix the type (dcm-vqs0).
- AoE visuals: generated sprites per kind, list in .omc/plans/aoe-sprites.md (dcm-7mwl).
- E1 Q1 die bonus: no crit, tie after the bonus is with Fear (dcm-jog, dcm-3ou).
- Words of Discord: remember for the whole campaign (dcm-c75).
- GM-controlled PC: GM moves and attacks with the token (d20 + PC weapon); Weredrake swaps stat block (dcm-idz).
- Spirit Weapon: per-attack check box "Use as Spirit Weapon" enables reach Close, extra target for a Stress, Sacred Resonance (dcm-xbtw).
| 14 | dcm-u2wx | When the GM approves a feature use, the approval keeps no map square, and walls cannot be drawn yet: for a wall or a point area without a square, the feed says "place ... on the map by hand". OK? | Accept for now (the area overlay in wave 9 adds drawing) | convex/combatFeatures.ts |
| 15 | dcm-3ias | Migration: a Cloaked Nightwalker rogue whose Vanishing Act use can't be found in the last 20 feed rows stays an ordinary Cloaked (safe default). Give every Cloaked Nightwalker at mastery the marker instead? | Feed-checked only | convex/migrations/vanishingActMarker.ts |
| 16 | dcm-3ias | A rogue who rested since Vanishing Act but is still Cloaked (old behaviour) stays an ordinary Cloaked. Remove that Cloaked instead? | Leave it as ordinary Cloaked | convex/migrations/vanishingActMarker.ts |
| 17 | dcm-3ias | Running the migration on the dev and production deployments (npx convex run migrations/run:run '{fn: "migrations/vanishingActMarker:addMarker"}', dry run first). | Not run - needs your go-ahead; run after the C2 deploy | docs/tasks/TASK-LN2-MG.md |
| 18 | (E5) | Shield Wall (CB p.212): a guard with no linked guard - no line, so +0; with a line the count includes the first guard. OK? | As described | src/lib/domain/combat-actions/numbers.ts |
| 19 | dcm-q3t1 | Otherworldly Ire (HF p.15): the Favor is paid by the use, not at the roll, so a roll the player abandons costs nothing. Should the roll pay instead? | Paid by the use | convex/featurePrompts.ts |
| 20 | dcm-vf7i | A gold gift to a PC already at the gold cap (CB p.104) refuses the whole use, rather than dropping the extra gold. OK? | Refuse the use | convex/lib/featureRunner.ts |
| 21 | (E1) | A dice-dialog roll marked "attack" counts as a non-weapon attack, so endings tied to a weapon attack (Menacing Reach) only fire from the map's weapon attack. OK? | Yes | convex/lib/rolls.ts |
| 22 | (E4) | Wings of Light / Pin carry: an explicit carry list on a move; each carried token must be within Melee of the mover, and players may carry any PC token. OK? | As described | convex/combatAreas.ts |
| 23 | (E4) | A GM drag that breaks an area hold or move limit goes through with a warning; a player's move is refused. OK? | As described | convex/combatAreas.ts moveRules |
| 24 | dcm-idz | GM-controlled PC with a weapon whose trait is "choice" attacks with its highest trait. OK? | Highest trait | convex/adversaryActions.ts gmControlledAttack |
| 25 | dcm-idz | A GM-controlled PC's spotlight doesn't count toward the GM turn's spotlights (a second costs no Fear). Should it count? | Doesn't count | convex/adversaryActions.ts |
| 26 | dcm-fbsr | Unstuck on Armor Slots: 2 slots marked for one slot's benefit, capped at a full track. OK? | As described | convex/lib/incomingHits.ts |
| 27 | dcm-kvx4 | Burrowing Leechpoles' damage bonus is added before resistance halves the damage. OK? | Before resistance | convex/lib/incomingHits.ts |

## Answers 2026-10-31 (batch 5-7, items 14-27 and older E5 Q3)
- 14 Wall / point area from a GM approval: feed note, place by hand (kept).
- 18 Shield Wall: lone guard +0, line counts the first guard (kept).
- 19 Otherworldly Ire: Favor paid AT THE ROLL, no backing out (change, dcm-atiu, E8.3).
- 20 Gold gift over the cap: offer the excess to a nearby party member under the cap, else drop it (change, dcm-i5e1, E8.3).
- 21 Dice-dialog attack: ask which weapon (change, dcm-6qrn, E1.3b).
- 22 Carry list (kept). 23 GM drag warned, player refused (kept).
- 24 GM-controlled PC 'choice' weapon: the GM picks the trait each attack (change, dcm-grqt, E7.3).
- 25 GM-controlled PC spotlight doesn't count (kept).
- 26 Unstuck Armor Slot: needs two free slots (change, dcm-3m5k, E2.3).
- 27 Leechpoles before resistance (kept).
- E5 round-1 Q3 gold units: handfuls, bag = 10, bag steps take whole bags (kept).
