# TASK-FP6: Dark-Hearted switches itself off after one roll

Plan `.omc/plans/finish-in-progress.yaml`, tracer FP6 (bead dcm-bxp.134). User answer 2026-11-10 (binding):
Dark-Hearted (Hope & Fear p.177, "Spend a Fear to give the adversary advantage on its next roll") is good for one
roll; the toggle switches itself off after the roll it was sent with. This replaces FP2's "the toggle stays on like the
advantage seg" (docs/tasks/TASK-FP2.md, open question "Dark-Hearted toggle persistence").

## When it resets

The toggle goes off once the server accepts a use that carried `darkHearted: true`: an Attack, or a feature use whose
`featureAsk.attack` is true. "Accepted" means the server answered `resolved` (with or without an open reaction window),
either at once or after the GM's "Spend N Fear". It stays on when:

- the server asks the Fear question (`confirmFear`: nothing rolled or paid yet), while the question is open;
- the GM cancels the Fear question (Cancel on the Encounter tab, No on the HUD's FearConfirm);
- the server refuses the use (an error);
- the use did not carry it (a feature with no attack roll, a reaction follow-up from the result).

The reset happens in the event handler path after the awaited mutation, never in an effect (rules 12-13).

## Where

| Panel | Change |
| --- | --- |
| Encounter tab (`src/components/adversaries/tracker/actions/panel.tsx`) | `accepted(intent, done)` after `acts.fire` and `acts.spend` (the spend reads the asked intent before it awaits): a non-null answer shows the dice and, when the intent sent `darkHearted: true`, sets `darkPicked` false. |
| Combat Map HUD stat block (`src/components/combat-map/hud/statblock/`) | No behaviour change: Dark-Hearted is a pick-session option without `defaultOn`; an accepted send returns `done` and ends the session, and each Attack / feature picker opens a new session with its options off. A No to the Fear question or a refusal returns `stay`, keeping the session and the switch. Documented on `darkHeartedOption` (`model.ts`) and pinned by tests. |

## Tests

- `tests/unit/adversary-tracker-actions-wf.test.tsx`, "Dark-Hearted switches itself off after one roll (FP6)": off
  after a resolved Attack, on while the Fear question is open and off after Spend, on after Cancel, on after a refusal,
  off after an attack-roll feature use, on after a feature with no attack roll.
- `tests/unit/hud/statblock-panel.test.tsx`, same describe: off when the Attack picker reopens after an accepted Attack,
  on after No to the Fear question then off after Yes, on after a refusal, off when an attack-roll feature's picker
  reopens after an accepted use.
