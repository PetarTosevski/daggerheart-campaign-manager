# lanes-2 wave 9: tracer briefs (2026-10-31)

Plan: `.omc/plans/lanes-2.yaml`, wave 9 (16 tracers, all `depends_on: []`). Written from the wave-8 task docs
(`docs/tasks/TASK-LN2-*.md`) and `bd list --status=open`. Bead bookkeeping for wave 8 is done: wave-8 progress is in each
bead's notes ("LANES-2 WAVE 8 ..."); read `bd show <id>` before you start a bead.

## Common rules (every tracer)
- Read CLAUDE.md, AGENTS.md, docs/workflow.md, the relevant parts of docs/best-practices.md, your block in
  .omc/plans/lanes-2.yaml, your lane's wave-8 doc docs/tasks/TASK-LN2-<lane>.md (and round 1 TASK-LN-<lane>.md),
  docs/tasks/TASK-LN-V2.md (which half of a bead is yours), and `bd show` of every bead you take.
- First step, before any edit: `git switch -C <branch> rebuild` (branches: lane3-e1a, lane3-e1b, lane3-e2 ... lane3-e8,
  lane3-v3, lane3-s1 ... lane3-s4, lane3-ao, lane3-ct). Then `node scripts/worktree-setup.mjs` if you run e2e.
- Owns are binding: `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml <ID> rebuild HEAD` (IDs: E1.3a, E1.3b,
  E2.3 ... E8.3, V3, S1 ... S4, AO, CT). Wave 9 moved some files between lanes (see the comment above wave 9 in the plan):
  combatFeatures.ts is E1.3a's, the Attack bar (`actions/attack/**`) is E1.3b's, `validation/characters.ts` is E5.3's.
- Never edit the three effect types.ts files (only V3 owns them) or src/lib/srd/** (only S1-S4). Missing vocabulary
  term: file a bead `--labels vocabulary-gap,lane:w3-vocabulary` and model it another way or leave a manual line.
- Skip beads labelled `combat-ui` (they wait on the user's combat UI design, dcm-bxp.99.32); keep UI changes minimal.
- A change needed in another lane's file: do your part, file a follow-up bead with that lane's label.
- Unclear rule: simplest reading that matches the book, listed under QUESTIONS in your task doc with quote and page
  (books, git-ignored: /home/petar/daggerheart-campaign-manager/.reference-private/text/core.txt and hopefear.txt).
  Never invent an unspecified mechanic: ask (QUESTIONS) whether it is core or frame-exclusive.
- A public function's args change or a new public function: tell the orchestrator the authz entry unless you own the
  entries file (AO: combat.entries.ts, CT: core.entries.ts, E6.3: features.entries.ts, E7.3: adversary-actions.entries.ts).
  Stored shapes: widen → migrate → narrow (rule 7); a migration is written and tested, never run against a deployment.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass; 16 tracers run at once, so run vitest with
  `--maxWorkers=2 --testTimeout=120000`. The auth-signup flood test is load-flaky. Only AO and CT run e2e (their own spec).
- Write docs/tasks/TASK-LN3-<ID>.md (what landed, beads done / partly done, follow-ups, data switches ready for wave 10
  per SRD file, QUESTIONS). Engine tracers: for every bead you take, say plainly "closable" or what is left.
- Commit ONCE on your branch, author petar (existing git config), NO Co-Authored-By trailer. Never push, merge or close beads.
- Final report: branch + commit; beads done vs partly done; follow-ups; data switches ready for wave 10; questions; check
  results; merge-time actions (authz entries, codegen, scripts).

## User answers that apply (2026-10-31, .omc/plans/overnight-questions.md)
- Duality-die bonus (Ill Omen, Backhanded Guidance): never a critical; the bonus only decides Hope vs Fear; a tie after the
  bonus is WITH FEAR (E1 built the roll side; E7.3 dispatches pcRolls uses, dcm-of7v).
- Words of Discord: remember a target for the WHOLE CAMPAIGN; every later cast on that creature takes -5 (dcm-c75, dcm-pg8x).
- GM-controlled PC: the GM moves and attacks with the token (d20 + the PC's weapon; "choice" trait = highest trait); the
  spotlight doesn't count toward GM-turn spotlights; Weredrake swaps to its stat block (built; UI waits for combat UI).
- Spirit Weapon (dcm-xbtw): per-attack check box "Use as Spirit Weapon": when ticked (equipped Melee / Very Close weapon)
  the attack reaches an adversary within Close, may add an extra target for a Stress, and Sacred Resonance doubles each
  matching damage die. Unticked: an ordinary attack.
- Lead by Example (dcm-903q): other PCs only. Weight of Opulence (dcm-trz9): each bag a Hope; each bag the PC can't pay
  with Hope is a Stress. "Take Severe / Minor damage" with no number (dcm-6rke): mark 3 / 1 HP outright.
- dcm-72qk: (a) Covered in Spiders: the player picks (two-half popup: Stress or the GM gains Fear); (b) Taunted
  disadvantage lasts until the next successful attack; (c) Exile: the target and the whole party; (d) half of an odd
  result rounds up.
- Dark Cloud (dcm-bxp.99.19.39): a point within Close, radius CLOSE by default (change from Very Close); the GM can draw
  or adjust the area by hand. Mysterious Mist (dcm-gzmo): a point within Very Close, Very Close radius, blocks sight.
- Hurricane wind: one of the eight map directions. Perfect Recall stays a rider (runs from moveCard since wave 8).
- Silent reminders (dcm-s9md): a card / feature switched to data the server doesn't act on yet keeps (or gets back) its
  manual reminder until the engine lands.
- Chain Lightning (dcm-q13x): every new wave of chained targets gets a fresh 2d8+4 roll.
- Campaign time (dcm-ztb8): every campaign tracks days of a week; a GM "End day" button clears all once-per-day uses; a
  week passes after 7 days and clears weekly limits. Only Witherwild keeps its unique 7-day cycles.
- Area art: generated sprites per kind (.omc/plans/aoe-sprites.md), `generic` fallback.
- Defaults kept (confirmed or not yet changed): wave-8 E1 Q1 (dice-dialog "attack" roll is not a weapon attack), E2 Q1/Q2
  (Unstuck on Armor Slots: 2 slots for one; Leechpoles bonus before resistance), E4 Q1/Q2 (explicit carry list; GM drag
  warns, player move refused), E5 Q1 (Shield Wall line of one = +0), E6 Q1 (approved wall / point area without a square:
  "place by hand"; AO's point picking and the orchestrator's sanction-point widen replace it), E8 Q1/Q2 (Favor paid by
  the use; gold gift at the cap refuses the use).

## Per tracer

- **V3** (w3-vocabulary, lane3-v3; dcm-j63t): add `{ kind: "pcEscapes"; name?: string; condition?: ConditionRef; within?: Range }`
  to AdversaryTrigger (adversary-effects/types.ts), widen only; a block in types-widen-3.test.ts. If the new member breaks
  an exhaustive switch in a file you don't own, report it (don't edit). E7.3 adds the matchesTrigger case in wave 10
  (file that follow-up with lane:w1-e7-adversary-engine).

- **E1.3a** (lane:w1-e1-triggers-rolls, lane3-e1a; card and feature use paths): dcm-m48i (card paths call applyUseEnds,
  endSpellCast, placeAreasFromPlan: this unblocks Confusing Aura / Time Lock / Avatar of Terror endEffect, Flight /
  Invisibility tokensGone, Veil of Night castsSpell), dcm-9nlr (useCard runs endAfterUse; add optional `point` / `points`
  args to useCard), dcm-76l5 (3), the card halves of dcm-79v1 and dcm-uwg1 (defeat ends from card damage), dcm-3s6e +
  dcm-1kvg (a Host around useFeature like cardWithRiders: riders and automatic uses on a feature's roll; Fangs, Elemental
  Breath; dcm-bn1 / dcm-gvr with them), dcm-ef77 (useFeature passes heldDicePicks), dcm-ego9 (Hand recall check box from
  hand.recallRiders, sends moveCard.recallRiders). Cloaked: dcm-bxp.99.19.67 (card / feature attack uses end an ordinary
  Cloaked: uncloakedByAttack / uncloakAfterAttack), dcm-bxp.99.19.68 (toggleCondition off uses withoutCondition),
  dcm-bxp.99.19.63 (deathMoves: unconscious / dead drops Cloaked in the same logged row). List which R1 / dcm-ky8b
  reminders can go after your merge (for wave 10).

- **E1.3b** (lane:w1-e1-triggers-rolls, lane3-e1b; attack and roll paths): dcm-uwg1 (caster-side ends on party sheets,
  other PCs' Marked for Death on defeat, inside the attack's group), the roll half of dcm-79v1 (endGrantedBenefit /
  endSharedGrants from rolls), dcm-c09o (PC attacks read the adversary's passive self conditions, weaknesses, immunities;
  dcm-yea / dcm-cdz / dcm-2gn PC halves), dcm-gtmp + dcm-raa ('would force HP' on the PC's own attacks), dcm-yd5h + dcm-9gw
  (PC attacks read instance-stored attackedRider / damage-taken mods via E7's `adv:` / `card:` ids), dcm-kso9 (Lead by
  Example: the next OTHER PC who attacks; dcm-7zb), dcm-mm0f / dcm-kti PC-roll bearer riders, member / observer conditions
  in the attack path (dcm-wuu memberConditionsFor, dcm-bhp observerConditions), dcm-cj8 (an attack on the Wild Fortress
  dome goes to combatAreas damage), dcm-jkhp (Attack bar trait pick for Versatile Fighter, second target), the Spirit
  Weapon check box (dcm-xbtw engine half: attack arg + Attack bar box per the answer; dcm-13s), dcm-bxp.99.19.66 (a plain
  duality / reaction roll with Fear ends Vanishing Act's Cloaked), dcm-hnbk (dice box reads derivedTraits), dcm-lfbf (pin
  the dice in combat-riders 'Kick'). Then dcm-g6t / 1o3 / 0gi / 3ft / iu4 if time allows. ALSO dcm-6qrn (user answer: a dice-dialog attack roll asks which weapon: primary / secondary / none).

- **E2.3** (lane:w1-e2-damage-window, lane3-e2): dcm-8f51 (incoming hits call endCasterAreas: Hush on majorDamage), dcm-nnbl
  E2 half (hopeReduce hit choice + prompt input; E7.3 passes reduceWith), dcm-6ju / dcm-5cn5 E2 half (fill
  `pending.grants`: Money Talks gold instead of HP), dcm-hgvx window caller (window.ts PayerState.flags from the PC's
  mods), the R1 finding (a card answered in the window logs `manualWords(plan)` like a feature answer), dcm-bxp.99.19.60
  (batched migration clearing targetCount.expiresAt in convex/migrations/targetCountExpiresAt.ts; do NOT narrow yet).
  Also the sanction payload `point` widen (dcm-6y00 (2)) in validators/combatRequests.ts, optional, widen only; E1.3a or
  the orchestrator wires sanction to read it after merge. ALSO dcm-3m5k (user answer: under Unstuck an Armor Slot needs two free slots; with one free the armor option is unavailable).

- **E3.3** (lane:w1-e3-steps-saves, lane3-e3; run.ts): dcm-ldom (RunContext creatures for creatureCount), dcm-91tx
  (NumberEnv.self/target.stats from the actor; then E2 fills the window side, dcm-bxp.99.19.4), dcm-hgvx run.ts payer()
  callers + clearBlocked on clear steps, dcm-q13x + dcm-rou (each chain link rolls its own damage), dcm-bz8 (per-recipient
  choice runner half), dcm-d1b (host Hope / Fear die number), dcm-yzr (clear flying), dcm-aw16 + dcm-u4pq dialog half
  (dialog.tsx sends swapWith; Encore's trigger damage type choice), dcm-inou (limit shares WEAPON_SPECIALIST_KEY),
  dcm-0gh / q0a / 5xi / xp0 / 7az / 18i runner halves (verify). For every E3-labelled bead V2 / wave 8 marked "done
  (runner)" (kkx, 5fc, 8x8, qbn ...) say closable or what is left.

- **E4.3** (lane:w1-e4-targeting-areas, lane3-e4; cardRunner + areas): dcm-q40t (pass numbers, payers, modsOn, pointsOf,
  trigger.damageType; apply / log setStance, forcedAttack (hand to E7 prompt), changeForm, heldReroll, inventory gifts,
  exhaust, condition mods / endsOnCaster / endsOnRoll / escape / recorded / endFear, sharedGrant), dcm-m5fy, dcm-x4ft
  (per-chooser picks and chain links), dcm-gl9 (StateFacts / NumberEnv for card uses), dcm-io4m (drop CHAIN_CARDS),
  dcm-o3j (Vitality slots once; At Ease Stress slot), dcm-576v cardRunner half (rider facts distance / nearestAlly / areas),
  dcm-sc54 runCard mapping. Areas: dcm-cma (run entry steps on enter / cross), dcm-wuu, dcm-3oe + dcm-1yo (moveRules reads
  E7's structured instance moveLimit / forcedMoveReduce; a server forced-move path), dcm-v27 (duplicate token write if E7's
  summon.duplicate needs a combatTokens helper), dcm-ii4, dcm-dgu, dcm-bpr (run whenEnemyEntersRange uses: Hold the Line
  pull + Restrained, dcm-g90o engine half). The Attack bar moved to E1.3b; the overlay is AO.

- **E5.3** (lane:w1-e5-checks-limits-numbers, lane3-e5): dcm-pg8x (add "campaign" to FEATURE_USE_UNTIL in
  src/lib/validation/characters.ts, flip USED_ON_EVER to CAMPAIGN_UNTIL, expiry never ends it) closing dcm-c75; dcm-bc67
  half (limitUntil / featureLimitUntil return limitPeriod(limit); CT does the callers); dcm-753y (CreatureFacts.areas for
  who subject / target); dcm-rm9 (verify tideTokens / moonPhase resolve). Then verify each open E5-labelled vocabulary
  bead (wut, fjh, 13s, 3i4, 85u, 9l4, a7o, ttz, aym, u6z, uj0, war, 8yr, 7n7, bxp.99.19.4) and finish its E5 half or list
  what is left elsewhere.

- **E6.3** (lane:w1-e6-endings-durations, lane3-e6): dcm-kmr + dcm-6y00 (1): public keyedGmMutation (new module
  convex/combatEffects.ts) spending the Fear (gmFearToEnd: Slumber 1, Marked for Death the PC's tier) and ending the
  effect / condition on a sheet or instance in one undo group (endByGmFear / endInstanceByGmFear), its entry in
  tests/convex/authz/features.entries.ts, and a minimal GM button with an amount on the token panel's effect / condition
  list; D5 cleanup: convex/classFeatures.ts calls afterUnstoppable (dcm-v17). dcm-46q4 + dcm-iedr E6 half (a PC's
  adversary-given condition ends on endsOnCaster / endsOnRoll; store the plan's conditionDetails). Then verify the
  E6-labelled vocabulary beads against the wave-8 callers (8bv, awh, ffk, 4qv, wjv, 3ea, 0ey, cwh, b77, utu, erhv, 9z2z,
  8x8, 5fc, kkx, b9hc, 55k) and say closable or what is left. combatFeatures.ts is E1.3a's now.

- **E7.3** (lane:w1-e7-adversary-engine, lane3-e7; XL, priority order, a tail with notes is fine): (1) dcm-f70y (run
  forcedAttack, changeForm / Transform stat block, condition entry fields on instances; Words of Discord / Tentacle Rays,
  dcm-c8h3, dcm-3ag5, dcm-zi3k), dcm-n3mp + dcm-0n1u (store creature tokens on PCs / creatures and goldOf; inventory,
  save fields), dcm-of7v (dispatch adversary pcRolls autos / reactions when a PC rolls: Ill Omen, Backhanded Guidance,
  through E1's withDieBonuses); (2) dcm-mhn (critRange on adversary attacks), dcm-ehgy (targetResults / usedArmor gates
  after the window; dcm-nsqo, dcm-k4x5, dcm-sos), dcm-nnbl E7 half (reduceWith on the hp rider), automatic bearer steps
  (dcm-mm0f, dcm-0wj1, dcm-bxp.99.19.3, dcm-f0m, dcm-kti), dcm-eut (attacker's buy-off prompt), dcm-qw4f (removedOptions),
  dcm-8rh, dcm-i55, dcm-63j, dcm-4yg4 chain prompts, dcm-va0f pointsOf, dcm-b77 bearer riders; (3) tail: 702, vv2, icd,
  cdz, 2gn, 51s, 1jg, 145, 1ch, yea, 346, 4dc, e75, 5cn5 (anything left), xobk (run the pcMoves use + negate). Skip pgfr /
  bxp.78 UI buttons. Structured moveLimit / forcedMoveReduce on instance effects (encounters.ts widen) early, E4.3 reads it. ALSO dcm-grqt (user answer, do it early: gmControlledAttack with a "choice" weapon takes a GM-picked trait arg per attack, not the highest; report the authz args change).

- **E8.3** (lane:w1-e8-session-features-rests, lane3-e8): dcm-pqbo (featureRunner fills companion die / type, stats;
  applies setStance and gifts where not yet), dcm-2z2 / dcm-b9hc (3) companion fill, dcm-nw7h (rollCount pays the Favor
  per the kept default "paid by the use": check, then close or note), dcm-576v featureRunner half (extraFacts weapons,
  distance / nearestAlly / areas), dcm-hgvx feature run.ts caller, dcm-753y subject facts for features, dcm-31hq + dcm-40mj
  (convex/levelUp.ts calls runOnChoose for Vitality and writes the permanent picks, vaults the card), dcm-dvia (Locate
  Soul Echoes downtime move in the rest picker, Journey to Horizon only; GM button already exists), dcm-sa2 (verify),
  dcm-z5a6 / dcm-lvgm carry offer from a casterMoves rider on feature uses if it fits. ALSO dcm-atiu (user answer: Otherworldly Ire pays its Favor at the roll, no backing out) and dcm-i5e1 (user answer: a gold gift over the cap offers the excess to a party member within Close who is under the cap, else drops it with a feed note; replaces the INVALID refusal).

- **S1** (w2-srd-data, lane3-s1; all ten card-effects domains). Rule: switch only data whose engine path is live at
  rebuild HEAD (prove it with a test through the real path, e.g. tests/convex/lane3-s1-*.test.ts via combatCards.useCard
  or the hit window); otherwise keep / restore the manual reminder (card words, comment `Lanes-2 (dcm-xxx)` naming the
  engine bead) and list it for wave 10.
  Live now, switch: dread.ts Dark Army (`whenYouDealDamage.within`) and Spectral Mist (`endsOn: actionRoll`); midnight.ts
  Midnight-Touched reads `dualityDie fear` from the host roll (dcm-vbzy (1), drop the Fear Die choice); sage.ts
  Rejuvenation Barrier `from: "outsideArea"` resistance; valor.ts Lead by Example reminder text "other PCs only"
  (dcm-903q; engine is E1.3b, keep it manual).
  Restore reminders (dcm-ky8b): dread.ts Avatar of Terror (endEffect, dcm-m48i), bone.ts Breaking Blow (attackedRider,
  dcm-yd5h), grace.ts Invisibility (tokensGone, dcm-m48i); close dcm-s9md with it.
  Data + reminder (engine not live): codex.ts Mysterious Mist area per dcm-gzmo (point within Very Close, radius Very
  Close, blocksSight; card areas wait on dcm-9nlr), arcana.ts Rune Ward `paidBy` + `exhaust` (dcm-q40t; make sure the two
  exhaust notes still show once, see TASK-LN2-R1), grace.ts Encore `sameAsTrigger` typed `weapon` (dcm-m5fy), codex.ts
  Banish `record` (E7), grace.ts Words of Discord `forcedAttack` (dcm-f70y), Chain Lightning per-link roll (dcm-q13x, if
  arcana's data needs a change). Keep: Second Wind / Critical Inspiration / Rousing Strike (dcm-vbzy (2)(3)), Hold the
  Line (dcm-g90o), Tempest Hurricane limit (dcm-3oe). Check each w2-srd-data vocabulary bead in these files (rao5, o44e,
  5yew, lvgm, 40mj Vitality in blade.ts ...) and list it.

- **S2** (w2-srd-data, lane3-s2; feature effects), same rule. Live now, switch: ranger-rogue.ts Dark Cloud radius `close`
  (dcm-bxp.99.19.39; point within Close stays; the GM adjust is AO's) and Contacts Everywhere `giveGold` / `giveItem`
  gifts (E8 giftsOf); heritage-hf.ts Fireproof drops its check box (hits carry `keyword: "fire"`) and Know the Tide
  `tideTokens`; druid-sorcerer.ts Manipulate Magic (`reach`, `hostRange`) and Elemental Incarnation Water (`within: melee`,
  auto `picked` count `all` with `excludeSubject`); assassin-brawler.ts Stance Fighter `setStance` (E8 applies it on the
  feature path) and Blight Seed `stacking: "refuse"`; beastforms.ts Armored Shell `stat armorScore` (E8 binds it); seraph-
  witch.ts Lunar Phases `moonPhase` (verify E5 reads it first); transformations.ts Howling Rampage `endEffect` (feature
  path live). Data + reminder or keep: guardian-warrior.ts Weapon Specialist `rerollHeld` (dcm-q40t / dcm-inou), Attack of
  Opportunity `anyTrait` (verify the reaction path), warlock.ts Otherworldly Ire count from the Favor (drawer input is
  combat-ui: keep), seraph-witch.ts Spirit Weapon (dcm-xbtw: engine is E1.3b this wave, keep manual, list for wave 10),
  Prayer Dice picks (dcm-ef77), beastforms.ts Bird's-Eye View `sharedGrant` (dcm-79v1), assassin-brawler.ts Marked for
  Death `endFear` (dcm-kmr), Enchanted Talisman `unlimited` + `holdsItem` (engine live via E2: switch if a test shows the
  offer). Perfect Recall stays a rider.

- **S3** (w2-srd-data, lane3-s3; t1-core, t1-hf, t2-core, t2-hf), same rule. dcm-6n0p: t1-hf.ts Broken Magic / Discordant
  Visions drops `modifier: fixed(2)` (check-table rows get the ATK since E7 dcm-b3bb). dcm-72qk: t1-hf.ts Covered in
  Spiders (the PC picks Stress or GM Fear; if the adversary path can't ask the PC, keep the manual step with that text),
  t1-core.ts Taunt (disadvantage until the next successful attack), Exile (target + whole party), the odd-half rounding
  up. Fire keyword: set `keyword: "fire"` on every fire damage step of these tiers (E2 dcm-dv6). Verify, then switch or
  list: Spit Acid `markArmor.ifUnable` (t1-core, t2-core, t2-hf; adversary path), t1-hf.ts Stone of Omens hope split,
  t2-hf.ts Mind Meld split (needs E7's would-mark hook: keep), Tentacle Rays forcedAttack (dcm-f70y: keep), Eye of the Sage
  `critRange` (dcm-mhn: keep unless the adversary attack reads it), Ravenous flags.

- **S4** (w2-srd-data, lane3-s4; t3-core, t3-hf, t4-core, t4-hf), same rule. dcm-6rke: t4-hf.ts Power Slide / Fire Beam mark
  3 / 1 HP outright. dcm-trz9: t3-hf.ts Weight of Opulence per the answer (data if gold is readable; goldOf has no store
  yet, dcm-n3mp: then a manual step with the answer's wording). t3-hf.ts Hellwing's Claws `standardAttack` (dcm-gx3, live);
  t3-core.ts Never Misses `attacksHalveEvasion` (dcm-4c9m, live); t4-core.ts Unstuck `marksMultiplier` (hits live via E2;
  the spend side waits on dcm-q40t: keep a reminder for spends); t4-hf.ts Burrowing Leechpoles fixed `damageTaken` add
  (the per-leechpole count waits on dcm-n3mp: keep that part manual). Fire keywords on fire damage steps (Young Fire
  Dragon ...). Verify, then switch or list: Spit Acid entries in t3-core / t3-hf, t3-hf.ts Unleash Hellfire `perArea`
  (dcm-va0f: keep), t4-hf.ts Lightning Strike / Bolt `checkFails` (dcm-4yg4: keep), Transform `changeForm` (dcm-f70y:
  keep), Slash and Burn type merge (dcm-i55), Ravenous / Afflicted flags (dcm-hgvx), 'Get Over Here!' ATK (already done).

- **AO** (lane:w1-e4-targeting-areas, lane3-ao; dcm-lqnt + dcm-u2wx client + Dark Cloud GM adjust). Read
  .omc/plans/aoe-sprites.md and docs/sprite-packs/area-effects-prompts.md. (1) Art: extend the sprite cutter (scripts/
  sprite-packs/**, e.g. a cut-areas.ts entry on the same pipeline) to read /mnt/c/Users/Petar/sprite-sheets/area-effects/
  {fills-1..4,decals,walls}.jpg (magenta background), and write public/area-effects/<kind>.<hash>.webp + a manifest
  module in src/lib/combat-map/area-effects/; the raw sheets are never committed; report the package.json script line
  (`sprites:areas`) to the orchestrator (package.json is not yours). (2) Overlay: area-overlay.tsx on the map board
  reads `combatAreas.list` (players: live map only), maps an area's label to a kind (small table, `generic` fallback);
  fills drawn see-through and clipped to the circle (tiled), but the spiral fills (aura-earth, aura-air, ink) drawn scaled
  to the circle, not tiled; decals scaled to the circle, moonlight and silence at low opacity; walls repeated along the
  line. (3) Point picking: area-pick.tsx gives a pick-a-square mode; the feature use drawer (drawer/use/**) asks for the
  point of a `point`-centred area and sends `useFeature` `point` (dcm-u2wx); the Hand wiring for cards is a wave-10
  follow-up (E1.3a adds the useCard args). (4) GM: convex/combatAreaEdits.ts (gmMutation) to draw an area by hand and
  move / resize one (Dark Cloud: Close radius by default, GM adjusts), entries in tests/convex/authz/combat.entries.ts;
  remove uses the existing combatAreas.remove. Minimal UI (combat UI redesign dcm-bxp.99.32 is pending). Tests: unit
  (kind table, manifest, cutter on a fixture), convex (edits, authz), tests/e2e/area-overlay.spec.ts.

- **CT** (lane:w2-campaign-time, lane3-ct; dcm-ztb8, dcm-gfk3, caller halves of dcm-55k / dcm-bc67). Campaign time for
  every frame: a day-of-week + week counter for non-Witherwild campaigns (campaignTime row created lazily or at create;
  Witherwild keeps its cycles and existing behaviour); a GM "End day" (keyedGmMutation) that runs expire(sheet, "day")
  for the party (expiry.ts is E6's, read only) and drops instance featureUses with until "day"; on the 7th day also
  "week". endGmTurn (convex/encounterTracking.ts) runs expire(sheet, "gmTurn") for the party in the turn's log group.
  Undo per the house pattern (recordHistory). Button: on the campaign's time arc / shell, GM only; where it lives was not
  specified, so put it beside the existing time display and list it under QUESTIONS. Entries in core.entries.ts.
  Tests: convex (day / week / gmTurn expiry, Witherwild unchanged, authz) and tests/e2e/lane3-campaign-time.spec.ts.
