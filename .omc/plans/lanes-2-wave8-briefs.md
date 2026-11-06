# lanes-2 wave 8: tracer briefs (restart 2026-10-31)

The first wave-8 agents were stopped mid-work. Each new agent continues its tracer in the SAME worktree and branch,
where the old agent's partial changes are still uncommitted. Review them (`git diff`), keep what is right, finish.

## Common rules (every tracer)
- Read CLAUDE.md, AGENTS.md, docs/workflow.md, the relevant parts of docs/best-practices.md, your block in
  .omc/plans/lanes-2.yaml, docs/tasks/TASK-LN-V2.md (V2's triage table: your beads and which half of each is yours)
  and your round-1 task doc docs/tasks/TASK-LN-<lane>.md.
- Owns are binding: `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml <ID> rebuild HEAD`.
- Never edit the three effect types.ts files (V2 owned them) or src/lib/srd/** (wave 9), except R1 which owns three SRD files.
  Missing vocabulary term: file a bead `--labels vocabulary-gap,lane:w3-vocabulary`.
- Skip beads labelled `combat-ui` (they wait on the user's combat UI design, dcm-bxp.99.32); keep UI changes minimal.
- A change needed in another lane's file: do your part, file a follow-up bead with that lane's label.
- Unclear rule: simplest reading that matches the book, listed under QUESTIONS in your task doc with quote and page
  (books, git-ignored: /home/petar/daggerheart-campaign-manager/.reference-private/text/core.txt and hopefear.txt).
- A public function's args change or a new public function: tell the orchestrator the authz entry (you don't own
  tests/convex/authz/* unless listed).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass; 11 tracers run at once, so run vitest with
  `--maxWorkers=2 --testTimeout=120000`. The auth-signup flood test is load-flaky.
- Write docs/tasks/TASK-LN2-<ID>.md (what landed, beads done / partly done, follow-ups, QUESTIONS).
- Commit ONCE on your branch, author petar (existing git config), NO Co-Authored-By trailer. Never push, merge or close beads.
- Final report: branch + commit; beads done vs partly done; follow-ups; data switches ready for wave 9 per SRD file;
  questions; check results; merge-time actions.

## User answers that apply (2026-10-31)
- Duality-die bonus (Backhanded Guidance, Ill Omen; dcm-jog, dcm-3ou): never a critical (a crit needs the dice to match
  as rolled); the bonus only decides Hope vs Fear, and a tie after the bonus is WITH FEAR.
- Words of Discord (dcm-c75): remember a target for the WHOLE CAMPAIGN; every later cast on that creature takes -5.
- GM-controlled PC (dcm-idz: Enthralled, Weredrake Curse): 'GM-controlled' tag; the GM moves the token and attacks with
  it using a d20 + the PC's weapon like an adversary; Weredrake swaps to the Weredrake stat block until it ends.
- Spirit Weapon (dcm-xbtw): per-attack check box 'Use as Spirit Weapon' (data in wave 9).
- Lead by Example: other PCs only. Weight of Opulence: each bag a Hope, each unpaid bag a Stress. 'Take Severe / Minor
  damage' with no number: mark 3 / 1 HP outright. Exile: target and whole party. Covered in Spiders: the player picks.
  Half of an odd result rounds up. Dark Cloud: Close radius by default, the GM can draw/adjust it. Mysterious Mist:
  point within Very Close, Very Close radius, blocks sight. (Mostly data for wave 9.)
- Perfect Recall stays a rider: build dcm-cfpv (recall riders through the Hand / characters.moveCard) now.

## Per tracer
- **E1** (lane:w1-e1-triggers-rolls, branch lane2-e1): open engine-side beads of the lane + dcm-cfpv + the die-bonus answer.
- **E2** (lane:w1-e2-damage-window, branch lane2-e2): open engine-side beads of the lane. dcm-5cn5 moved to E7; dcm-22q is
  a wave-9 cross-lane tracer: skip both.
- **E3** (lane:w1-e3-steps-saves, branch lane2-e3): you own card-effects/run.ts, so also the run.ts half of other lanes'
  beads V2 listed under e3 (mhn, i55, 63j, 4yg4, b9hc, awh, rs1z ...), and make V2's manual-prompt fallbacks real where
  the engine can apply them (forcedAttack, changeForm, inventory giveGold/giveItem, the four new Mod kinds).
- **E4** (lane:w1-e4-targeting-areas, branch lane2-e4): areas (walls, follow/anchored, seeThrough, per-observer,
  leave/dispel, count, endsOnCaster, onEnter/onCross/onActInside), points, movement (you emit the would-move event and
  do drags; E7 runs the triggered adversary use), card placement of areas. validators/combatMaps.ts is yours;
  validators/encounters.ts is E7's. NOT the map overlay (dcm-lqnt, wave 9 with the user's sprites), but expose a
  public, access-checked list of live areas for a map if a bead needs it.
- **E5** (lane:w1-e5-checks-limits-numbers, branch lane2-e5): number sources V2 stubbed to 0 (markedHp, recorded,
  creatureCount.chain), optionRemoved, passives (dcm-eut from/buyOff; E7 does the attacker's pay prompt), nsqo, 5kxg,
  facts beads if yours; dcm-c75 campaign-long memory (if it needs a stored-field widen outside your owns, do the pure
  logic and file a follow-up with the exact widen).
- **E6** (lane:w1-e6-endings-durations, branch lane2-e6): priority to endings the SRD data already uses but the server
  ignores: endEffect applied (dcm-9z2z, dcm-8x8), tokensGone on sheet effects (dcm-erhv), effect-end lookup reading
  upgrade options (dcm-i2tv), new end events (castsSpell, benefitGranted), endFear amounts (dcm-8bv), endsOnCaster,
  endsOnRoll (dcm-t8c, dcm-wn7 if yours). List which R1 reminders can be removed after your merge.
- **E7** (lane:w1-e7-adversary-engine, branch lane2-e7; largest lane, work in priority order, a tail with notes is fine):
  (1) dcm-b3bb check-table rows in translateStep, dcm-e16o run context (hopeOf, saveRaisers, creatureTokens, map
  creatures, chain), dcm-iedr condition step keeps mods / endsOnCaster / endsOnRoll, bearer/attacked riders (mm0f, yd5h
  halves); (2) pcEscapes trigger (types.ts read-only: file the type bead, add the matchesTrigger case when it exists, or
  model it another way); (3) dcm-5cn5 respond args; validators/encounters.ts widen → migrate → narrow (yd5h, gx3, and
  E4's forcedMoveReduce / moveLimit if filed); (4) dcm-idz GM control per the answer above; (5) the rest.
- **E8** (lane:w1-e8-session-features-rests, branch lane2-e8): feature runner, delegates (dcm-d1d), prompts, companion
  (dcm-b9hc, dcm-2z2 half), rests and downtime, inventory gifts (vf7i), Vitality's permanent pick (dcm-40mj: runner side;
  follow-up if the level-up flow isn't yours).
- **R1** (branch lane2-r1, bead dcm-s9md): put back a manual table reminder (card words) beside the new data on
  Confusing Aura, Avatar of Terror, Time Lock (endEffect, dcm-9z2z), Rune Ward (exhaust, dcm-a9c), Breaking Blow
  (attackedRider, dcm-yd5h), Flight / Invisibility (tokensGone, dcm-erhv); keep the data; comment each with the engine
  bead whose merge removes it; check the reminder really shows and doesn't double up. Tests in the owned test files.
- **MG** (branch lane2-mg, bead dcm-3ias): batched, idempotent @convex-dev/migrations migration in
  convex/migrations/vanishingActMarker.ts adding the Vanishing Act source marker (exactly as convex/lib/cardRunner.ts
  writes it since C2, a2b9bced) to characters who are Cloaked, have Vanishing Act and lack the marker; follow the house
  pattern (convex/lib/migrations.ts, convex/migrations/run.ts, e.g. handSharing.ts); tests migrated / untouched / run
  twice; say how to run it. Do NOT run it against any deployment.
- **U2** (branch lane2-u2, bead dcm-vqs0): (1) toast to the uploader when the byte check rejects their file: "That file
  isn't a real PNG/JPEG/WebP/GIF image, so it was removed." No global toast exists: smallest correct thing, e.g. an
  uploadNotices table (index + retention or delete on read), a userQuery for the caller's unseen notices (returns
  validator) and a dismiss userMutation (no mutation from an effect), a small src/components/uploads/ notice used by the
  six upload UIs, inside an error boundary; authz entries in tests/convex/authz/core.entries.ts (owned). (2) a real
  image whose bytes differ from its recorded type is ACCEPTED and its type fixed (files row and what photo import sends).
