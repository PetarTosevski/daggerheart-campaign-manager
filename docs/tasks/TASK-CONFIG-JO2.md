# TASK-CONFIG-JO2: Write the session log from the Combat Map (switch)

Plan `.omc/plans/config.yaml`, wave 4, tracer JO2; briefs `.omc/plans/config-briefs.md` ("User answers 2026-11-04");
bead dcm-jh6d.28. Mode: add. Server only (the switch itself is S2's Sessions section).

## The rule

`tableSettings.autoSessionLog` (resolved through `resolveTableSettings` in `src/lib/config/campaign-settings.ts`,
default on). Off: `journalLog.list` does not read the `feed`, `fear` and `encounter` sources, so the session log is the
session's own `sessionLog` lines: the start / end stamps, the 'Scene N began' stamps and the GM's typed lines. On (the
default): nothing changes.

- Nothing is deleted: the action log, Fear history, encounters and `sessionLogOverrides` rows stay. Turning the switch
  on again shows the same lines with their hides and re-wordings.
- The setting is read from the campaign the wrapper already loaded (no extra read); `campaignSettings.set` patches
  that document, so every open log re-runs.
- `hide` / `unhide` / `setText` are unchanged: they still accept those sources (only the GM reads the log with the
  switch on to use them).
- R1's Fear scrubbing for players is unchanged; with the switch off there are no Fear lines to scrub, and the
  automatic lines still go through `hideFearNumbers`.

## Tests

`tests/convex/journal-log-switch.test.ts` (default on, off for GM and player, nothing deleted and on-again identical,
R1 scrubbing intact); `tests/convex/journal-log.test.ts` unchanged and passing.
