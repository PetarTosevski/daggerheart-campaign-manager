# TASK-LN4-S1: domain card data, wave 10 (plan lanes-2, tracer S1.4, branch lane4-s1)

Rule: switch only data whose engine path is live at rebuild HEAD (after batch A), proven through the real server path in
`tests/convex/lane4-s1-card-switches.test.ts` (real SRD entries, no fixtures); otherwise keep the manual reminder and
list it for wave 11. Unit tests in `tests/unit/card-effects/*.test.ts` follow the data.

## What landed (live switches, each proven through the real path)

| Card (file) | Change | Proven through |
|---|---|---|
| Vitality (blade.ts, CB p.330) | `auto` `whenYouChooseThisCard`: `choose` "Two benefits" (2, distinct) of permanent self effects (`stressMax` +1 / `hpMax` +1 / Major and Severe +2), then `toVault` permanent. Labels match E8.4's fixture and level-up draft. classification `p("auto", ...)` | `levelUp.apply` to level 5: LEVEL_UP_RULE without the picks; with `hp` + `thresholds`: +1 HP slot, `card:vitality:*` bonuses, card vaulted |
| Invisibility (grace.ts, CB p.334) | `spend-token` reminder dropped (`steps: []`) | `useCard` spend-token: the last token ends Invisible on the ally |
| Time Lock (codex.ts Book of Grynn, CB p.333) | maintain reminder dropped | failed maintain roll ends the effect, no reminder |
| Confusing Aura (arcana.ts, CB p.329) | "all 4 or lower" reminder dropped | `useCard` attacked: a 6 destroys a layer; a 4 ends the spell |
| Rune Ward ally (arcana.ts, CB p.328) | holder-Hope reminder dropped | holder at 0 Hope: CARD_COST_UNPAID; at 2 Hope the holder pays 1, the caster nothing |
| Encore (grace.ts, CB p.335) | "physical for now" reminder dropped | the Hand's `triggerDamageType: magic` reaches the damage ("damage 9 mag") |
| Lead by Example (valor.ts, CB p.342) | the tag carries `attackedRider { by: "others", attackerSteps: [choose benefit: clear a Stress / gain a Hope] }`; manual step dropped (dcm-kso9, dcm-903q) | Ash's own attack takes no benefit and keeps the tag; Bryn's attack with `benefit: "hope"` gains the Hope and uses the tag up (hit or miss) |
| Hold the Line (valor.ts, CB p.342) | `pull` is `auto` `whenEnemyEntersRange` veryClose, requires the stance, moves / Restrains `triggerSource` (`intoMelee`); the stance's manual line dropped (dcm-trib) | GM moves the bear within Very Close: pulled into Melee and Restrained; without the stance nothing |
| Mysterious Mist (codex.ts Book of Tyfar, CB p.332) | "draw the area" reminder dropped (dcm-9nlr) | `useCard` with `point`: a sight-blocking area on that square |
| Hush (midnight.ts, CB p.336) | area `endsOnCaster: ["majorDamage"]` | a Major hit on Ash ends the area and the bear's Silenced |
| Veil of Night (midnight.ts, CB p.336) | manual darkness -> `area` wall (point, `placeWithin: far`, radius melee, `blocksSight`, `seeThrough: "owner"`, `ownerPerObserver: "hidden"`, `endsOnCaster: ["castsSpell"]`); effect `endsOn: ["castsSpell"]` (dcm-o44e) | `useCard` with `point` + `points`: a wall between them; casting another spell ends wall and effect |
| Eclipse (midnight.ts, CB p.337) | manual darkness -> `area` (centre self, `anchored`, radius far, `blocksSight`, `seeThrough: "ownerAndAllies"`, `endsOn: gmSpendsFear`, `endsOnCaster: takeSevere`) (dcm-o44e) | placed on the caster's square; a Major hit keeps it, a Severe hit ends it |
| Through Your Eyes (grace.ts, CB p.335), Sensory Projection (arcana.ts, CB p.329) | effect `endsOn` gains `castsSpell` | casting another spell ends each (card path `endSpellCast`) |

## Kept (reminder stays; proven not live on every path)

- **Flight** (arcana.ts, CB p.328) `spend` reminder: an attack (or a plain action roll) spends the last token, Flying stays
  (only the card path runs `endTokensGone`). Follow-up dcm-od5f.
- **Avatar of Terror** (dread.ts, HF p.181) upkeep reminder: at 0 Hope an attack's upkeep shows the reminder, the form
  stays (combatActions doesn't apply an auto rider's `endEffect`). Follow-up dcm-od5f.
- **Breaking Blow** (bone.ts, CB p.331) reminder: restored. Another PC's attack reads a seeded tag (lane3-e1b), but on the
  real path the attack that places the tag also runs the card's own `extra` auto, whose `clearCondition` sees the new tag
  and removes it at once. Bug dcm-npgb (pinned in the test).
- **Words of Discord** (grace.ts) "the GM runs it": the Hand doesn't ask for the victim yet (TASK-LN4-E1A). dcm-ypgk.
- **Critical Inspiration / Rousing Strike** (valor.ts): attack riders; the Attack bar doesn't ask per-chooser picks
  (dcm-vbzy (2)(3)). Follow-up dcm-vxd1.
- Banish (dcm-b77, E7.4 did not land it), Tempest Hurricane limit, Grace-Touched (dcm-22q): unchanged as briefed.

## Beads

- dcm-40mj: data done; closable. dcm-31hq: closable (E8.4's flow + this data).
- dcm-trib, dcm-g90o: done (both already closed by bookkeeping; the data now matches).
- dcm-o44e: closable (Eclipse / Veil of Night areas with `seeThrough`).
- dcm-kso9: data done (Lead by Example); closable with E1.4b's engine. dcm-903q: closable (other PCs only, built).
- dcm-q40t: the S1 data parts (Rune Ward payers, Encore damage type) proven live; the bead itself is E4's.
- dcm-vbzy: (2)(3) left (dcm-vxd1); (1) done in wave 9.
- dcm-c8h3: data done since wave 9; the reminder waits on dcm-ypgk.

## Follow-ups filed

- dcm-od5f (lane:w1-e1-triggers-rolls, P3): attack and plain-roll paths apply what an auto rider ends (endEffect,
  tokensGone): Flight, Avatar of Terror.
- dcm-npgb (lane:w1-e1-triggers-rolls, P2 bug): Breaking Blow's own `extra` auto clears the tag the same attack placed.
- dcm-vxd1 (lane:w1-e1-triggers-rolls, P3): the Attack bar asks per-chooser picks for riders.
- dcm-zne3 (lane:w1-e2-damage-window, P3): the hit window runs a PC's auto `whenAttacked` card uses (Confusing Aura;
  today the player taps it on the Hand, and that path is live).
- dcm-ypgk (lane:w1-e1-triggers-rolls, P3): the Hand asks Words of Discord's victim.

## Data switches ready for wave 11 (per file, with engine bead)

- arcana.ts: Flight `spend` drop the manual step (dcm-od5f).
- dread.ts: Avatar of Terror `upkeep` drop the manual step (dcm-od5f).
- bone.ts: Breaking Blow drop the manual step (dcm-npgb).
- grace.ts: Words of Discord drop both manual steps (dcm-ypgk).
- valor.ts: Critical Inspiration / Rousing Strike to `choose.by { to: allies }` (dcm-vxd1).
- codex.ts: Wall of Flame's "create the wall" manual step could become an `area` wall now that card walls place (not in
  this brief; check its crossing damage path first). Banish (dcm-b77).
- Note: Flight is not `exclusive`, so casting it again while flying adds a second Flying effect (seen in testing). A
  one-word data fix (`exclusive: true`) if wanted; not changed here.

## QUESTIONS

1. **Eclipse's darkness: where it is.** CB p.337: "plunge the entire area within Far range into complete darkness only you
   and your allies can see through ... This spell lasts until the GM spends a Fear on their turn to clear this effect or
   you take Severe damage." Built: an area of Far radius on the square you stand on when you cast it (`anchored`); it
   stays there if you move. Alternative: it moves with you. Which?
2. **Veil of Night's Hidden.** CB p.336: "You're considered Hidden to adversaries on the other side of the veil." Built
   with `ownerPerObserver: "hidden"` (E4's vocabulary): you are Hidden to every observer whose sight the veil blocks;
   only you see through. The curtain's two ends must each be within Far range of you; it is one square thick. Fine?
3. **Through Your Eyes / Sensory Projection ending on a spell.** CB p.335: "until you cast another spell or until your
   next rest"; CB p.329: "You drop out of this vision upon taking damage or casting another spell." Built with
   `castsSpell` (E6's end: any other spell card you cast ends it; abilities don't). Fine?

## Merge-time actions

- None: data and tests only. No authz entries, no codegen, no migration, no fallback lines.
- `tests/e2e/lane4-vitality-level-up.spec.ts` (E8.4's) now un-skips: `cardChoiceAsks(["vitality"])` is non-empty. Its
  labels ("Two benefits", "One Hit Point slot", "+2 to your damage thresholds", "One Stress slot") match this data. Not
  run here (the brief names no e2e for S1.4); E8.4 ran it against identical data.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=1 --testTimeout=120000`: 434 files, 10024 passed, 1 expected fail. New: lane4-s1-card-switches.test.ts (17).
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml S1.4 rebuild HEAD`: OK.
