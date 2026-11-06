# TASK-RULES-RF: frame rest hooks follow the rule switches (W2, W4–W7)

Plan `.omc/plans/rule-switches.yaml`, tracer RF (epic dcm-jh6d part A). API: `docs/tasks/TASK-RULES-RS0.md`
(`ruleMode`, `postRuleNote`). Every rule here is Book · Manual and exists only in its frame. Manual = the app applies
nothing and posts a GM-only feed note (kind `rule`, user 2026-11-05); no prompt.

| Rule | Book (unchanged) | Manual | Where |
|---|---|---|---|
| W2 `horizonSanctuaryRest` (HF p.176) | A long rest outside a sanctuary is refused (REST_RULE) on start and on finish | It goes through; the rest's public feed row says "Warning: Long rest outside a sanctuary …" and the GM gets the note "Long rest outside a sanctuary" | `assertSanctuaryLongRest` / `partyOutsideSanctuary` (`convex/trackers/horizon.ts`), `horizonSanctuaryRestHook` (`convex/lib/restHooks.ts`) |
| W4 `beastFeastFeast` (CB p.278) | Clear Stress, Tend to Wounds and Prepare are neither offered nor accepted | Every core move is offered and accepted next to Make a Feast (no note: nothing is skipped) | `feastForbiddenMoves` (`src/lib/domain/frames/beast-feast.ts`), `restMovesFor` (`convex/lib/restMoves.ts`) |
| W5 `colossusSiphoning` (CB p.327) | A hunt-phase rest marks the Siphoning Track once (short) or twice (long) | No mark; note "Hunt phase rest: mark Siphoning once / twice" (interlude: nothing) | `restSiphonMarks`, `markRest(…, mode)`, `siphonRestNote` (`src/lib/frames/trackers/colossus.ts`), `colossusRestHook` |
| W6 `umbraLurkingDarkness` (CB p.289) | A rest away from a Sacred Pyre rolls the d12 (Keep Watch dice join), applies Fear / Hope | No roll, Fear or Hope; note "Rest away from a Sacred Pyre: roll on Lurking Darkness (Keep Watch: Ash)" (at a pyre: nothing) | `restRollsLurking`, `lurkingRestNote` (`src/lib/frames/trackers/age-of-umbra.ts`), `ageOfUmbraRestHook` |
| W7 `andaluriaLycanthropy` (HF p.153) | Each rest ticks a bitten PC's active countdown unless they took the halt move | Nothing ticks; one note per bitten PC who did not halt: "Rest: tick Lycanthropy for Ash unless they halted it" | `restTicksLycanthropy`, `lycanthropyRestNote` (`src/lib/frames/trackers/andaluria.ts`), `andaluriaRestHook` |

The pure helpers take the mode as a last parameter defaulting to `"book"`, so the GM's own tracker buttons (Mark rest,
Roll Lurking Darkness) and every unwired caller keep the book behaviour. W7 still needs `transformations` on.

## Notes and undo

`RestHookInput.groupId?` (new, optional): when `rests.ts` makes the rest's actionLog group before `runRestHooks`, the
notes join it (undone with the rest) and the W7 note names its character. Until then (`rests.ts` is tracer RR's) the
notes are campaign-wide, not undoable, and a rest undone and finished again posts them again.

## Tests

`tests/convex/rules-frame-rests.test.ts`: the pure helpers' defaults, then per rule Book (no note) and Manual (nothing
applied, the note's text, GM-only for W2), the no-note cases (sanctuary, interlude, pyre, unbitten), and the
cross-frame refusal (SETTING_INVALID). The Book suites stay in `tests/convex/rest-frame-hooks.test.ts`.
