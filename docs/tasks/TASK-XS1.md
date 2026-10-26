# TASK-XS1: Settings - Expansions switch as the default for new campaigns

Status: Review. Plan: `.omc/plans/env-actions.yaml`, tracer XS1.

## Rule (user, 2026-10-19)

- "add a button here that enables expansions (only h&f for now)" (the title-menu Settings dialog).
- It is the default for new campaigns; each campaign keeps its own Hope & Fear switch.
- Unset: every frame keeps its own default (Hope & Fear frames start on, the others off). Set: it decides Hope & Fear for new campaigns of any frame that offers the option (today every frame, including custom).

## What works

- `settings.expansions` (optional `{ hopeAndFear?: boolean }`, widened; no migration needed).
- `settings.get` returns `expansions` (`{}` when unset). `settings.update({ expansions: { hopeAndFear } })` takes a boolean, or `null` to clear it back to the frame defaults (the UI only sends booleans; the e2e uses `null` to restore the shared test GM).
- `campaigns.create` reads the caller's settings row (one indexed read) and, when `expansions.hopeAndFear` is set and the frame offers the option, stores it as the campaign's `options.hopeAndFear`. Later changes to the setting never touch existing campaigns; `campaigns.setOption` still switches each campaign.

## UI

- Settings dialog: an "Expansions" section between Display and Account with a "Hope & Fear" switch (`role="switch"`, the label row is the 44 px target) and the line "New campaigns start with Hope & Fear content. Change it per campaign on its dashboard." It saves on change like the other settings. Unset shows as off.

## Tests

- `tests/convex/settings.test.ts`: unset default and save alongside other fields; unset keeps frame defaults (Witherwild off, Castle High on); on and off override both; `null` clears; a campaign's own switch still works after creation.
- `tests/convex/campaigns.test.ts`: settings shape includes `expansions`.
- `tests/e2e/campaigns.spec.ts`: toggle on in Settings, create a Witherwild campaign, its Campaign Rules "Hope & Fear content" is checked and can be switched off; toggle off, a new campaign starts unchecked; the setting is cleared afterwards.
