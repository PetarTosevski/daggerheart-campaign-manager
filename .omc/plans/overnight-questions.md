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
- H3.2 The GM's "Play for" weapon attack does not use the HUD picker yet (player only); the GM keeps Map tools.
- H3.2 The footer's Hope check counts riders' Hope costs too, so the primary greys out earlier (the server refuses a short payment anyway).
- H3.2 Advantage and Help are steppers (counts), not the board's named-helper chips: the engine takes a Help die count only.
- H3.2 The after-roll hold and Death Strike prompts stay in Map tools for now.
- H3.1 With an enemy already picked on the map, a one-enemy card opens the panel with the enemy pre-picked (Main board) instead of firing at once (the classic answer of 2026-10-23). One extra click.
- H3.1 The footer adds "if it hits" for hit-gated costs; Hope a rider spends after the roll isn't blocked in advance (CB p.90: the roll's own Hope can pay it).
- H3.1 The primary says "Cast" for spells / grimoires and "Use" for abilities.
- H3.1 The GM's Difficulty stepper starts at 10 and must be changed once before casting, like the classic empty field.
- H3.1 Creatures a rider names aren't greyed when out of the rider's own range (classic didn't either); the server sends such a cast to the GM.
- H3.3 The HUD runs every automated action / reaction feature use the sheet offers (the classic drawer showed nothing for most); a reaction used without its trigger is left to the server to refuse.
- H3.3 Circle of Power picks its square and sends a point; Shadow Stepper's point is a teleport handled as a prompt (no square picked). Confirm both readings.
- H3.3 A rider with options or numbers on a feature roll takes its first option / minimum; switching it on confirms its situations; a rider's extra targets aren't offered on a feature roll.
- H3.3 Keyboard: Enter places the next point; with all points down, Enter on a placed point confirms, Enter on another square moves the nearest point there.
- Wiring (after H3.3) Chain links reuse one pick id, so the next link replaces the session without a cancel. Cards still can't ask for n squares (only one square or a wall's two ends).
- H3.4 The ring holds 6 buttons; more features fold into a "More actions (n)" list beside the ring (not a second ring).
- H3.4 The ring shows action uses only: reactions ("React" on the sheet) and out-of-combat Uses (e.g. Commune) are not on it.
- H3.4 The ring stays open until Esc, a click on your token or on the bare map (the board shows it only while picking).
- H3.4 A locked button's reason shows on hover / focus / tap, not permanently as on the board.
- H3.4 While a forced attack waits, the ring's Attack opens a normal attack (the forced card answers the forced one).
- H3.4 Stress costs never lock a button: Stress past full marks a Hit Point (CB p.106).

### Wave 5
- HD4 The GM's confirm card doesn't offer the less-lethal place (infirmary / sent home); the GM settles it after the dice. CB p.106 / p.182.
- HD4 A player can no longer undo their own confirmed death move within the dice minute (only the GM can); before confirm, the player takes the request back.
- HD4 An edit grantee who isn't the GM also waits for the GM's confirm.
- HD4 Blaze of Glory's finish step needs no second confirm (one confirm at the move).
- Cleanup: H3.2's taller attack panel overlaps the map's Zoom out button at 1440x900 (dcm-bxp.99.32.22); the a11y check excludes it until fixed.
- H4.2 Inactive threshold tiles show 1 / 2 / 3 HP (CB p.91); the lit tile shows the engine's own count (differs only when a feature changes it).
- H4.2 Several open hits on one character: one window, oldest first, "n more after this".
- H4.2 The hit line says "n damage" (the pending hit carries no damage type) and names the attacker only, no weapon; reaction cards are compact rows, not full card faces.
- H4.3 Only the choosing player and the GM get the death outcome popup; other players read it in "Just now".
- H4.3 The player may close the death modal and reopen it from a button (CB p.106 "you must make a death move"; p.182 "make space for them to talk through their decision").
- H4.3 The "Just now" feed shows on the player view only (5 newest), hidden at 1100 px and below; the GM keeps queue + spotlight bottom-left.
- H4.1 Ally picks (e.g. Rousing Strike, CB p.343) are answered by the actor for each ally (chips on the actor's screen); the board has each ally answer on their own screen (dcm-bxp.99.32.24).
- H4.1 "+1 Hope" shows from the roll outcome alone (CB p.95), even if the sheet is already at max Hope.
- H4.1 A multi-target roll that hits some and misses others is tagged "With Hope / With Fear", not Success / Failure.
- H4.1 Damage-split rows leave out the board's Major / Minor tags (they would reveal adversary thresholds); "n left" waits on the split total (dcm-bxp.99.32.23).

### Wave 6
- H5.2 Stat block HP / Stress pips fill what's MARKED (as the board's stat block), while the PC sheet fills what's left; text "n of N marked" on both.
- H5.2 Adversary attacks: out-of-range PCs show amber "Out of range" but stay pickable (the server doesn't refuse range for adversaries; CB p.101 "Move within Close range and make a standard attack").
- H5.2 A Hidden PC in sight stays pickable for the GM with the condition shown (board: unpickable; CB p.348 Hidden gives disadvantage, not immunity).
- H5.2 Any resolved adversary action also takes the scene spotlight (combatSpotlight.gmTake), not only the "Spotlight · 1 Fear" button.
- H5.1 The GM's "Set the Difficulty" stepper starts at 12 (range 1-30); the board's 13 is sample data (CB p.104 "The GM sets this Difficulty").
- H5.1 Resolutions lists the GM's attack and adversary rows only (as the classic column); the board also shows plain rolls with Fear ("Vex rolled with Fear · +1 Fear") with Undo.
- H5.1 Not in the queue yet: "End this countdown?" (waits on dcm-pgfr's server) and adversary feature choices like More Where That Came From (the server doesn't store them; dcm-bxp.99.32.27).
- H5.1 The queue stays bottom-left (queue, Resolutions, then the spotlight panel), not top-left as the board shows (the party banners are there).

### Wave 7
- H6.1 Stress cost with full Stress: the helper locks on Stress only when a surface asks (CB character sheet: "If you ever need to mark Stress and can't, mark a Hit Point"); the board shows "Your Stress is full", the engine refuses.
- H6.1 Difficult terrain / movement roll (CB p.104 Agility Roll beyond Close): kept as an unused client-only entry. Core or frame-exclusive, and should moving onto it open the dice box?
- H6.1 Wording: refusals say "costs" ("Wall Walk costs 1 Hope. You have 0."), the action ring says "needs". Pick one?
- H6.1 SPOTLIGHT_WITH_GM reads "The GM has the spotlight. You can use reactions until it comes back." (the brief's sentence, not the server's default).
- H6.3 GM Fear controls use the sentence "This needs 2 Fear. You have 1." (brief / board), not H6.1's short "Needs 2 Fear · you have 1".
- H6.3 An Experience in the GM's attack picker that's too expensive stays disabled until the picker reopens, even if Fear rises meanwhile (the server still checks live).
- H6.3 Answering an already-answered request shows the neutral toast "Already answered · Someone already answered this." and the card drops out (no in-queue row).
- H6.2 Vault Recall stays enabled while the GM holds the spotlight (CB p.26: mark Stress equal to the Recall Cost to swap immediately).
- H6.2 A token move blocked by the GM's spotlight shows as a toast near the hand, not in the move notice above the token.
- H6.2 Uses already under way (chain links, after-roll questions, Minion offer, forced attacks) stay usable while the GM holds the spotlight.

### Wave 8
- H7.2 The phone bottom sheet starts folded (the open hand covers your token at default zoom), not on the Hand tab.
- H7.2 Edge chips for off-screen targets only point; a tap doesn't pan or pick.
- H7.2 GM at 390 px: banners scaled to 55%, title hidden, tools wrap, spotlight panel inside the queue sheet, full-screen GM sheet.
- H7.2 The player's phone strip has no day/time disc and no spotlight tag (the board shows neither).
- H7.1 Tablet map squares come from Fit zoom (71% GM / 59% player on the seed map), not a fixed 39 px per square.
- H7.1 The GM's Resolutions (with Undo) are hidden at tablet width, as GMTablet draws it.
- H7.1 The map's zoom toolbar (not on the boards) moves out of mid-map at tablet: a column bottom-left for players, a row beside the queue for the GM. Alternative: put zoom in the HUD toolbar.
- H7.1 The tablet Areas panel hangs under the Fear banner, 360 px wide (board 320 overflows).
- H7.3 On a phone the picker / result / hit sheets stand over the full-screen sheet and the GM's stat block (pickers open from them), rather than closing the side panel.
- H7.3 The hit window's footer shows Mark Armor above Take n HP (CSS order; keyboard order still reaches Take n HP first).
- H7.3 The "Ask the Lorekeeper" pill covers the bottom 68 px on a phone; the sheets keep 76 px of room. Hide the pill on the combat page at phone width?

## User answers 2026-11-02 (HUD defaulted questions)
- Pips: mixed as built (PCs left, adversaries marked); players never see adversary stats (already true: stat block GM only). KEEP.
- Wording: "needs" everywhere ("Wall Walk needs 1 Hope. You have 0."). CHANGE.
- Lorekeeper button: hidden on the combat map at phone width. CHANGE.
- Cast / Use: as built. KEEP.
- Death confirm: the less-lethal outcome is settled after the dice, as built. KEEP.
- Death undo: "If the roll has happened players can't undo rolls" - after the GM confirms (dice rolled) only the GM can undo. KEEP (as built).
- Adversary attacks out of range: amber warning, still pickable. KEEP.
- Hidden PCs: pickable for the GM, the attack rolls at disadvantage (CB p.103). KEEP; CHECK the engine applies the disadvantage.
- Ally picks (Rousing Strike, CB p.343): each ally answers on their own screen. CHANGE (engine dcm-bxp.99.32.24 first; actor picks until then).
- Withdraw: a Charge waiting for the GM's Difficulty can be withdrawn too. CHANGE.
- Conditions: players can toggle conditions on their own sheet, as built. KEEP.
- Player undo of normal rolls: answered below (GM-only once dice are rolled).
- Player undo: once dice are rolled only the GM can undo; players can still take back things that roll nothing (moves, requests, waiting uses). CHANGE (engine).
- Quick cast: a one-enemy card with an enemy already picked opens the panel pre-picked, as built. KEEP.
- Action ring: add reactions and out-of-combat uses too (fold into "More" as needed). CHANGE.
- Resolutions: add player rolls with Fear ("Vex rolled with Fear · +1 Fear") with Undo. CHANGE.
- Death modal: closable with a reopen button, as built. KEEP.
- Death outcome popup: everyone at the table sees it. CHANGE.
- Difficult terrain: no automatic roll; the GM calls for rolls. KEEP (drop the unused client entry later).
- Phone bottom sheet starts folded, as built. KEEP.
- GM Dice: a plain GM roller, plus a "for <PC>" option when a PC token is selected. CHANGE.
- Core campaigns: add the calendar (Week / Day and End day) like the frames. CHANGE (campaign-time lane).
- End scene leaves the spotlight where it is. KEEP.
- The spotlight moves to the GM on Fear / failure only during an encounter. KEEP.
- Areas panel (GM, desktop bottom-right): collapses to its header when not in use; tap to expand. CHANGE.
- Queue: stays bottom-left (queue, Resolutions). KEEP. Spotlight panel moves to the top middle under the map title / GM toolbar. CHANGE.
- Action ring stays open until Esc / your token / the empty map. KEEP.
- Phone edge chips: a tap pans the map to the target. CHANGE.
- GM "Play for" weapon attack goes through the HUD attack picker (before wave 9). CHANGE.
- Lasting effects on a PC's sheet: End button for the GM and the effect's caster (before wave 9). CHANGE.
- Shadow Stepper (CB p.43): pick the destination square within Far range and move the token there, then Cloaked. CHANGE.
- Vault Recall is locked like other actions while the GM holds the spotlight. CHANGE.
- Token badges for Cloaked / Unconscious / Distracted: simple icons in the same style. CHANGE.
- Withdraw: the GM also gets a short toast "Vex withdrew Bolt Beacon". CHANGE.
- Help: named ally chips (each helper by name, each pays their own Hope). CHANGE (engine + UI).
- Death moves (user 2026-11-03): players can't undo death moves - only the GM undoes a confirmed move, Blaze of Glory's finish and Risk It All's split. "Take it back" stays while the move waits for the GM's confirm. CHANGE.
- Spotlit adversary for players (user 2026-11-03): players learn which adversary holds the spotlight only if that adversary has been revealed to them during the current scene. Never seen this scene -> they don't know (server sends nothing). Seen earlier this scene but now invisible / out of vision / hidden -> they're told it's that adversary's spotlight (by name) even though no token is drawn. CHANGE.
- GM Play-for attack out of range: keep the 'Out of range: your call' request for the GM too (as built). KEEP.
- End lasting effects: GM, caster and wearer's player (as built). KEEP.

## Overnight 2026-11-04 (user asleep; defaults taken, ask in the morning)
- Spotlight card wording when the adversary isn't drawn: "Jagged Knife Lieutenant has the spotlight" (label, no article) vs "The Lieutenant has the spotlight".
- A player whose character has no token on the map never records "seen" adversaries; they learn them only from another player's open map.
- Config plan open questions Q1-Q32 are in .omc/plans/config-briefs.md ("Open questions") - ask all of them in the morning (Q4 clock-per-scene and Q16 owner identity block tracers R4 / AD0).
- Stray process (pid 1135271, old agent worktree next-server at ~100% CPU): RESOLVED 2026-11-04, the user approved; stopped with kill -9 (it ignored SIGTERM).
- Convex per-call load cost (dcm-uh6r): every uncached call loads a ~3.7 MB bundle (~300 ms); a HUD burst crosses the 1 s limit. Default taken: fix it before cutting over (agent splitting heavy SRD / sprite-pack / zod imports out of light functions, no behaviour change). Ask: is this also seen on the deployed Convex cloud?
- ANSWERS 2026-11-04: spotlight card uses the full label ("Jagged Knife Lieutenant has the spotlight"); seen adversaries are SHARED party knowledge (seen by any player in the scene counts for all players); the live app IS slow -> do the dcm-uh6r second pass (HUD queries into their own modules) sooner. Config answers: config-briefs.md "User answers 2026-11-04".
- ANSWERS 2026-11-04 (H8.1 questions): spotlight panel under the toolbar row, left column below 1440 px; the first map keeps the GM in Edit; HUD parts retry by themselves (2 s / 5 s / 10 s) before 'Try again'; class controls (Flying, Beastform, stances, counters) move into the HUD sheet.

## Afk 2026-11-04 (user away; defaults taken, ask later as multiple choice)
- Journal Q9 (journal-briefs.md): spotlight counts automatic only (GM can Reset, no tap +1)? Default (a) automatic only. Note: the old manual bumpSpotlight still exists server-side until JX2.
- Journal Q10: where does "Allow extra characters this session" go once the Live card is gone? Default (a) a small menu on the live-session chip in the Journal header.
- Journal Q11: where does the GM rename / re-date / mark as played / delete a session? Default per brief (see journal-briefs.md Q11).
- Journal Q13: Notes page groups and Quick keys from the design. Default per brief (see journal-briefs.md Q13).
- JD1: a session started again counts spotlight into the same per-session rows (per session, not per live window). Default: keep.
- J0: when every PC has the same spotlight count (incl. all zero), no "least spotlight" line shows. Default: keep (alternative: name everyone).
- J1: players' Log & recap also shows Threads raised and After the session (not tally / spotlight). Default: yes.
- J1: the Journal header shows the frame name (design) not the campaign name. Default: frame name (Custom frame shows its own name).
- J1: players also see "Play on the Combat Map". Default: yes.
- JD3a tally: criticals count every critical roll in the session incl. combat and death-move rolls, also ones the GM hid from the feed (undone ones don't). Default: keep.
- JD3a tally: "adversaries defeated" counts only encounters started during the session; summoned adversaries count when defeated. Default: keep.
- JD3b: undo does not roll back the Hope spent / HP marked counters (an undone Hope spend still counts). Default: keep; rollback is a follow-up (needs action-log deltas).
- JD3b: spending and gaining Hope in the same action nets out (e.g. Experience on a roll with Hope shows 0 spent). Default: keep; exact counting is a follow-up.
- JD3b: Hope lost when a scar closes a Hope slot counts as "spent". Default: keep.
- JD2: players see GM-typed log lines and encounter names in the session log (not hidden lines / GM-only rolls). Default: yes.
- JD2: the feed's "Session started / ended" rows show beside the auto stamps (the feed row carries the Wither -> Fear conversion). Default: keep both, GM can hide either.
- JD5: level-ups count only inside the live session (one taken after End won't show). Default: keep.
- JD5: party level = highest level among active characters. Default: keep (alternative: most common level).
- JD4: the same encounter can be linked to several scenes; switching a scene to non-Combat drops its encounter. Default: keep.
- JH: after End session the page stays on the session that just ended. Default: keep.
- JP1: Combat scenes can't be played from the Plan (only from the Combat Map, Q7); the playing scene gets a gold ring whatever its type; '+ Add scene' defaults to Combat; Remove scene asks no confirmation. Defaults: keep.
- JP2: the Journal encounter card has no party-size stepper (change it in Adversaries); chips use full stat block names; an Unlink button was added (not in the design). Defaults: keep.
- JS: dates follow the browser locale ("Sun, Nov 2"); deleting the newest session frees its number. Defaults: keep.
- JR: "Share with players" is dropped (Q4); the milestone isn't shown in After the session. Defaults: keep.
- JL: every roll uses a dice icon (the data can't tell a social roll); 'Show N hidden' lists hidden lines with Unhide each. Defaults: keep.
- Machine: Modern Standby put the PC to sleep at 00:27 after the 3 h screen-off timeout on AC. Suggested `powercfg /change monitor-timeout-ac 0` (asked the user).
- ANSWERED 2026-11-04: screen-off on AC set to Never (done); Journal Q9 automatic only; Q10 live chip menu; Q11 click + menu; Q12 chips; Q13 keep today's groups; undo removes tally counts (bead); count every Hope paid (bead); players see GM-typed log lines.
- Glass buttons app-wide (plan .omc/plans/glass-buttons.yaml, 17 tracers, starts after Journal JX2): 9 questions in glass-buttons-briefs.md "Questions for the user"; defaults taken = (a) for all: GM colours on every campaign page; player colours outside a campaign; character sheets left as they are (G14/G15 skipped); big gold buttons become large glass; paper pages keep ink-on-paper buttons; switches/chips grey glass with the chosen one gold, page tabs unchanged; +/- and row x small grey glass; pills take the glass shape; delete/end confirms red on both buttons.
- Config plan revised (b1c29cfc, 59 tracers). New questions N1-N11 in config-briefs.md "## Questions 2026-11-05" (owner read-only view, Journal/Share switches Off, moving browser settings, packages @convex-dev/presence + a PDF reader (N5, needs the user's OK), campaign book limits, who uploads, which PDF reader, Players button, limit requests, suspend/delete). Overnight I build only the tracers that need no answer (Part A waves 1-4, after Journal JX2) and none that add a package.
- JX1: /sessions and /notes redirect to the Journal keeping only s / stage / view / page / journal (other params dropped); the session chip reads "Session N, live: open it in the Journal". Defaults: keep.
- Revive: keeps the adversary's other conditions / effects; no public feed line for players; needs a running encounter; Minion groups choose how many come back. Defaults: keep.
- JX2: the Journal header offers no way to start a second session while one is live (B6) or to restart a played session (B7); the server still supports both. Default: leave out. The milestone button was dropped from the UI.
- Glass G0: large glass buttons use the design's Plex 17 px font, not the old Cinzel caps (headline buttons like "Choose this Frame", "+ Create character" look different). Default: follow the design.
