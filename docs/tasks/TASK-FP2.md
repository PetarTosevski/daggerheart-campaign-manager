# TASK-FP2: the classic Encounter tab's adversary panels catch up with rule switches WF

Status: Review. Plan `.omc/plans/finish-in-progress.yaml`, tracer FP2 (bead dcm-bxp.134.2). Inputs: commit 3ecabe73,
`docs/tasks/TASK-RULES-WF.md` (W3 Tier 3, F4, path features' destination pick). No server change: everything below sends
arguments `adversaryActions.attack` / `useFeature` already accept.

## What the panel (`src/components/adversaries/tracker/actions/panel.tsx`) now does

| Piece | Behaviour |
|---|---|
| W3 Tier 3 Dark-Hearted (HF p.177) | When `adversaryActions.darkHearted` is true, a toggle "Dark-Hearted: advantage (1 Fear)" sits beside the advantage seg (the HUD's `darkHeartedOption` label and note). On: the Attack sends `darkHearted: true`, and so does a feature use whose `featureAsk.attack` is true (the HUD offers it only on the attack and attack-roll features). The Fear question lists "1 for Dark-Hearted" (`confirmFear.darkHearted`, `fearPrompt`). The toggle stays on like the advantage seg; the server asks the Fear on every use. |
| F4 `adversaryExperienceFear` Manual (CB p.154) | Experience options read "Ambusher +3 (spend 1 Fear by hand)" and are never disabled for Fear (`experienceText`); Book keeps "(1 Fear)", off without Fear. The server asks no Fear and posts its GM note. |
| Path destination (`featureAsk.pathMove`) | The tab already embeds the live Combat Map (`map-pane.tsx`: the classic `MapBoard`, which carries the classic square pick `map-view/area-pick`). Use on a path feature, with the adversary's token on the live map, starts that pick ("Pick Ogre's destination for Trample within Close: click a square on the map." in the map pane's banner, and a note in the panel). A square beyond the move's range (the HUD picker's `outside`, off with Defined Ranges off) restarts the pick with "That square is out of range.". Then, as the HUD's `startPath`: who the straight line crosses (`crossedBy`; PCs, plus other standing adversaries for side `any`; unconscious PCs left out in C4 Book) starts picked. Side `enemy` (Trample): they become the panel's target chips and a confirm row "Ogre moves to (x, y)... Use Trample on ..." / Cancel sends `useFeature` with `useId`, `targets`, `destination`. Side `any` or a feature that needs choices (Rampaging Fury): the choices dialog opens with them pre-picked and Use adds `destination`. Without a live map or a token, Use sends at once as before (no destination). |

Why the classic map pick rather than the HUD's `pickArea`: the HUD square picker is drawn by the HUD shell's layer
(`HudAreaPickLayer`), which the Encounter tab does not mount; the tab's map pane is the classic `MapBoard`, which already
renders the classic picker's banner and click layer. The range check, the crossing rule and the wording are the HUD's
(`outside`, `crossedBy`, `withinText`, `darkHeartedOption`), imported, not restated.

## Code

- `src/components/adversaries/tracker/actions/panel.tsx`: the three controls.
- `src/components/adversaries/tracker/actions/path.ts` (new, pure): `pathCrossed`, `pathOutside`.
- `src/components/adversaries/tracker/actions/model.ts`: `FearConfirm.darkHearted`, `fearPrompt`, `experienceText`.
- `src/components/adversaries/tracker/actions/use-adversary-actions.ts`: keeps `confirmFear.darkHearted`.
- `tests/unit/adversary-tracker-actions-wf.test.tsx`: the controls and the args they send.

## Open questions

- Dark-Hearted toggle persistence: it stays on across uses (like the advantage seg). Should it switch itself off after
  one roll ("advantage on its next roll")? Left as the plainest version.
- F5 `fearFeatures` Manual on this panel: the feature's "Fear N" badge and the Use button's "(N Fear)" label are
  unchanged (the server asks no Fear and posts the note). Not in FP2's scope; the HUD's wording could be copied later.
