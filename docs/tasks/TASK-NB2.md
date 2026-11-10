# TASK-NB2: F5 `fearFeatures` Manual on the classic Encounter tab's adversary panel

Plan `.omc/plans/next-batch-1110.yaml`, tracer NB2 (bead dcm-bxp.134.7). Follows FP2's open question
(`docs/tasks/TASK-FP2.md`, "F5 `fearFeatures` Manual on this panel"). No server change.

## What changed

Under F5 `fearFeatures` Manual (CB p.154) the server asks and spends no Fear for an adversary feature's Fear cost and posts
the GM a "Spend N Fear by hand" note. The panel (`src/components/adversaries/tracker/actions/panel.tsx`) now reads the
same mode as the rest of the panel (`ruleSettings.get` `modes.fearFeatures`) and:

| Mode | Feature row | Use button |
| --- | --- | --- |
| Book (or unset) | "Fear N" badge, as before | aria-label "Use Earthquake (2 Fear)", as before |
| Manual | "Spend N Fear by hand" note in place of the badge (`fearByHandText`, `src/lib/domain/adversary-actions/rule-notes.ts`: the server note's wording, imported) | aria-label "Use Earthquake" (no `fearCost` passed to `FeatureUse`) |

Disabling: the panel never disables a feature for Fear itself; Use is off only while busy or when the server's
`featureAsk.available` is false, and the server leaves Fear out of that (in Manual its `fear.total` is 0, so no
"Spend N Fear?" question either). The test pins Use enabled at 0 Fear in Manual and `useFeature` sent without `spendFear`.

`FeatureUse` (`feature-use.tsx`) is unchanged; the HUD stat block mounts it too and keeps passing its own `fearCost`.

## Note on the HUD stat block

The brief said the Combat Map HUD stat block already handles F5 Manual. It handles F4 (an Experience: "Spend 1 Fear by
hand"), not F5: `src/components/combat-map/hud/statblock/panel.tsx` still shows the feature's `CostPill`, passes
`fearCost` to `FeatureUse` and disables Use through `adversaryActBlocked(who, f.fearCost, ...)` when the GM holds less
Fear. Outside NB2's owns; follow-up bead dcm-n7kb.

## Tests

`tests/unit/adversary-tracker-actions-wf.test.tsx`, "F5 fearFeatures (NB2)": Book shows the badge and the "(2 Fear)"
label; Manual shows neither, shows "Spend 2 Fear by hand", keeps Use enabled at 0 Fear and sends `useFeature` without
`spendFear`; Manual before `featureAsk` loads keeps the plain label.
