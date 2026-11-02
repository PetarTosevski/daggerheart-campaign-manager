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
- 15 Migration, untraceable Cloaked: stays ordinary (kept).
- 16 Migration, Cloaked that outlived a rest after Vanishing Act: REMOVE it (change, tracer MG2, lane3-mg2).
- 17 Run the migration: dev now (after MG2 merges), production after the next deploy (confirm with the user first).
- E6 round-1 Q1 Slumber "takes damage": only when at least 1 HP is marked (change, sent to E2.3 and E6.3).

## Answers 2026-10-31 (wave 9 round 1-2, after the crash)
- CT Q1 End day location: as built (kept).
- CT Q2 End day also resets time of day to Day (change; built in CT).
- CT Q3 Witherwild forward day-icon jump counts as ended days (change; built in CT).
- CT Q4 Undo of End day rolls the day back too (change; not in CT owns -> dcm-jq4b).
- E2 Q1 Money Talks under Unstuck: a handful per HP actually marked (kept).
- E2 Q2 Hope instead of forced HP under Unstuck: 2 Hope per HP (kept).
- E2 Q3 "Took damage" / severity: severity follows the HP actually marked after armor (Major = 2 HP, Severe = 3 HP); armor that reduces the damage reduces the severity. Fragile Beastform and the Severe stance drop follow it (check E2.3's build at merge).
- S4 Q2 Fire Beam: Fireproof makes an Emberkin immune (change -> bead).
- S4 Q1 Lava is fire (kept). S3 Q1 Oozes fire, Sear / Mana Beam not (kept).
- S3 Q2 Standard attacks get a damage keyword; Elemental Blast, Burning Candlestick, Spirit Flame are fire (change -> bead).
- CT Q5 End day clears instances in running encounters only (kept).
- E6 r1 Q3 Store the caster on a sheet effect (change, widen -> migrate -> narrow -> bead).
- E6 r1 Q5 Reliable Backup: the player confirms "in conversation" on a Presence Roll (change -> bead).
- E6 r1 Q6 Marked for Death names its assassin; only that PC's effect ends (change -> bead).
- MG2 The Vanishing Act migration writes a feed line "Cloaked ends (Vanishing Act)" when it removes a stale Cloaked (change -> bead).

## Answers 2026-10-31 (wave 9 new questions, round A)
- E1.3a Q1 Cloaked: attacks end Cloaked automatically; any other action roll by a Cloaked rogue that targets an enemy pops a GM prompt "Does Cloaked end?" (change -> bead).
- E1.3a Q2 Unconscious toggled by hand drops Cloaked (kept).
- E1.3b Q1 Multi-target attack: compare the one roll per target with that target's own advantage / disadvantage (change -> bead).
- E1.3b Q2 Lead by Example: any PC except the one who used it can take the benefit (change -> bead).

## Answers 2026-10-31 (wave 9 new questions, rounds B-D)
- E1.3b Q3 Bearer riders on a PC's own rolls run automatically (change -> dcm-l1er).
- E7.3 Q1 Forced PC attack: a roll request opens the player's attack with the target locked (change -> bead).
- E7.3 Q2 Buy-offs: GM pays before the roll, default unpaid (kept).
- E6.3 Q1 Last-HP cap keeps the hit's Severe (kept). E6.3 Q2 Doubled Minor (2 HP marked) counts as Major (kept, as built).
- E4.3 Share the Burden over marked Stress: cap (kept; dcm-io4m closable).
- E8.3 Q2 Otherworldly Ire: ALL the use's costs are paid at the roll (change -> bead).
- E8.3 Q3 Locate Soul Echoes on short and long rests (kept). E8.3 Q1 excess gold to nearest PC with room (kept, matches answer 20).
- S2 Q1 Fireproof on an untyped hit: offer it to the GM to decide whether the hit is fire (change -> bead).
- S2 Q2 Manipulate Magic reach: picked at setup, widens the attack's targets (kept, dcm-lbai).
- AO Hand-drawn areas may be GM-owned (no PC caster): widen combatAreas.characterId to optional (change -> bead).
- E4.3 An area never runs its steps on its owner's own token (kept).

## Answers 2026-11-01 (wave 10 tracer questions)
- E6.4 Two assassins on one adversary: a GM Fear spend clears only the mark paid for; the tag stays while another mark names the instance (kept).
- E4.4 Circle of Power ends when the witch is outside by any means (forced move, GM removal); undo of the last token's spend restores it (kept).
- E7.4 Bramble escape: the PLAYER rolls Encumber's Finesse Roll in the app; success removes the tokens and fires Drain and Multiply (change -> dcm-d3nj).
- E7.4 Severity of HP marked on an adversary instance follows HP marked (1 Minor, 2 Major, 3+ Severe), as for PCs (kept).
- E1.4a The GM Cloaked prompt is labelled with the card / feature name (kept).
- E2.4 Fireproof GM ask only when the data can't settle the keyword (kept). Fireproof blocks damage only; riders still land; redirected hit asks on the first target (kept).
- E1.4b Forced attack's GM-chosen target skips the range sanction; an attack without a Lead by Example pick uses it up, first option preselected (kept).
- E1.4b Bearer riders follow each condition's wording (before / after the roll), not all before (change -> bead).
- E8.4 Weapon Specialist: ask the player before spending the once-per-long-rest reroll of 1s (change -> dcm-bdu7).
- E8.4 Vitality: recall from the vault is blocked; it shows as Permanent (change -> dcm-o03c).
- S3.4 Beguile (HF p.75): on each roll with Fear the player picks Stress or the attack (two-half popup); the attack opens a forced-attack request at the Gobstalker's chosen target (change -> bead).
- S4.4 Immovable Object (CB p.230): only moves caused by an attack are shortened; Hold the Line and other non-attack moves keep their full range (change -> bead).
- S2.4 Otherworldly Ire: a sheet action right after taking damage, enemies only (kept).
- S1.4 Eclipse stays on the square where it was cast (kept). Through Your Eyes / Sensory Projection end on another spell card only (kept).
- S1.4 Veil of Night: placed as built, and the GM can redraw / thicken the veil by hand after it's placed (change -> bead).
- S2.4 Bird's-Eye View: the druid picks which allies get the advantage (change -> dcm-q9wc / dcm-rao5). Unused advantage ends with the scene.
- S2.4 Contacts Everywhere supply item: the player names the item, it lands in inventory, the GM can edit it (change -> bead).

## Combat HUD 2026-11-02 (overnight run, waves 2-9)

Defaults taken while the user was asleep; each is reversible. Confirm or change on return.

### Wave 2
- H1.1 Armor pips on banners show slots LEFT (as the boards draw them); text says "n of m marked". Alternative: show marked, like Stress.
- H1.1 / H1.S The GM's banner stays one button (opens the sheet); the GM hands the spotlight back from the spotlight panel under the Fear banner, not a banner menu.
- H1.2 GM "Dice" rolls for the selected PC token, otherwise shows a hint. Alternative: a plain GM roller, or no GM Dice.
- H1.2 Core campaigns (no campaign time): the disc shows the light only, no "Week n · Day n" and no End day. (Same as HD1's open question 1.)
- H1.3 Cloaked, Unconscious and Distracted have no board icon: their token badge shows the first letter for now.
- H1.3 Clicking your own token opens your sheet until H3.4; from H3.4 it opens the action ring (the plan's answer 3b).
- H1.S End scene does NOT clear the spotlight (it stays until the GM moves it). CB p.100 / p.107.
- H1.S moveToGm (bead dcm-bxp.99.32.4) fires only during a running encounter, not on every action roll. CB p.149.
- H1.S The GM playing for a PC ("Play for this character") is never refused by the spotlight rule.
- Bug found: combat-vision.spec.ts fails on rebuild at Nautical Dawn ("Dim light" vs "Daylight"), dcm-aid9; not caused by the HUD.

### Wave 3
- HD2 A bare Restrained or Vulnerable on the sheet shows no duration (null), not "until cleared". CB p.102 "Clearing Conditions".
- HD2 / H2.1 Features that apply by themselves (kind "auto", e.g. Combat Training) are labelled "Passive", as the board does.
- H2.2 The hand region stays H0's left 330 / right 24 (centre ~873) instead of the board's left 700 / width 700 (centre 1050); only the open-sheet shift follows the board. Change = one rule in hud/shell.css.
- H2.2 The GM's title row and toolbar hide while a sheet is open, as the board shows.
- H2.3 The hand follows the open PC sheet: a player opening another PC's sheet sees that hand view only; the GM sees the open PC's hand, locked until "Play for".
- H2.3 Hide cards is remembered per browser (localStorage) and shares the classic hand's key.
- H2.3 Help is the app's dice count, not per-ally chips (the engine has no per-ally Help); "Can't afford" is worked out for up-front Hope costs only; drag-to-play is not in the HUD (Use plays).
- H2.1 HP and Armor pips on the sheet show what's LEFT (like the banners); the board's sheet lights HP pips for HP marked. Alternative: show marked on the sheet.
- H2.1 Players can switch conditions on their own sheet; answer 5a only named the GM. Alternative: GM only.
- H2.1 Your own sheet shows no spotlight badge when you don't hold the spotlight.
- H2.1 Lasting effects on the sheet have no End button (the GM ends them from the classic list for now).
- Bug found: age-of-umbra.spec.ts:32 finds two "Save" buttons (strict mode), dcm-3cog; not caused by the HUD.

### Wave 4
- HD3 A withdrawn request is stored as "declined" with resolvedBy = the withdrawer until the status vocabulary gets "withdrawn" (dcm-bxp.99.32.17).
- HD3 Only out-of-range uses waiting on GM approval (sanctions) can be withdrawn; a Charge waiting for the GM's Difficulty (CB p.59 / p.104) can't. Alternative: allow it too (one-line change).
- HD3 The GM's queue item just disappears on withdraw; the only notice is a public feed line "<Name> withdrew <use> waiting for the GM". Alternative: a short "withdrawn" notice in the GM's queue.
- H3.0 "Waiting for the GM" sits on the right under the Fear banner on Main (the boards show it only on CmpPromptsPlayer).
- H3.0 An interim "Attack" button (bottom right) opens a plain weapon attack until H3.4's action ring replaces it (dcm-bxp.99.32.18).
- H3.0 During a pick, tapping an ally's ring picks them instead of opening their sheet; with no pick open it still opens the sheet.
- H3.0 Allies and neutrals are never shown "Can't see" (the server's sight hints cover enemies only); if a card needs sight to an ally the server refuses and the message shows under the primary.
- H3.0 A picked out-of-range target shows "✓ GM approves" and keeps the amber ring with the GM badge (boards never show both together).
