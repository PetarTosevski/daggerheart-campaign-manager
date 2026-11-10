# TASK-FP3: feature helpers (R7) and the R3 Manual dice-box line

Status: Review. Plan `.omc/plans/finish-in-progress.yaml`, tracer FP3 (beads dcm-bxp.134.5, dcm-bxp.134.6).

## dcm-bxp.134.5: Help an Ally on the HUD feature panel

The pick-feature panel (`src/components/combat-map/hud/pick-feature/`) shows a Help an Ally control when the use has
an action roll (`hasActionRoll`: not a reaction roll, CB p.99; not an adversary attack). It follows the hand's roll
options (`RollOptionsBody`, `hud/hand/parts.tsx`):

| R7 mode | Control | Sent on `useFeature` |
|---|---|---|
| Book | "Helped by" chips from `helperCandidates` (other active PCs who can act), 1 Hope pill each; a PC without Hope, or past `HELP_MAX`, can't be ticked | `roll.helpers` (the server takes 1 Hope each in the use's group; NOT_ENOUGH_HOPE / DICE_RULE refuse before anything is written) |
| Manual | "Help dice" stepper, 0 to `HELP_MAX` | `roll.help` (no Hope taken; the GM gets the note) |

Code: `HelpData`, `NO_HELP`, `helpRoll`, `toggleHelper` (`model.ts`); `HelpRow` (`rows.tsx`); `index.tsx` reads
`ruleSettings.get` and, in Book, `charactersReads.listByCampaign` (as the hand does) and adds the help to `roll` on
both the panel and the square-pick paths. A rolling area use now opens the panel first, so helpers can be ticked.

## dcm-bxp.134.6: the R3 Manual consequence line

`consequence` (`src/lib/party/roll-copy.ts`) takes `hopeFearManual` (R3 Manual, from `ruleModes.hopeFearFromRolls`
in the dice box). Meaning from `dualityEffects` (src/lib/domain/dice/index.ts, user answer Q2 b, 2026-11-05) and
`convex/lib/rollAftermath.ts`: in Manual neither Hope nor Fear is gained by itself; the player adds the Hope on the
sheet, the GM gets "Mira rolled with Fear: gain 1 Fear?". A critical keeps its Hope and Stress clear (user 2026-11-06)
unless R2 is Manual.

| Outcome | Book | R3 Manual |
|---|---|---|
| With Hope | "Rolled with Hope: you gain a Hope." | "Rolled with Hope: add 1 Hope on your sheet." |
| With Fear | "Rolled with Fear: the GM gains a Fear." (or "already full") | "Rolled with Fear: the GM decides the Fear." |
| Critical | "Critical success: you gain a Hope and clear a Stress." | same (R2 Manual: "the GM decides your Hope and Stress.") |

Before this, Manual also said "the GM's Fear is already full" for every roll with Fear (`fearGained` is 0 there).

## Open questions

- The phone app (`apps/mobile/src/features/sheet/dice/dice-box.tsx`, outside FP3's owns) calls `consequence` without
  the R2 or R3 flags, so it still shows the Book lines in Manual campaigns.
- The Manual wording ("add 1 Hope on your sheet", "the GM decides the Fear") is mine, modelled on R2 Manual's line;
  the user may want other words.

## Tests

`tests/unit/pick-feature-helpers.test.tsx`, `tests/unit/roll-copy-r3-manual.test.ts`.
