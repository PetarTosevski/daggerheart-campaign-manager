# TASK-RULES-WR: wave 3 roll costs (R2, R6, R7, R8, R10)

Status: Review. Rule switches wave 3, tracer WR (epic dcm-jh6d part A, bead dcm-bxp.134). Inputs:
`.omc/plans/rule-switches-wave3-questions.md` ("User answers (2026-11-09)", binding: Q1–Q5 all (a)) and
`docs/tasks/TASK-RULES-W3S0.md` (the mode literals and the "Readers" list for WR). Same meanings as waves 1-2: Book = the
app does what the book says; Manual = the app stops doing it and posts a GM-only note (`postRuleNote`) in the action's
group, so undoing the action undoes the note.

The five ids are now in `WIRED_RULES` (`src/components/config/sections/rules/model.ts`): House rules shows their pickers.

## What each mode does

| Rule | Book | Variant | Manual |
|---|---|---|---|
| R2 `criticalSuccess` (CB p.90) | A critical is a success with Hope that gives **+1 Hope and clears 1 Stress in total** (never a second Hope for "with Hope"; pinned in `tests/unit/dice.test.ts`) | — | The critical still succeeds and counts as with Hope (S1, countdowns, R10, triggers read it), but no Hope and no Stress clear. GM: "Mira rolled a critical: gain 1 Hope and clear 1 Stress?" (Tag Team: "Mira and Theo rolled a critical: each gain …") |
| R6 `experienceCost` (CB p.90) | 1 Hope per Experience; NOT_ENOUGH_HOPE without it | — | The modifier is added, no Hope taken, never refused at 0 Hope. GM: "Mira used Stealthy (+2): spend 1 Hope?" |
| R7 `helpAnAlly` (CB p.90, p.99) | The roller ticks the helping PCs (dice box, attack panel; `helpers`, character ids). Each helper must be another active PC of the campaign, not unconscious, with 1 Hope; the roll is refused otherwise (DICE_RULE; NOT_ENOUGH_HOPE naming the helper). Each pays 1 Hope and adds a d6 (highest advantage die rule unchanged). One public row per helper, "Theo helped Mira (−1 Hope)", with the sheet before, in the roll's group: undo refunds it. The bare `help` counter is refused (DICE_RULE). No help on a reaction roll (DICE_RULE) | — | Today's counter (`help`); no Hope taken. GM: "2 PCs helped Mira: each spends 1 Hope?" ("1 PC helped Mira: spend 1 Hope?") |
| R8 `tagTeam` (CB p.97) | 3 Hope, once per session (`featureUses` `tagTeam`) | `noSessionLimit` (*not in the books*): 3 Hope each time, no limit | No Hope, no limit. GM: "Mira started a Tag Team: spend 3 Hope?" / "… (again this session) …". Both rolls, the pick and the shared result work in every mode |
| R10 `criticalDamage` (CB p.98, p.148) | A critical adds the damage dice's maximum (PCs and adversaries) | — | A critical is rolled like a normal hit. GM: "Mira: critical, add 16 (the dice's maximum)?" (adversary: its label) |

Every mode marks the `tagTeam` feature use on the first start of a session (so the limit and R8's "again" can tell).

## Where it is read

- **Domain** (`src/lib/domain/dice/index.ts`): `dualityEffects(kind, outcome, hopeFear, critical)` (R2), `experienceBonus(exps,
  ids, mode)` (R6: Manual cost 0), `rollDamage(input, rng, mode)` (R10) with `criticalExtra(input)` (what a critical adds),
  and the GM lines `experienceNote`, `criticalDamageNote`. Types `CriticalMode`, `ExperienceCostMode`, `CriticalDamageMode`.
  Every new parameter defaults to Book.
- **Dice box, typed-in dice** (`convex/lib/rolls.ts`): `resolveDuality` reads R2 and R6 next to R3 and returns `critical`,
  `experienceCost`, `experienceManual` (the R6 note), so `combatActions.ts` / `combatMovement.ts` need no new reads.
  `duality` runs `planHelp` (R7) before anything is written, gives the roll a group when a note or a helper row joins it,
  posts R6 and pays the helpers (`payHelpers`). `resolveDamage` reads R10 and returns `criticalWithheld`; `damage` posts the
  note in a new group.
- **R7** (`convex/lib/helpAnAlly.ts`, new): `planHelp` (reads, checks), `payHelpers` (Book: Hope and rows, reading each
  helper again so an earlier write in the mutation is kept; Manual: the note), `helpersField` (args validator),
  `MAX_HELPERS` 6. `rolls.slayerRoll` now counts only `roll` rows of a grouped plain roll (helper rows don't hide the
  Slayer choice). The aftermath's `rollersOf` already ignores a group with non-roll rows.
- **R2 note** (`convex/lib/rollAftermath.ts`): `PcActionRoll.critical` (and `pcs` for a Tag Team); `planPcActionRoll`
  adds the `criticalSuccess` note in R2 Manual. Every action-roll path passes it: `rolls.duality`, `rolls.tagTeamApply`,
  `combatActions` attacks, `combatMovement` (Cloaked roll), `combatCards`, `featureRunner`. `criticalModeOf(campaign)`.
- **Tag Team** (`convex/rolls.ts`): `tagTeam` reads R8; `tagTeamApply` passes R2 to `dualityEffects` and the aftermath.
- **Attacks** (`convex/lib/combatActions.ts`): `attackRollFields.helpers`, `AttackRoll.helpers`, `rollFromStored`; the
  stored sanction / held-attack roll `sanctionRollOptionsValidator.helpers` is **widened** (optional, rule 7) so an
  out-of-range or held attack replays its helpers. `resolveAttack` plans help before the roll and pays after the rows
  (helpers' Hope is taken only when the attack resolves); R6 and R10 notes join `ruleNotes`.
- **Card and feature uses** (`convex/lib/cardRunner.ts`, `src/lib/domain/card-effects/run.ts`): the run context's
  `criticalSuccess` and `criticalDamage`; R6 through `experienceBonus(…, modes.experienceCost)` and a `ruleNotes` entry;
  the plan's `criticalDamageWithheld` becomes the R10 note in `ruleNotesOfUse`. `UseRuleNote` gains `experienceCost` and
  `criticalDamage`.
- **Adversaries** (R10, critical path only): `AdversaryRunContext.criticalDamage` passed to the card runner, the plan's
  `criticalDamageWithheld` copied to `AdversaryPlan` (`src/lib/domain/adversary-effects/run.ts`); `rangesFlag` in
  `convex/lib/adversaryActions.ts` now also spreads `criticalDamage: "manual"`, and the main use posts the note.
  The GM-controlled PC attack passes R10 to `adversaryDamage(text, critical, rng, mode)` and notes it. Not This Time's
  damage reroll (`standardDamageOf`, `convex/lib/adversaryHits.ts`) keeps the critical only in Book.

## UI

- Dice box (`src/components/party/dice/dice-box.tsx`): R7 Book shows "Helped by (1 Hope each, +d6)" chips (the
  campaign's other active, conscious PCs, with their Hope; `helperCandidates`) instead of the "Help dice" counter and sends
  `helpers`; Manual keeps the counter. R6 Manual: the Experience legend drops "(1 Hope each)" and Hope no longer blocks
  the roll. R2 Manual: the result's line says "Critical success: the GM decides your Hope and Stress."
- Tag Team (`tag-team.tsx`): the header and the button follow R8 (no Hope in Manual, no "once per session" in the
  variant; a second start is not blocked outside Book).
- Attack panel (`src/components/combat-map/hud/pick-attack/*`): R7 Book shows "Helped by" chips (with a Hope pill,
  disabled for a PC at 0 Hope) instead of the counter; `attackArgs` sends `helpers` and `help: 0`. R6 Manual
  (`experienceFree`): no Hope pill on Experiences, no Hope in the pay line or the blocker. Until `ruleSettings.get`
  loads, the panel shows the counter (the Book server refuses a counter above 0).
- No optimistic update: the roll and the attack already wait on the server's dice; the helper rows land with them.

## Tests

- `tests/unit/dice.test.ts`: R2 Book pins +1 Hope / −1 Stress in total; R3 Manual keeps the critical's gains; R2 Manual
  zeroes only the critical; R6 Manual cost 0 and its line; R10 `criticalExtra`, Manual's total and its line.
- `tests/convex/rules-roll-costs.test.ts`: R2 Book / Manual (note, undo) and on a Tag Team; R6 Manual at 0 Hope and Book's
  refusal; R7 Book (Hope, help die, row, undo refund), its refusals (counter, no Hope, self, repeated, reaction, dead), R7
  Manual's note; R8 variant (two Tag Teams, 3 Hope each), Book's refusal, Manual's two notes; R10 Manual (total, note,
  undo); attacks: R7 Book helper paid in the attack's group and refunded on undo, counter refused; R7 and R10 Manual notes
  on a critical attack.
- `tests/unit/hud/attack-pick.test.tsx`: `helperCandidates`, `attackArgs` with and without helpers, R6 Manual's pay line
  and blocker.
- `tests/unit/config/rule-switches.test.tsx`: the "Coming soon" test now uses D7 / X3 / M4; R8 and R2 show their radios.
- No new public function (authz matrix unchanged); new args are optional.

## Open questions

1. **R7 on card and feature uses.** The HUD hand's "Help dice" counter (`roll.help` on `combatCards.useCard` /
   `combatFeatures.useFeature`) still adds dice without taking Hope in Book. Should card rolls get the helper picker too
   (and refuse the counter in Book), or stay a counter?
2. **R3 Manual's dice-box line** still says "you gain a Hope" (wave 1); R2 Manual's line is fixed here.
