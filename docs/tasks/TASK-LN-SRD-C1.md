# TASK LN-SRD-C1: SRD domain-card data for Arcana, Blade, Bone, Codex, Dread, Grace

Plan `.omc/plans/lanes.yaml`, tracer SRD-C1 (lane `w2-srd-data`), wave 5. Wave 4 widened the vocabulary (tracer V,
`docs/tasks/TASK-LN-V.md`) and taught the engines to run it (E1-E8). This tracer switches the six domain tables over:
every `manual` step was checked against the wave-4 vocabulary. Data and tests only: no `types.ts`, `run.ts` or engine
file changed. Book pages are printed pages (CB = Core Book, HF = Hope & Fear); the numbers were checked against the
book text.

## Manual steps

Counted by `tests/unit/card-effects/coverage.test.ts` (every object with `kind: "manual"`, nested ones too).

| File | Before | After |
|------|-------:|------:|
| arcana.ts | 13 | 7 |
| blade.ts | 2 | 1 |
| bone.ts | 2 | 1 |
| codex.ts | 27 | 21 |
| dread.ts | 3 | 2 |
| grace.ts | 9 | 8 |
| **Total** | **56** | **40** |

## Cards automated

"Engine" names what still has to land before the server acts on the new data. Until then the runner shows the step to
the table (`exhaust`, `loadout`) or the step is carried for the server to read. Each card's test is in
`tests/unit/card-effects/<domain>.test.ts`.

| Card (page) | Was | Now | Bead | Engine |
|---|---|---|---|---|
| Rune Ward (CB p.328) | manual "the ward's power ends … recharged on your next rest" | two `exhaust` steps (`per: "rest"`, uses `main` and `ally`, one ward); the ally trigger is `unlimited` (range kept for readers that don't know it) | dcm-war, dcm-uj0 | run.ts writes `exhaust` (dcm-a9c); window honours `unlimited` (dcm-ofo) |
| Cinder Grasp (CB p.328) | manual On Fire damage | On Fire `condition.mods`: `bearerRider` `on: "acts"`, `timing: "after"`, 2d6 magic to the bearer. The manual reminder **stays** until the server runs bearer riders: today nothing else tells the table, and `tests/convex/combat-cards.test.ts` uses it as its manual-row fixture | dcm-f0m | bearer riders run (dcm-0wj1, dcm-mm0f); then drop the manual step and move that fixture to another card |
| Flight (CB p.328) | manual descent on every spend | Flying effect `endsOn: ["tokensGone"]`; the spend use keeps only the token spend | dcm-7n7 | firing `tokensGone` for a card's sheet effect (new dcm-erhv) |
| Chain Lightning (CB p.328) | manual "the chain continues" | `followUp` `targets.origin: "chain"`, `repeat: { until: "noTargets" }`; one damage roll for the move (E3 QUESTIONS 1) | dcm-rou | the server passes chain links (dcm-x4ft); CHAIN_CARDS can go (new dcm-io4m) |
| Confusing Aura (CB p.329) | manual "this spell ends" | `endEffect` (own effect); the extra layers are capped by free Stress (`max: free stress`) | dcm-8x8 | apply `endEffect` (dcm-9z2z) |
| Sensory Projection (CB p.329) | duration `manual` only | `endsOn: ["takeDamage"]` (casting another spell is still by hand) | dcm-utu | hits on a PC (dcm-t8c) |
| Adjust Reality (CB p.329) | an `other` use with a manual step for non-action rolls | the reaction takes any roll (`afterAllyRolls.roll: "any"`); the `other` use is gone | dcm-3ft | offered on another player's roll (dcm-cfpv) |
| Versatile Fighter (CB p.330) | manual "use a different trait" | passive `weaponTrait` mod, `weapon: "either"`, `choice: "trait"` (no pick: the weapon's own trait, `combatActions.weaponTraitFor`) | dcm-5dg | Attack bar trait picker (dcm-jkhp) |
| Breaking Blow (CB p.331) | manual "another character's attack: add 2d12 by hand" | the mark's `attackedRider` `by: "others"`, `onSuccess`, +2d12; your own attack keeps the `extra` use (so it never adds twice) | dcm-9gw | attackedRider damage (dcm-yd5h) |
| Slumber (CB p.332) | duration `manual` only | `endsOn: ["takeDamage", "gmSpendsFear"]` | dcm-utu | done for card damage (E6); GM Fear intent dcm-kmr |
| Parallela (CB p.332) | manual extra target | effect mods `extraTargets` (`on: "attack"`, 1), `endsOn: ["bearerAttacks"]` | dcm-y3e | done (E1 live mods); Attack bar dcm-jkhp |
| Mystic Tether (CB p.333) | manual "a flyer is grounded" | `move` `mode: "ground"` on a hit | dcm-yzr | PC's Flying effect ending (dcm-x4ft) |
| Time Lock (CB p.333) | manual on cast, two manual outcomes on maintain | a self effect "Time Lock" until your next rest; a failed maintain roll is `endEffect` | dcm-8x8 | apply `endEffect` (dcm-9z2z) |
| Teleport (CB p.333) | `min -2 max 3` | `values: [3, 1, 0, -2]` (only the printed options) | **dcm-uyc** | done (E3 runner and dialog) |
| Codex-Touched (CB p.333) | manual swap | `loadout` `op: "swapWithVault"` | dcm-p1r | Hand sends `swapWith` (dcm-aw16) |
| Shared Clarity (CB p.333) | `upTo 2` | `upTo 2, min 2` ("choose two") | dcm-d7h | done (E4 `buildRun`) |
| Transform (CB p.334) | duration `manual` only | `endsOn: ["takeDamage"]` | dcm-utu | hits on a PC (dcm-t8c) |
| Timejammer (CB p.334) | duration `manual` only | `endsOnRoll: { roll: "action", by: "caster", targetsCreature: true }` | dcm-cwh | roll paths fire it (dcm-wn7) |
| Transcendent Union (CB p.334) | `any` | `any, min 2` ("two or more") | dcm-d7h | done (E4 `buildRun`) |
| Invisibility (CB p.334) | manual on every token spend | Invisible effect `endsOn: ["tokensGone"]`; the spend use only spends | dcm-7n7 | dcm-erhv |
| Words of Discord (CB p.335) | situation text only | the repeat cast's requirement carries `check: { kind: "usedOnBefore" }` (the text stays the fallback) | dcm-c75 | facts and memory from cardRunner (dcm-gl9) |
| Share the Burden (CB p.335) | label only ("at most the target's marked Stress") | choice `max: marked target stress`, `afterTargets: true` | **dcm-fnq** | done (E3 runner); cardRunner clamp can go (dcm-io4m) |
| Shared Trauma (HF p.180) | choice `min 1` | `max: marked target hp`, `afterTargets` (the clearing creature's marked HP: "clear an equal number") | dcm-fnq (comment) | done (E3 runner) |
| Wall of Hunger (HF p.181) | effect ends by hand | `endsOn: ["markHp"]` ("lasts until you mark a Hit Point"); the wall stays manual (below) | - | effect ends from hits on a PC (dcm-t8c) |
| Avatar of Terror (HF p.181) | manual "you revert" | `endEffect` when you have no Hope before an action roll | dcm-8x8 | apply `endEffect` (dcm-9z2z) |

## Manual steps left, and why

Narrative or GM-ruled parts stay manual by design (TASK-CA-CA0.md "Left to manual by design": questions to the GM,
summons and constructs, walls and zones the map does not model, Copycat, Shared Clarity's and Transcendent Union's
"choose who marks"). These have no bead.

| File | Card / use | Why |
|---|---|---|
| arcana | Floating Eye | the orb (a summon; the map has no orb token) |
| arcana | Premonition | "make another move instead": the `rescind` fold is the mechanic, the text is for the table |
| arcana | Rift Walker (2) | the marking and the rift (narrative) |
| arcana | Earthquake | difficult terrain and crumbling structures (map terrain is not modelled, CA0) |
| arcana | Sensory Projection | the vision itself (narrative) |
| blade | Vitality | a level-up pick: no activation runs steps "when you choose this card" (**new dcm-40mj**) |
| bone | Know Thy Enemy | a question to the GM (CA0) |
| codex | Ice Spike (summon), Telepathy, Magic Hand, Adjust Appearance, Illusion, Runic Lock, Reveal, Recant's forgetting, Construct Command, Plane Gate, Memory Delve, Transform's object form, Teleport's arrival (2) | narrative or the GM's ruling |
| codex | Create Construct | the construct (summons are manual, CA0) |
| codex | Mysterious Mist | could be an `area` with `blocksSight`, but the area's size and whether "heavily obscures" blocks sight are open (**rule question dcm-gzmo**) |
| codex | Wall of Flame, Manifest Wall | an `area` `shape: "wall"` exists, but `placeArea` refuses walls until the stored-shape widen (dcm-3p7s): switching would make the cards unusable (comment on dcm-cma) |
| codex | Banish | the return roll needs a `falling` save whose start is the Difficulty rolled at the cast; no number source reads it later (comment on dcm-b77) |
| codex | Shared Clarity, Transcendent Union | who marks the Stress / HP (CA0 by design) |
| arcana | Cinder Grasp | kept beside the new `bearerRider` until the server runs it (dcm-0wj1), see above |
| dread | Siphon Essence | expressible now (`clear` on you of `markedThisMove` target HP, dcm-0ib), but `convex/combatCards.ts` `siphonHeal` heals from this use and hides the step's text: switching alone would heal twice (seen in `tests/convex/combat-cards.test.ts`). Switch together with removing `siphonHeal` (added to dcm-io4m) |
| dread | Wall of Hunger | the wall (walls refused, as Wall of Flame; dcm-cma, dcm-3p7s) |
| grace | Through Your Eyes, Thought Delver (3), Astral Projection | narrative / the GM tells |
| grace | Words of Discord (2) | the forced attack on another adversary: `mustAttack` only names the caster (**new dcm-c8h3**) |
| grace | Copycat | copying another card's entry at run time (CA0 by design) |

Not switched, though not a manual step:

- Grace-Touched's Armor Slot for a Stress could use the `wouldMarkStress` trigger, but how the swap is chosen is an open
  rule question (dcm-22q, TASK-LN-A1.md). Its HP-to-Stress rider keeps `whenTargetMarksHp` with no `stage`: the
  "would" stage on the PC's own attacks is dcm-gtmp.
- Rune Ward's ally still pays with a `hope` step on the holder, not `costs` + `paidBy: "triggerSubject"`: run.ts doesn't
  read `paidBy` yet (dcm-a9c) and would charge the caster.
- Rune Circle is not an `onEnter` area: entry steps are named in the feed but not run, and "where you stand" needs the
  point argument (dcm-76l5, dcm-u2wx). The `rune-circle-enter` use stays.
- Dread-Touched keeps its situation text for "succeed with Fear": the E1 `gmWouldGainFear.byYou` filter is a rider
  phase, and moving the use from reaction to rider is beyond a data switch.

## Beads

| Bead | State |
|---|---|
| dcm-fnq Share the Burden, choice max reads the target | data done (and Shared Trauma); comment added; for the orchestrator to close after merge |
| dcm-uyc Teleport, listed values | data done; comment added; for the orchestrator to close after merge |

Data sides also done here (beads owned by wave-4 lanes, left open): dcm-war, dcm-uj0, dcm-f0m, dcm-7n7, dcm-rou,
dcm-8x8, dcm-utu, dcm-3ft, dcm-5dg, dcm-9gw, dcm-y3e, dcm-yzr, dcm-p1r, dcm-d7h (closed), dcm-cwh, dcm-c75.

## Follow-ups filed

- dcm-c8h3 (`vocabulary-gap`, `lane:w2-srd-data`): Words of Discord, an attack against another adversary.
- dcm-40mj (`vocabulary-gap`, `lane:w2-srd-data`): Vitality, a permanent pick when the card is chosen.
- dcm-gzmo (`rule-question`, `lane:w2-srd-data`): Mysterious Mist's area size and "heavily obscures".
- dcm-erhv (`lane:w1-e6-endings-durations`): end a card's sheet effect when its tokens reach 0 (Flight, Invisibility).
- dcm-io4m (`lane:w1-e4-targeting-areas`): cardRunner drops `CHAIN_CARDS` and the Share the Burden clamp; comment:
  switch Siphon Essence's heal to data together with removing `combatCards.ts siphonHeal`.
- Comments on dcm-b77 (Banish's start Difficulty) and dcm-cma (walls wait on dcm-3p7s; Rune Circle).

## Checks

`pnpm lint` and `pnpm typecheck` pass. `pnpm test` on a machine at load average 67-80 (other tracers running): 112
failures in 69 files, 101 of them "Test timed out" and the rest jsdom / mock errors (`withOptimisticUpdate is not a
function`, `dialog.showModal`) and two speed budgets, in files this tracer doesn't touch; rerun alone,
`tests/unit/combat-hand.test.tsx` passes 47/47, and `tests/unit/card-effects/` with `tests/convex/combat-cards.test.ts`
pass 645/645. `coverage.test.ts` passes unchanged; two more uses are
refused by its generic context with reason `choice` (Share the Burden and Shared Trauma: its target has no marked
Stress / HP, so any transfer is over the new max), which that test allows.
