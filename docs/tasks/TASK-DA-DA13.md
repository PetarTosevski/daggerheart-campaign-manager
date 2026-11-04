# TASK DA13: Cannonball - the throwing ally gets a prompt and rolls from their own drawer

Plan `.omc/plans/drawer-answers.yaml`, tracer DA13 (beads dcm-bxp.99.19.21 and dcm-bxp.99.19.5). Builds on DA0
(`CardUse.rolledBy`, the `allyRoll` prompt), DA6 (the drawer's Play-for switch), DA9 (Beastform holdings) and DA12 (the
`combatRequests` prompts and `featurePrompts`). Book pages are printed pages (CB = Core Book).

Status: Review.

## Rule and answers

- CB p.33, Armored Sentry, Cannonball: "Mark a Stress to allow an ally to throw or launch you at an adversary. To do so,
  the ally makes an attack roll using Agility or Strength (their choice) against a target within Close range. On a
  success, the adversary takes d12+2 physical damage using the thrower's Proficiency. You can spend a Hope to target an
  additional adversary within Very Close range of the first. The second target takes half the damage dealt to the first
  target."
- User 2026-10-29 (dcm-bxp.99.19.21): the thrown ally gets a prompt and rolls from their own drawer.
- User 2026-10-30 (the answer to DA0's QUESTIONS 1, "whose Proficiency"): build it as the book says. The druid marks the
  Stress and is thrown. The THROWING ally gets the prompt in their drawer and rolls Agility or Strength (their choice)
  against a target within Close range. On a success: d12+2 physical damage with the throwing ally's Proficiency. The
  roll's Hope / Fear and a critical belong to the ally.
- CB p.107: "if you need to round to a whole number, round up unless otherwise specified" (the second target's half).
- CB p.103: Very Close 3 squares, Close 6.

## What was built

| Piece | Where | What |
|---|---|---|
| Entry | `src/lib/srd/feature-effects/beastforms.ts` | Cannonball: 1 Stress, target one ally (not self, any range); `roll` Agility or Strength against the target's Difficulty (an attack); `rolledBy: { who: "ally", proficiency: "roller", targets: one enemy within Close }`; steps: d12+2 physical × Proficiency on a hit, and the optional `second` (1 Hope): the same damage, halved, to one `picked` enemy within Very Close range of the first target. The manual lines are gone. |
| The druid's use | `combatFeatures.useFeature` (unchanged) → `resolveFeatureUse` (convex/lib/featureRunner.ts) | DA0's runner pays the Stress and returns the `allyRoll` prompt. `resolveFeatureUse` refuses a use without an ally on the map (COMBAT_TARGET_INVALID, nothing written), adds the note "Bryn makes the roll" to the public row and opens an `allyRoll` request (`openAllyRoll`, convex/lib/featurePrompts.ts). The druid's older open throw is declined first. |
| Request | `convex/lib/validators/combatRequests.ts` (widen only) | Kind `allyRoll`; payload `allyRollPayloadValidator` (schemaVersion 1): the druid's character, feature and use, the roller's character and token, the use's `groupId` and public `entryId`, `expiresAt` (`ALLY_ROLL_TTL_MS`, 30 minutes). No schema.ts change. |
| The ally's roll | `featurePrompts.allyRoll` (keyed campaign mutation, `view`, then edit on the ROLLER) | Args: `requestId`, `trait` (agility / strength), `targetTokenId`, optional `secondTokenId`, optional `roll` (Experiences, advantage). The use runs as the ally's own (`rollerUse`): the druid's costs, limit and requirements are left out, its targets are `rolledBy.targets`, and range and sight are measured from the ally's token. The ally's traits, Proficiency, Experiences, Hope and critical apply; the GM's Fear comes from a roll with Fear. `secondTokenId` takes the optional step and spends 1 of the DRUID's Hope (FEATURE_COST_UNPAID without it). A target out of range, a second that is the first or out of Very Close range, or a non-enemy: COMBAT_TARGET_INVALID, nothing written. The write is `resolveFeatureUse` with `ResolveExtras`: the public row reads "Bryn throws Moss (Cannonball): …", the druid's Hope change is a row of its own in the same group (with `before`), and the GM row holds `adversaryBefore`. The half damage reuses the first target's roll, which is listed once (`oneDamageRoll`). If the druid's use was undone or the request expired, it is closed and `{ status: "closed" }` is returned. |
| Read | `featurePrompts.allyRolls` (campaign query, `view`, then edit on the character) | `asks`: the rolls this character is asked to make, with the druid's name and Hope, the second step's label and the enemies the ally sees (name, `inRange` for the throw, `near` = the enemies within Very Close range of each). `waiting`: this character's own throws. `allies`: the PC tokens on `mapId` (for the druid's ask). `pending`: GM only, every open throw. Names only, no adversary numbers (U1). |
| Cancel | `featurePrompts.cancelAllyRoll` (keyed GM mutation) | Declines an open throw. The druid's Stress stays paid; undoing the druid's use gives it back. |
| Drawer | `src/components/combat-map/drawer/prompts/**`, mounted by `drawer/index.tsx` in its own `DrawerBoundary` | The druid (a held Cannonball): "Ally who throws you" select and "Ask to throw · 1 Stress" (`useFeature`), then "Cannonball: waiting for Bryn to make the roll." The ally: Agility / Strength radios, "Target within Close range" (out-of-range targets listed but disabled), the second target box ("spend 1 of Moss's Hope (n); it takes half damage") and its select, "Roll the throw"; the result line ("Moss thrown. Rolled 16; damage 9 → Bandit: Hit"). The GM: "Waiting ally rolls" with Cancel. Everything is greyed until the GM's Play-for switch is on. Optimistic updates drop an answered or cancelled prompt at once. |

Undo:
- Undoing the ally's roll (its group) restores the ally's sheet (Hope, Stress), the druid's Hope and the adversaries.
- Undoing the druid's use restores the Stress. The open prompt is closed: `allyRollLive` reads the use's public row, so
  the prompt leaves every view and a late roll is closed without a write.
- Undoing the ally's roll does not reopen the prompt.

Cleanup (rule 8): resolved and declined rows are swept by the existing `expireCombatRequests` cron. An open row that is
never answered is no longer offered after 30 minutes. It is declined by the druid's next throw or by a late answer, and
the campaign purge removes it.

## Public functions (authz: tests/convex/authz/prompts.entries.ts)

- New: `featurePrompts.allyRolls` (view + edit on the character: another player FORBIDDEN), `featurePrompts.allyRoll`
  (view + edit on the roller: the druid's player FORBIDDEN, the GM allowed), `featurePrompts.cancelAllyRoll` (gm).
- Changed behaviour: `combatFeatures.useFeature` (Cannonball opens the prompt; it needs the ally on the live map).

## Tests

- `tests/convex/cannonball.test.ts` (9): the druid's use marks the Stress and opens the prompt, which Bryn's, Ash's
  and the GM's views show (names only); a hit with Hope deals 1d12+2 with Bryn's Proficiency 1 (7 + 2 = 9, Major, 2 HP),
  and the Hope is Bryn's; Agility and a miss with Fear (no damage, GM +1 Fear); a critical (12 + 5 + 2 = 19, Severe, 3 HP;
  Bryn +1 Hope, -1 Stress); the second target at ceil(9 / 2) = 5 with Ash's Hope, and undo restores all; refusals
  (out of Close, a far second, the same target twice, the druid's player FORBIDDEN, no Hope FEATURE_COST_UNPAID, nothing
  written); the GM rolls for Bryn and cancels a throw; undoing the druid's use withdraws the prompt; a second throw
  replaces the first.
- `tests/unit/drawer-prompts.test.tsx` (11): model (`allyRolledUse`, `throwFeatures`, `secondCandidates`,
  `resultLine`), the ally's prompt (intent args, disabled out-of-range option, second-target gating, alert, greyed
  without Play-for), the druid's ask (intent, waiting, a used Cannonball), the GM's Cancel and its optimistic update.
- `tests/convex/authz/prompts.entries.ts`: rows for the three new functions.
- `tests/e2e/combat-cannonball.spec.ts`: the GM (desktop) plays for Moss in Armored Sentry and asks Bryn. The player at
  390 px rolls Strength at the Bandit from Bryn's drawer and sees "Bandit: Hit". The Bandit takes 2 HP. Axe runs on both
  pages, and the 390 px prompt meets the touch-target size.
- `tests/unit/feature-effects/beastforms.test.ts` (outside owns, see below): the Cannonball pin now checks the druid's
  half (Stress, the `allyRoll` prompt).

## Ownership

One file outside DA13's `owns` changed: `tests/unit/feature-effects/beastforms.test.ts`. Its Cannonball test pinned the
old manual entry (two prompts, the Hope paid by the druid's use), so it fails once the entry is built. It now pins
the `rolledBy` half. The orchestrator should accept it at the merge.

## QUESTIONS

1. **Whose Hope for the second target, and who decides?** CB p.33: "You can spend a Hope to target an additional
   adversary within Very Close range of the first." "You" is the druid. The plan's acceptance puts the choice in the
   ally's drawer ("the ally's drawer shows it with Agility / Strength, the target pick and the optional Hope second
   target"). Built: the ally ticks it in their prompt, and the druid's Hope is spent (refused without it). The
   alternative is that the druid opts in when asking (the Hope paid then, the ally picks the second target).
2. **Does the second target need its own hit?** CB p.33: "The second target takes half the damage dealt to the first
   target." Built: it takes half (rounded up, CB p.107) whenever the first target is hit, with no roll against its own
   Difficulty. If the first is missed, it takes nothing.
3. **Whose Close range?** "the ally makes an attack roll … against a target within Close range". Built: Close range of
   the throwing ally's token (the attacker, as every attack). The second is measured from the first target.
4. **Does the druid's token move?** "throw or launch you at an adversary". Built: no automatic move; the table moves
   Moss's token.
5. **An out-of-range target.** Other uses wait for the GM's approval (combat-actions Q1). Built: the throw refuses it,
   and the prompt lists it disabled.
6. **Who can withdraw a throw?** Built: the GM cancels (the Stress stays paid). Undoing the druid's use withdraws it and
   gives the Stress back. The ally has no Decline. An unanswered throw stops being offered after 30 minutes. Should the
   ally decline, or should a cancel refund the Stress?
7. **The druid leaves the form before the throw.** Built: the throw still runs (the use was made in the form).

## Follow-ups

- docs/data-model.md (orchestrator): the `allyRoll` request kind and its payload.
- DA0's QUESTIONS 1 (whose Proficiency) is answered: `proficiency: "roller"`.
