# TASK-N7KB: F5 `fearFeatures` Manual on the Combat Map HUD stat block

Bead dcm-n7kb. Follows NB2 (`docs/tasks/TASK-NB2.md`), which did the same for the classic Encounter tab's adversary
panel. No server change.

## What changed

Under F5 `fearFeatures` Manual (CB p.154) the server asks and spends no Fear for an adversary feature's Fear cost and posts
the GM a "Spend N Fear by hand" note. The HUD stat block (`src/components/combat-map/hud/statblock/panel.tsx`) now reads
`modes.fearFeatures` from `ruleSettings.get`, the query it already reads for F4, D8 and C4, and:

| Mode | Feature row | Use button |
| --- | --- | --- |
| Book (or unset) | Fear `CostPill`, as before | aria-label "Use Coup de Grace (1 Fear)"; disabled with "This needs 1 Fear. You have 0." when the GM is short, as before |
| Manual | "Spend N Fear by hand" note (`.hsb-af-note`, text from `fearByHandText` in `src/lib/domain/adversary-actions/rule-notes.ts`) in place of the pill | aria-label "Use Coup de Grace" (no `fearCost` passed to `FeatureUse`); `adversaryActBlocked` gets 0 Fear, so Use is never blocked for lack of Fear (an action's own spotlight cost still blocks) |

`FeatureUse` (`feature-use.tsx`) is unchanged.

## Tests

`tests/unit/hud/statblock-panel.test.tsx`, "F5 fearFeatures on the stat block (dcm-n7kb)": Book shows the pill and the
"(1 Fear)" label and blocks Use at 0 Fear with the reason; Manual shows neither, shows "Spend 1 Fear by hand", keeps Use
enabled at 0 Fear, asks no FearConfirm and sends `useFeature` without `spendFear`. The file's `FeatureUse` stub now
carries the real aria-label, so the Book tests name Coup de Grace's Use "Use Coup de Grace (1 Fear)".
