# lanes-2 wave 10: tracer briefs (2026-10-31)

Plan: `.omc/plans/lanes-2.yaml`, wave 10 (13 tracers in two batches). Written from the wave-9 task docs
(`docs/tasks/TASK-LN3-*.md`), `bd list --status=open` and the 2026-10-31 user answers (`.omc/plans/overnight-questions.md`,
the sections after the crash). Read `bd show <id>` before you start a bead: wave-9 progress is in the task docs and the
beads' notes.

## Batches and launch order

| Batch | Tracers | Launch |
|---|---|---|
| A (8) | V4, E4.4 | at once |
| A | E1.4a, E1.4b, E2.4, E6.4, E7.4, E8.4 | once V4 is merged (each `depends_on: [V4]`) |
| B (5) | CT2 | any time after batch A is merged (it needs nothing from A; it runs in B to keep A at 8) |
| B | S1.4, S2.4, S3.4, S4.4 | once the batch-A tracers in their `depends_on` are merged |

No file is owned by two wave-10 tracers, in either batch (checked by script: 0 overlaps; `node scripts/plan-check.mjs
.omc/plans/lanes-2.yaml` OK). Only tracers with a UI piece that needs a browser run their own e2e spec: E1.4a, E1.4b, E2.4,
E8.4, CT2.

## Orchestrator bookkeeping before launch

- Close as done (the wave-9 docs say closable; tracers never close beads): dcm-3wt4 (merged with MG2), dcm-0x2g (merged
  by the orchestrator), dcm-qoq9 + dcm-q13x (freshLinkDamage on at merge), dcm-nnbl (E7 half done at the E7.3 merge),
  dcm-io4m (user kept the Share the Burden cap), dcm-m48i, dcm-9nlr, dcm-76l5, dcm-1kvg, dcm-3s6e, dcm-bn1, dcm-gvr,
  dcm-ef77, dcm-ego9, dcm-bxp.99.19.63 / .67 / .68, dcm-yd5h, dcm-9gw, dcm-jkhp, dcm-hnbk, dcm-lfbf, dcm-6qrn, dcm-uwg1,
  dcm-8f51, dcm-3m5k, dcm-hgvx (window, run.ts, feature halves; combatActions caller is dcm-b41o), dcm-91tx, dcm-rou,
  dcm-bz8, dcm-d1b, dcm-yzr, dcm-0gh, dcm-18i, dcm-5xi, dcm-xp0, dcm-7az, dcm-q0a, dcm-qbn, dcm-5fc, dcm-kkx, dcm-q3t1,
  dcm-m5fy, dcm-x4ft, dcm-gl9, dcm-576v, dcm-sc54, dcm-cma, dcm-wuu, dcm-3oe, dcm-1yo, dcm-bpr, dcm-g90o (engine; data is
  dcm-trib), dcm-lqnt, dcm-u2wx, dcm-bxp.99.19.39, dcm-grqt, dcm-mhn, dcm-qw4f, dcm-3ag5, dcm-eut (engine; data S2.4),
  dcm-pg8x, dcm-c75, dcm-bc67, dcm-rm9, dcm-aym, dcm-55k, dcm-kmr, dcm-8bv, dcm-awh, dcm-ffk, dcm-4qv, dcm-wjv, dcm-0ey,
  dcm-cwh, dcm-utu, dcm-erhv, dcm-9z2z, dcm-8x8, dcm-atiu, dcm-i5e1, dcm-nw7h, dcm-pqbo, dcm-2z2, dcm-b9hc, dcm-dvia,
  dcm-ztb8, dcm-gfk3, dcm-ky8b, dcm-s9md, dcm-72qk, dcm-6n0p, dcm-6rke, dcm-6y00,
  dcm-bxp.99.19.66 (rolls.duality; other paths dcm-8fc2), dcm-j63t (vocabulary half; the rest is dcm-0hlq).
  Duplicates: dcm-try2 (of dcm-1alq), dcm-7qgg (of dcm-wli0).
- Keep open, waiting on a run you approve: dcm-bxp.99.19.60 (narrow after `migrations/targetCountExpiresAt:clearExpiresAt`
  ran everywhere), dcm-3ias (run `migrations/vanishingActMarker:addMarker`: dev now, production after the next deploy).

## Common rules (every tracer)

- Read CLAUDE.md, AGENTS.md, docs/workflow.md, the relevant parts of docs/best-practices.md, your block in
  .omc/plans/lanes-2.yaml (and the comment above wave 10 about ownership moves), your lane's wave-9 doc
  docs/tasks/TASK-LN3-<lane>.md, docs/tasks/TASK-LN4-V4.md once V4 is merged (the final term / payload names), and
  `bd show` of every bead you take.
- First step, before any edit: `git switch -C <branch> rebuild` (branches lane4-v4, lane4-e1a, lane4-e1b, lane4-e2,
  lane4-e4, lane4-e6, lane4-e7, lane4-e8, lane4-s1 ... lane4-s4, lane4-ct2). Then `node scripts/worktree-setup.mjs` if you
  run e2e, and `E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm e2e:setup` once before the first e2e run.
- Owns are binding: `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml <ID> rebuild HEAD` (IDs V4, E1.4a, E1.4b,
  E2.4, E4.4, E6.4, E7.4, E8.4, S1.4 ... S4.4, CT2). Files that moved this wave: `validators/combatRequests.ts` and
  `validation/characters.ts` are V4's; `cardRunner.ts`, `hand/dialog.tsx`, `hand/model.ts` and `requests/**` are E1.4a's;
  `convex/combatActions.ts` and `convex/combatRequests.ts` are E1.4b's; `card-effects/run.ts`, `characters/derived.ts`
  and `slots.ts` are E8.4's; `src/lib/srd/adversaries.ts` is S3.4's.
- Never edit the three effect types.ts files, `src/lib/srd/types.ts`, `validators/combatRequests.ts` or
  `validation/characters.ts` (V4 only), or src/lib/srd/** data (S tracers only). A missing term or field: file a bead
  `--labels vocabulary-gap,lane:w3-vocabulary`, model it another way or leave a manual line.
- Combat UI (user 2026-10-31): every new combat prompt is built server side PLUS a plain minimal UI using existing
  components (buttons, check boxes, the requests panel, the reactions prompt). The user's combat UI redesign
  (dcm-bxp.99.32) restyles them later. Beads labelled `combat-ui` that are pure redesign still wait: skip them.
- A change needed in another lane's file: do your half, file a follow-up bead with that lane's label (and name it in
  your doc). Do not edit it. Batch-A tracers run side by side: where two halves meet (named per tracer below), code
  against the V4 shape and test your half alone (seed the other half's row / field in the test).
- Unclear rule: simplest reading that matches the book, listed under QUESTIONS in your task doc with quote and page
  (books, git-ignored: /home/petar/daggerheart-campaign-manager/.reference-private/text/core.txt and hopefear.txt; printed
  page = PDF page - 1). Never invent an unspecified mechanic: ask whether it is core or frame-exclusive.
- A public function's args change or a new public function: add its authz entry if you own the entries file (E1.4a
  prompts, E1.4b combat, E6.4 features + characters, E7.4 adversary-actions, E8.4 play, CT2 core); otherwise report it
  to the orchestrator. Stored shapes: widen → migrate → narrow (rule 7); a migration is written and tested, never run.
- Checks (user 2026-10-31, memory): `pnpm lint`, `pnpm typecheck`, vitest with `--maxWorkers=1 --testTimeout=120000`.
  While iterating run only your focused files (`pnpm vitest run <files> --maxWorkers=1 --testTimeout=120000`); run the
  full suite once before the commit. The auth-signup flood test is load-flaky. Only the tracers named above run e2e,
  and only their own spec.
- Write docs/tasks/TASK-LN4-<ID>.md (IDs V4, E1A, E1B, E2, E4, E6, E7, E8, S1 ... S4, CT2): what landed, beads done /
  partly done (say plainly "closable" or what is left), follow-ups filed, data switches ready for wave 11 per SRD file,
  QUESTIONS, merge-time actions. An edit outside owns that an existing test forces (as in wave 9): say so in the doc.
- Commit ONCE on your branch, author petar (existing git config), NO Co-Authored-By trailer. Never push, merge or close beads.
- Final report: branch + commit; beads done vs partly done; follow-ups; data switches ready; questions; check results;
  merge-time actions (authz entries, codegen, fallback lines, scripts).

## User answers that apply (2026-10-31, .omc/plans/overnight-questions.md)

Wave 9 round 1-2 (after the crash):
- "Took damage" / severity: severity follows the HP actually marked after armor (Major = 2 HP, Severe = 3 HP); armor
  that reduces the damage reduces the severity. Fragile Beastform and the Severe stance drop follow it (dcm-hs6u: verify).
- Fire Beam: Fireproof makes an Emberkin immune (dcm-n7kt). Lava is fire (kept). Oozes are fire; Sear / Mana Beam are not.
- Standard attacks get a damage keyword; Minor Fire Elemental's Elemental Blast (CB p.214), Redcap Candlemaker's
  Burning Candlestick (HF p.67), Guahalan Spirit Singer's Spirit Flame (HF p.77) are fire (dcm-dztv).
- Store the caster on a sheet effect: widen → migrate → narrow (dcm-lztq).
- Reliable Backup: the player confirms "in conversation" on a Presence Roll (dcm-hqk1).
- Marked for Death names its assassin; only that PC's effect ends (dcm-qxb6).
- Undo of End day rolls the day back too (dcm-jq4b). End day clears instances in running encounters only (kept).
- MG2 feed line on a stale Cloaked removal: done (dcm-3wt4, close it).
Wave 9 new questions, rounds A-D:
- Cloaked: attacks end Cloaked automatically; any other action roll by a Cloaked rogue that targets an enemy pops a GM
  prompt "Does Cloaked end?" (dcm-vx5n). Unconscious toggled by hand drops Cloaked (kept).
- Multi-target attack: compare the one roll per target with that target's own advantage / disadvantage (dcm-svux).
- Lead by Example: any PC except the one who used it can take the benefit (dcm-j5aw).
- Bearer riders on a PC's own rolls run automatically (dcm-l1er).
- Forced PC attack: a roll request opens the player's attack with the target locked (dcm-uxsd).
- Buy-offs: the GM pays before the roll, default unpaid (kept). Last-HP cap keeps the hit's Severe (kept). Doubled
  Minor (2 HP marked) counts as Major (kept).
- Share the Burden over marked Stress: cap (kept; dcm-io4m closable).
- Otherworldly Ire: ALL the use's costs are paid at the roll (dcm-szfg). Locate Soul Echoes on both rests (kept). Excess
  gold to the nearest PC with room (kept).
- Fireproof on an untyped hit: the GM decides whether the hit is fire (dcm-sk4r); a fire-tagged hit applies it directly.
- Manipulate Magic reach: picked at setup, widens the attack's targets (kept, dcm-lbai).
- Hand-drawn areas may be GM-owned (dcm-9z28): NOT placed this wave, see "Not placed".
- An area never runs its steps on its owner's own token (kept).
Older, still binding: duality-die bonus never crits, a tie after the bonus is WITH FEAR; silent reminders (dcm-s9md): a
switch to data the server doesn't act on keeps its manual reminder; GM-controlled PC's 'choice' weapon: the GM picks the
trait; Spirit Weapon per-attack check box; Words of Discord memory for the whole campaign; gold in handfuls, bag = 10.

## Per tracer

- **V4** (w3-vocabulary, lane4-v4, batch A, first; size S; widen only, no behaviour). One merged base for the batch-A
  engine tracers. Add, optional and narrow (no `v.any()`), and list every name in TASK-LN4-V4.md with its user:
  1. dcm-dztv: an optional damage keyword on an adversary's standard attack in `src/lib/srd/types.ts` (the stat block's
     `attack`, e.g. `keyword?: DamageKeyword`; import the type, don't redefine it). Types only; the data is S3.4's.
  2. dcm-n7kt: `keyword?: DamageKeyword` on the markHp step (Fire Beam's outright 3 / 1 HP, HF p.96) wherever the step
     type lives (card-effects / adversary-effects types.ts).
  3. dcm-hqk1: `situation?: string` on `RollEnd`, and on the `dualityDie` / `hopeDie` Mod if it lacks it (Reliable Backup,
     CB p.43: "a d20 as your Hope Die" on "a Presence Roll in conversation").
  4. `convex/lib/validators/combatRequests.ts`: (a) dcm-1sk4 `spiritWeapon` on `sanctionRollOptionsValidator`; (b) dcm-mcgj
     `riders` on the sanction's feature action (as the card action has); (c) dcm-vx5n a new request kind for the GM's
     "Does <name>'s Cloaked end?" (characterId, tokenId, the use's label, the use's actionLog groupId, the enemy target
     ids) and its schemaVersion 1 payload in `combatRequestPayloadValidator`; (d) dcm-uxsd a new request kind for a forced
     PC attack (characterId, the forcing instance + feature name, locked target token ids, groupId); (e) dcm-sk4r the
     Fireproof GM ask on an incoming hit (a pending-hit field such as `keywordAsk` and a GM answer member of the hit
     choices; E2.4 builds both sides). Add the new kinds to the combatRequests table's kind union if it has one
     (`convex/tables/combatRequests.ts` is not yours: report the line).
  5. `src/lib/validation/characters.ts`: dcm-lztq `casterId` (character id) and, for Marked for Death (dcm-qxb6), a
     target reference (instance id) on a sheet effect, both optional; dcm-wiwi creature tokens on a PC sheet (named
     counts, capped like `MAX_CREATURE_TOKEN_KINDS`). Optional fields are a widen: no version bump (as E5.3's `campaign`).
  Every exhaustive switch / Record your members break in files you don't own (e.g. request kind switches in
  convex/combatRequests.ts, convex/lib/combatRequests.ts, the requests panel): report the one fallback line each needs;
  the orchestrator adds them at your merge. Tests: types-widen-4.test.ts fixtures for each member, a validator test for
  each payload (tests/convex/lane4-v4-*.test.ts or unit).

- **E1.4a** (lane:w1-e1-triggers-rolls, lane4-e1a, batch A after V4; XL, priority order, a tail with notes is fine).
  (1) dcm-tn8u + dcm-svnq + dcm-9l9g: combatCards applies `planHandoff(built, plan)` from cardRunner (E4.3): log the feed
  words; apply `setStance` and gifts (`stancesOf` / `giftsOf` / `giveTo` as the feature path does); hand `forcedAttack`
  on adversaries to `forcedStandardAttack` and `changeForm` to the form modifier (convex/lib/adversaryActions.ts,
  E7.3, read only: call the exports); write instance conditions through `conditionInstanceEffect` (with `casterId`)
  in cardRunner; pass `points`; show the new asks (per-chooser picks, chain links) in the Hand dialog, plainly. This
  makes Words of Discord's forced attack (dcm-c8h3) and Critical Inspiration / Rousing Strike per-ally picks live.
  (2) dcm-vx5n card / feature half: a card or feature use by a Cloaked PC that is an action roll targeting an enemy but
  not an attack (`isAttackUse` false; CB p.42, CB p.99) opens the V4 request; new module convex/cloakPrompts.ts
  (keyed GM mutation `answer { requestId, ends }`: yes ends Cloaked with `withoutCondition` in the use's undo group,
  no declines) + convex/lib/cloakPrompts.ts (the opener, exported so E1.4b's roll paths can call it in wave 11 if
  needed); a plain GM row in the requests panel (src/components/combat-map/requests/**). Entries in prompts.entries.ts.
  E2E: tests/e2e/lane4-cloak-prompt.spec.ts (two browsers: the rogue casts a debuff on an enemy, the GM answers yes, the
  rogue is no longer Cloaked). (3) dcm-mcgj: `useFeature` stores sent riders in the sanction payload (V4 field) and the
  sanction replays them. (4) dcm-m7tm card / feature half: card and feature action rolls call `pcRollAdversaryUses`
  (E7.3) and fold its `bonuses` with `withDieBonuses`. (5) dcm-wli0 card half: card / feature damage to an instance calls
  `endAdversaryConditionsForCaster`; card / feature rolls call `endAdversaryConditionsOnRoll` (both in cardRows.ts, read).
  (6) dcm-j5aw writer half: a card's instance effect / tag records the placing PC (`casterId`) so E1.4b can exclude only
  them (Lead by Example). (7) dcm-lztq card writer: card sheet effects carry `casterId` (V4 field). (8) Hand point
  picking: a `point` / `points` card area calls `startAreaPick` (map-view/area-pick.tsx, E4.4's, read only) and sends
  `useCard` `point` / `points` (makes Mysterious Mist, Veil of Night, Eclipse placeable). (9) dcm-8e4c / dcm-u4pq: Hand
  index passes `vault` to `UseDialog`. (10) dcm-79v1 card half (`endGrantedBenefit` where a card roll uses a granted
  benefit). Tail: dcm-dgu (3) line / front / path / between shapes in cardRunner's range origin.

- **E1.4b** (lane:w1-e1-triggers-rolls, lane4-e1b, batch A after V4; XL, priority order, a tail with notes is fine).
  (1) dcm-svux: an attack on several targets with one roll (CB p.104: "you only make one attack roll and compare its
  result to the Difficulty of each eligible target") compares per target with that target's own advantage /
  disadvantage (CB p.100: a d6 added / subtracted); replaces E1.3b's common-edge rule (QUESTION Q2 below: one d6 or one
  per target; build one shared d6 until answered). (2) dcm-uxsd player half: the player sees the V4 forced-attack
  request (new player query; report its entry or add it to combat.entries.ts), a button opens the Attack bar with the
  target locked; `combatActions.attack` takes the request id and resolves the request in the attack's group; refused
  target change → INVALID. E7.4 writes the request (test your half with a seeded row). E2E:
  tests/e2e/lane4-forced-attack.spec.ts. (3) dcm-hqk1: on a Presence Roll the dice box shows "In conversation: use
  Reliable Backup" when the d20 Hope Die effect is held; only a ticked roll uses (and ends) it (V4 `situation`).
  (4) dcm-m7tm roll half: `resolveAttack` and `rolls.duality` call `pcRollAdversaryUses` and fold `bonuses` (Ill Omen,
  Backhanded Guidance; no crit, tie with Fear). (5) dcm-l1er: bearerRider steps run automatically as a plan on the
  bearer in the roll's row (Poisoned's d6 CB p.211, Envelop, Ignite CB p.215-216, Shadow Shackles CB p.222).
  (6) dcm-kso9 + dcm-j5aw reader: Lead by Example's benefit (clear a Stress or gain a Hope, CB p.342) applies on the next
  PC's attack against that adversary, excluding only the placing PC (`casterId`, fallback the old holder rule when
  absent), and is used up by that attack (QUESTION Q3). (7) dcm-wli0 attack / roll half (`endAdversaryConditionsForCaster`
  on attack damage, `endAdversaryConditionsOnRoll` in convex/rolls.ts). (8) dcm-b41o + dcm-7udv + dcm-iia9: combatActions
  passes `weapons.attacking`, wraps creatureFacts in `withCreatureAreas` and passes `flagsOf` payer flags. (9) dcm-1sk4
  consumer: a held attack sanction keeps the Spirit Weapon box. (10) dcm-lbai: a reach rider picked at setup widens the
  attack's own target check. (11) dcm-iddp. (12) dcm-bxp.99.19.64 dice box / Attack bar trait displays. (13) dcm-84b2
  (seed the Kick roll). (14) dcm-cj8 (attack the Wild Fortress dome through `combatAreas` damage). Tail: dcm-gtmp /
  dcm-raa, dcm-g6t / 1o3 / 0gi / 3ft / iu4.

- **E2.4** (lane:w1-e2-damage-window, lane4-e2, batch A after V4; L). (1) dcm-12kx: `pcMods` reads adversary-applied
  sheet effects (`card:<adversaryId>/<feature>:<n>`) via `lastingModsOf`, so Unstuck's marksMultiplier, Leechpoles'
  damageTaken and Ravenous / Afflicted flags count on hits and payers. (2) dcm-5gng + dcm-7vei: the hit carries the
  keyword of the damage step that dealt it (walk save onFail / onSuccess, followUp and check-table rows; per branch, so
  Fire Jets is fire but Mana Beam / Trample are not). (3) dcm-dztv reader: a standard attack's keyword from its stat
  block (V4 field; S3.4 fills the data in batch B: test with a fixture). (4) dcm-n7kt: a markHp step with keyword fire
  against a PC with Fireproof (HF p.22: "immune to damage from magical or mundane flame") marks nothing, with a feed line.
  (5) dcm-sk4r: a hit with no known type / keyword on a Fireproof PC asks the GM "Was this hit fire?" (V4 shape; GM
  answer in the hit window; minimal GM row in src/components/combat-map/actions/adversary/**); a fire-tagged hit applies
  Fireproof directly. E2E: tests/e2e/lane4-fire-ask.spec.ts. (6) dcm-i9c1: the window's feature actor carries stats
  (Armored Shell's Armor Score). (7) dcm-8fc2: incomingHits / adversaryHits reaction rolls apply `endConditionsOnRoll`
  (Vanishing Act's Cloaked on Fear) and name it in the row. (8) dcm-hs6u: verify Fragile Beastform and the Severe stance
  drop need 2 / 3 HP marked after armor; fix in your files, else a follow-up for E6 (stanceDrop.ts / expiry.ts are E6.4's).

- **E4.4** (lane:w1-e4-targeting-areas, lane4-e4, batch A, starts with V4; M). (1) dcm-ii4: an area ends when its
  feature's tokens reach 0 and when its caster leaves it (Circle of Power, HF p.16: "lasts until the last token is removed
  or you exit the circle"). (2) AO follow-up: the feature drawer (drawer/use/**) picks two squares for a wall and N for a
  `count` area and sends `useFeature` `points` (E1.3a added the arg). (3) dcm-bxp.84 + dcm-klr8: per-object light
  override none / faint glow / torch / campfire: widen `combatObjectFields` (validators/combatMaps.ts, the literals
  defined there) and the table, the view validator in combatMaps.ts, `spriteSources.objectTraits`, `visionObjects`, the
  painter's glow (sprites/objects.ts), a GM mutation (e.g. `combatVision.setObjectLight`; report its authz entry) and a
  select in the editor panel. (4) dcm-bxp.99.19.64 vision half: `instinctOf` reads `derivedTraits(withEffects(sheet))`.
  If time and it fits your files: dcm-lvgm / dcm-z5a6 carry offer. dcm-9z28 is NOT yours this wave (see "Not placed").

- **E6.4** (lane:w1-e6-endings-durations, lane4-e6, batch A after V4; M). (1) dcm-lztq: caster-tied ends
  (`endForCasterOnSheets`, the `endsOnCaster` readers in cardRows / expiry) use the effect's `casterId` when present
  (two Skykin with Eye of the Storm, CB heritage), the old single-holder guess only when absent; a batched,
  self-continuing migration convex/migrations/sheetEffectCaster.ts backfills `casterId` where it is derivable (the
  effect's source card / feature held by exactly one PC of the campaign) and leaves the rest; written and tested
  (dry run, idempotent), never run; no narrow. Writers: E1.4a (cards) and E8.4 (features) set it this wave; classFeatures
  (D5) is yours. (2) dcm-qxb6: Marked for Death (HF p.8) records the placing PC and the target on the assassin's effect
  (V4 fields); `endOnDefeat` ends only the effect whose target was defeated, not every assassin's. (3) dcm-mvoo engine
  note: ending the D5 'marked-for-death' sheet effect also lifts the tag on the instance. (4) List every open E6-labelled
  bead closable / what is left (b77 is E7.4's, v17 stays a reminder).

- **E7.4** (lane:w1-e7-adversary-engine, lane4-e7, batch A after V4; XL, priority order, a tail with notes is fine).
  (1) dcm-1alq: call `withAdversaryConditionMarkers` after `writeSheetChanges` in the touched-PC loop. (2) dcm-thwj +
  dcm-0hlq: end stored instance condition modifiers at their events (endsOn, endsOnCaster, endsOnRoll, escape) and add
  the real `pcEscapes` case to `matchesTrigger` (widen the event's condition or compare by name); the escape roll's
  server sends the event with amount = tokens removed (Encumber, CB p.218). (3) dcm-eg6h: forward `creatures` into
  `runCard` (Hive Mind HF p.65, Pack Fury). (4) dcm-uxsd opener: a forced PC attack (Beguiled, HF p.75; Tentacle Rays)
  writes the V4 request in convex/lib/forcedAttacks.ts instead of the manual prompt (E1.4b consumes it). (5) dcm-spj0:
  markHp with `reduceWith: "hope"` and no pending hit opens the hit window with the hp rider (E2.3: a forced-HP hit with
  no damage makes the target a responder), so the Hope is always offered. (6) dcm-mvgc: the GM's feature ask lists hope
  splits (src/components/adversaries/tracker/actions/**). (7) dcm-wiwi writer: creatureTokens steps on PCs write the V4
  sheet field. (8) dcm-ehgy (+ nsqo, k4x5, sos). (9) adversary-side bearer steps (dcm-mm0f, 0wj1, bxp.99.19.3 Poisoned's
  1d10, f0m, kti, wqgs). (10) dcm-zi3k rest ("can't attack the caster", the rider on the GM's Fear spend), dcm-b77
  (Banish's recurring roll with a falling Difficulty, CB p.333), dcm-8rh, i55, 63j, 4yg4, va0f. Tail: 702, icd (user:
  remove from map and encounter, log fled), 51s, 1jg, 145, 1ch, 346, 4dc, e75, xobk, 5jyp, cdz, 2gn, yea, pgfr (countdown
  link + "End this countdown?"; UI minimal).

- **E8.4** (lane:w1-e8-session-features-rests, lane4-e8, batch A after V4; L). (1) dcm-szfg: every cost of the
  Otherworldly Ire use (HF p.15) is paid at the Patron Dice roll, none at resolution. (2) dcm-h1y9: `giftsOf` (or the
  feature path) applies plan `inventory` giveGold / giveItem steps (Contacts Everywhere's supply, CB p.43). (3) dcm-40rt +
  dcm-7l0g: Weapon Specialist's slayer-ones limit shares `WEAPON_SPECIALIST_KEY`, and the reroll of Slayer 1s rides
  Slayer's own rider once per long rest (CB p.48; card-effects/run.ts is yours if the runner needs it). (4) dcm-u9pv +
  dcm-txlu: derived thresholds add `permanentThresholds(sheet)`; the level-up draft asks for Vitality's two picks and
  sends `cardChoices` (CB p.330). E2E: tests/e2e/lane4-vitality-level-up.spec.ts (fixture card if blade.ts Vitality is
  not data yet; S1.4 switches it in batch B). (5) dcm-lztq feature writer: feature sheet effects carry `casterId`.
  (6) At Ease (dcm-o3j rest): FEATURE_SLOTS from a stressMax mod if it fits slots.ts. Tail: dcm-lvgm / dcm-z5a6 carry
  offer from a casterMoves rider.

- **S1.4** (w2-srd-data, lane4-s1, batch B; depends E1.4a, E1.4b, E8.4). Rule: switch only data whose engine path is live
  at rebuild HEAD, proven by a test through the real path (tests/convex/lane4-s1-*.test.ts); otherwise keep / restore
  the reminder and list it for wave 11. Live since wave 9 (prove, then drop the reminder): arcana.ts Confusing Aura and
  Flight R1 reminders, codex.ts Time Lock, grace.ts Invisibility (tokensGone from card uses), bone.ts Breaking Blow
  (attackedRider live), arcana.ts Rune Ward holder-Hope (payers live), grace.ts Encore (trigger damage type live: prove
  the reaction path asks), midnight.ts Hush area `endsOnCaster: ["majorDamage"]` (E2.3), valor.ts Hold the Line pull as
  `auto` `whenEnemyEntersRange` (dcm-trib). dread.ts Avatar of Terror: its 0-Hope upkeep is NOT in combatCards (E1.3a):
  prove it before dropping. After batch A: grace.ts Words of Discord forced attack (E1.4a), codex.ts Mysterious Mist and
  midnight.ts Eclipse / Veil of Night `seeThrough` (Hand point picking, E1.4a; dcm-o44e), valor.ts Lead by Example
  `attackedRider { by: "others", attackerSteps }` (E1.4a / E1.4b; dcm-kso9), Critical Inspiration / Rousing Strike
  per-ally picks (dcm-vbzy (2)(3), if the Hand asks), blade.ts Vitality onChoose (the `vitality` fixture in
  tests/convex/lane3-e8-round3.test.ts; dcm-40mj, after E8.4's u9pv + txlu). Keep: Banish (dcm-b77 unless E7.4 lands it),
  Tempest Hurricane limit, Grace-Touched (dcm-22q, wave 11).

- **S2.4** (w2-srd-data, lane4-s2, batch B; depends E1.4b, E2.4, E6.4, E8.4), same rule. Live since wave 9: seraph-witch.ts
  Prayer Dice picks (dcm-ef77), beastforms.ts Bird's-Eye View `sharedGrant` (dcm-79v1 / dcm-rao5), assassin-brawler.ts
  Marked for Death's endsWhen reminder of the GM Fear end (dcm-kmr), stances.ts Defensive stance `buyOff` (dcm-eut),
  warlock.ts Otherworldly Ire (the `ire` fixture in tests/convex/lane3-e8-round3.test.ts; the count input is combat-ui:
  keep the drawer as is). After batch A: seraph-witch.ts Spirit Weapon / Sacred Resonance per-attack confirm rider drop
  (dcm-xbtw, after E1.4b's dcm-1sk4), ranger-rogue.ts Reliable Backup d20 Hope Die with the `situation` (dcm-hqk1),
  Contacts Everywhere supply gift (dcm-h1y9), druid-sorcerer.ts Manipulate Magic reach reminder (dcm-lbai), beastforms.ts
  Armored Shell `stat armorScore` (dcm-i9c1), guardian-warrior.ts Weapon Specialist reroll (dcm-7l0g) and At Ease
  stressMax (if E8.4 landed it), assassin-brawler.ts Marked for Death target data if E6.4's dcm-qxb6 needs any. Keep:
  Attack of Opportunity `anyTrait` (no leaves-range reaction path), Perfect Recall stays a rider.

- **S3.4** (w2-srd-data, lane4-s3, batch B; depends V4, E1.4b, E2.4, E7.4), same rule. (1) dcm-dztv data in
  src/lib/srd/adversaries.ts (yours this wave, every tier): fire keyword on Minor Fire Elemental Elemental Blast (CB
  p.214), Redcap Candlemaker Burning Candlestick (HF p.67), Guahalan Spirit Singer Spirit Flame (HF p.77); Catrin's
  Spirit Flame (HF p.81) only per the user's answer to Q1 below. (2) t1-hf.ts Stone of Omens hope split (dcm-nh44, after
  E7.4's dcm-mvgc), Covered in Spiders manual drop (after E1.4b's dcm-l1er, if the player's two-half pick is asked),
  t1-core.ts Tangle Bramble Swarm Drain and Multiply as `auto` on `{ kind: "pcEscapes", name: "bramble" }` (after
  dcm-0hlq), Creeping Fire `moveLimit` (live), t1-hf.ts Hive Mind / t2-hf.ts Pack Fury creatureCount (after dcm-eg6h).
  (3) t2-hf.ts Eye of the Sage reminder drop (critRange live, dcm-mhn), Tentacle Rays / Beguile forced attack (after
  E7.4 + E1.4b dcm-uxsd), Mind Meld (dcm-63j, if E7.4 got there), t2-core.ts Fire Jets per-branch keyword (after
  dcm-7vei). Fire keywords in save branches need no data change.

- **S4.4** (w2-srd-data, lane4-s4, batch B; depends V4, E1.4b, E2.4, E7.4), same rule. t4-hf.ts Fire Beam markHp
  `keyword: "fire"` (dcm-n7kt); t4-core.ts Reality Quake Unstuck hit-half reminder, t4-hf.ts Leechpoles and Ravenous /
  Afflicted reminders (after dcm-12kx; Leechpoles' 2d4 count via instance creatureTokens if live); t3-hf.ts Weight of
  Opulence `hope` lose per bag with an `ifUnable` Stress per unpaid bag (goldOf is on the adversary run since E7.3:
  prove it); t3-core.ts Money Talks `optional` (`by: "targets"`) with `convertMarks from: "hp" into: "gold"` (E2.3 live;
  keep the GM Collect button); t4-hf.ts Ill Omen `modifyRoll dieBonus { die: "fear", amount: gmFear }` (after dcm-m7tm in
  E1.4a / E1.4b); t4-hf.ts Seven-Headed `features.removeOptions` (live), Forlorne Transform `changeForm` (live);
  t3-core.ts Immovable Object passive `forcedMoveReduce` 2 (live, CB p.230); Doom / Tentacle-style `reduceWith: "hope"`
  (after dcm-spj0). Keep unless E7.4 landed them: Unleash Hellfire perArea (dcm-va0f), Lightning Strike / Bolt
  checkFails (dcm-4yg4), Slash and Burn (dcm-i55).

- **CT2** (lane:w2-campaign-time, lane4-ct2, batch B; S; dcm-jq4b). Undoing End day (and a Witherwild day-icon jump
  forward via `setDay`) also restores the campaign day (week, cycle, cycleDay) and the time of day, in the same undo
  group: widen `actionLogFields` with an optional time snapshot (convex/lib/validators/actionLog.ts), `undoEntry`
  (convex/lib/actionLog.ts) restores it, `endDay` / `setDay` always write a group row carrying it (even when no use
  ended). Behaviour for undoing an older End day per the user's answer to Q4 (until answered: only the latest End day's
  time snapshot is restored; an older one gives back its uses but refuses to move the calendar, with a feed line).
  E2E: tests/e2e/lane4-end-day-undo.spec.ts. Witherwild cycles and the wave-9 CT tests unchanged.

## Not placed this wave (wave 11 notes)

- dcm-9z28 GM-owned areas: widening `combatAreas.characterId` to optional makes every reader handle a missing caster;
  readers sit in ~12 files owned by batch-A tracers (cardRows, cardRunner, featureRunner, combatFeatures, combatActions,
  adversaryHits, combatCards, restHooks, combatScenes, combatTokens, combatVision, area-overlay). Run it first in wave 11
  (or solo between waves), owning those files.
- dcm-22q Grace-Touched "would mark Stress": every Stress-marking path (window, cardRunner, featureRunner, rests); cross-lane.
- Combat UI redesign beads (dcm-bxp.99.32 and combat-ui-labelled: 733, 5dg, p1r, y3e, aiwg) wait for the design.
- dcm-bxp.28 (narrow after versionSheets runs), dcm-bxp.31 / .40 (D5 / sheet leftovers), dcm-bxp.140 (sign-up text
  leftovers: a small independent tracer if batch B needs a sixth), dcm-bxp.17 (Horizon hex crawl), lane:own-plan,
  lane:user-run, lane:needs-user-answer, P4 narrative (dcm-by2d, dcm-lezi).

## Questions for the user (defaults the tracers build until answered)

1. **Catrin's Spirit Flame** (HF p.81: "CATRIN ... ATK: +3 | Spirit Flame: Far | 3d8+5 mag"). The answer named the
   Guahalan Spirit Singer's attack of the same name (HF p.77) as fire. Is Catrin's fire too? (a) yes, fire; (b) no;
   default (b) until answered.
2. **Per-target advantage on one attack roll** (CB p.104: "you only make one attack roll and compare its result to the
   Difficulty of each eligible target"; CB p.100: "When you roll with advantage, you add a d6 advantage die to your
   total ... you subtract a d6 disadvantage die"). (a) one d6 rolled once: added against targets with advantage,
   subtracted against targets with disadvantage, ignored for the rest; (b) a separate d6 per target. Default (a).
3. **Lead by Example's benefit** (CB p.342: "The next PC to make an attack against that adversary can clear a Stress or
   gain a Hope"). (a) the attacker picks Stress or Hope in the Attack bar before rolling, and the benefit is used up by
   that attack, hit or miss; (b) same pick, but only a successful attack uses it; (c) picked after the roll. Default (a).
4. **Undo of an older End day** (dcm-jq4b). (a) only the latest End day moves the calendar back; undoing an older one
   gives back its uses only, with a feed line; (b) undoing an older End day steps the calendar back one day and keeps
   the later days' ends; (c) undoing an older End day is refused while a later End day stands. Default (a).

### User answers 2026-11-01 (all four defaults confirmed; build them)
1. Catrin's Spirit Flame (HF p.81) is fire too.
2. Per-target edges: ONE d6 rolled once, added vs targets with advantage, subtracted vs disadvantage, ignored otherwise.
3. Lead by Example: the attacker picks Stress or Hope before rolling; that attack uses it up, hit or miss.
4. Undo of an older End day returns its uses with a feed line; only undoing the latest End day moves the calendar back.
