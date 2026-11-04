# TASK-LN3-S1: domain card data, wave 9 (plan lanes-2, tracer S1, branch lane3-s1)

Rule: switch only data whose engine path is live at rebuild HEAD (proven through the real server path in
`tests/convex/lane3-s1-card-switches.test.ts`); otherwise keep / restore the manual reminder and list it for wave 10.

## What landed

Live switches (proven through combatActions.attack / combatCards.useCard / rolls.manualRoll / pcResistance):
- dread.ts **Dark Army** strike: `whenYouDealDamage.within: "veryClose"` replaces the situation check box (E1 dcm-76l5).
  Server test: a target 2 squares away gets the rider and spends tokens; 7 squares away the rider is skipped.
- dread.ts **Spectral Mist**: `duration: "scene"`, `endsOn: ["actionRoll"]` (E1 dcm-wn7). Server test: a reaction roll
  keeps it, an action roll ends it.
- midnight.ts **Midnight-Touched**: the Fear Die is `dualityDie fear` from the host roll; the dialog number is gone
  (dcm-vbzy (1), E1 dcm-n0dv). Server test: same dice with / without the rider differ by the Fear Die.
- sage.ts **Rejuvenation Barrier**: already `from: "outsideArea"` at HEAD (SRD-C2); server test proves the resistance
  applies only when the attacker isn't in the barrier. No data change.
- valor.ts **Lead by Example**: reminder and endsWhen say "other PCs only" (dcm-903q answer); stays manual (engine E1.3b).

Restored reminders (dcm-ky8b, dcm-s9md):
- dread.ts **Avatar of Terror** upkeep at 0 Hope: manual "revert ... remove the Avatar of Terror effect" (dcm-m48i).
- bone.ts **Breaking Blow**: manual "another PC's next successful attack deals +2d12" (dcm-yd5h).
- grace.ts **Invisibility** spend-token: manual "last token ends the effect" (dcm-m48i / dcm-erhv).

Data + reminder (engine not live):
- codex.ts **Mysterious Mist** (dcm-gzmo answer): `area` step, point within Very Close, Very Close radius, `blocksSight`,
  temporary; manual "draw the area" stays until card paths place areas (dcm-9nlr / dcm-m48i).
- arcana.ts **Rune Ward** ally use: `costs` hope 1 + `paidBy: "triggerSubject"` (dcm-uj0 / dcm-a9c) replaces the `hope`
  step; the run charges the holder (pay step `payerId`) and refuses when their known Hope is short. cardRunner doesn't
  pass `payers` / `hopeOf` yet (dcm-q40t), so a manual "holder spends a Hope; none: can't use the ward" stays. The two
  exhaust notes still show exactly once on an 8 (TASK-LN2-R1 test unchanged and green).
- grace.ts **Encore**: `sameAsTrigger` typed `weapon` (dcm-m5fy); manual "applied as physical for now" until cardRunner
  fills `trigger.damageType` (dcm-q40t).
- codex.ts **Banish**: `record: lastRoll` + `bearerRider` pcRollsWithFear save with `falling` from `recorded`
  (dcm-b77); manual step stays (bearer riders on instances not run yet, E7 / dcm-f70y).
- grace.ts **Words of Discord** (both uses): `forcedAttack` against another adversary (unlimited, one); manual step stays
  until the server runs forced attacks (dcm-f70y). Server test: the use still resolves with Stress + the manual text.
- arcana.ts **Chain Lightning** (dcm-q13x answer): data unchanged; per-link roll is run.ts's (E3.3). Unit tests now use
  all-3 dice after the first save so they hold before and after that change.

Kept as is: Second Wind / Critical Inspiration / Rousing Strike (dcm-vbzy (2)(3)), Hold the Line (dcm-g90o), Tempest
Hurricane limit (dcm-3oe).

## Beads

- dcm-ky8b: done (three reminders restored). dcm-s9md: closable (silent reminders back for every S1 card).
- dcm-gzmo: done (data + reminder). dcm-903q: done for the data side (reminder text); engine is E1.3b.
- dcm-vbzy (1): done. dcm-uj0 data side done (remaining: dcm-q40t payers).
- Vocabulary beads checked in these files, all still open, nothing to switch at HEAD:
  - dcm-o44e (Eclipse / Veil of Night): `AreaSpec.seeThrough` now exists (E4), but card paths don't place areas
    (dcm-9nlr); switch in wave 10 after dcm-9nlr / dcm-m48i.
  - dcm-5yew (Phantom Retreat, Forest Sprites): no saved-point vocabulary yet; stays manual.
  - dcm-40mj (Vitality, blade.ts): `runOnChoose` exists in feature-effects/run.ts, but convex/levelUp.ts doesn't call it
    at HEAD; switch in wave 10 once it does.
  - dcm-rao5 / dcm-lvgm: feature-effect files (S2), none in card-effects.

## Data switches ready for wave 10 (per file, with engine bead)

- arcana.ts: Rune Ward drop the holder-Hope manual step (dcm-q40t payers). Chain Lightning nothing (dcm-q13x in run.ts).
- bone.ts: Breaking Blow drop the manual step (dcm-yd5h).
- codex.ts: Mysterious Mist drop the manual step (dcm-9nlr); Banish drop the manual step (dcm-f70y / E7 bearer riders).
- dread.ts: Avatar of Terror drop the manual step (dcm-m48i).
- grace.ts: Invisibility drop the manual step (dcm-m48i); Encore drop the manual step (dcm-q40t damageType); Words of
  Discord drop both manual steps (dcm-f70y).
- valor.ts: Lead by Example to `attackedRider { by: "others", attackerSteps }` (dcm-yd5h / dcm-kso9, E1.3b).
- midnight.ts: Eclipse / Veil of Night `seeThrough` areas (dcm-o44e, after dcm-9nlr).
- blade.ts: Vitality onChoose (dcm-40mj, after levelUp.ts calls runOnChoose).

## QUESTIONS

1. Spectral Mist (HF p.181: "They become corporeal again after they pass through a solid object or make an action
   roll. Otherwise, this effect lasts until the end of the scene"): modelled as `duration: "scene"` + `endsOn:
   actionRoll`; the solid-object end is left to the table (its endsWhen text). Default kept unless you say otherwise.
2. Rune Ward ally use: until dcm-q40t the server can't refuse a holder with 0 Hope; the reminder says to undo. OK?
