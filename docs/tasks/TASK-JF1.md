# TASK-JF1: Journal follow-ups (beads dcm-z9rz.24 - .31)

Plan `.omc/plans/journal-followups.yaml`, tracer JF1. User answers 2026-11-05 (`.omc/plans/overnight-questions.md`,
"Journal defaults").

| Bead | Result | Where | Test |
|---|---|---|---|
| .25 players see the tally | `journalTally.tally` is a view query (`enough: "owner"`): players get live and played sessions (planned: SESSION_NOT_FOUND) and no Fear counts while "Players see the GM's Fear" is off (`fearHidden`, the Fear tiles are left out). Spotlight bars unchanged: players only with "Show spotlight balance to players" (config JO3). | `convex/journalTally.ts`, `tally/`, journal page, `slots.ts` | `journal-spotlight-players.test.ts`, `tally.test.tsx`, authz entry |
| .26 defeats during the session | `defeatsInWindows`: per window, every instance of an encounter that ran in it counts defeated-at-end minus defeated-at-start. Start: 0 for a fight started in the window, else the first `adversaryBefore` snapshot in the window. End: now (open window) or the first snapshot after it (at most 200 rows read after a played session). | `src/lib/domain/journal/tally.ts`, `convex/journalTally.ts` | `tally-domain.test.ts`, `journal-tally.test.ts` |
| .27 scar Hope is not spent | `hopePaid`: the net drop minus the Hope a closed slot took (Hope above the slots left). | `src/lib/domain/journal/tally.ts`, `saveSheet` (`convex/lib/characterSheet.ts`, outside owns: one call) | `tally-domain.test.ts`, `journal-tally-counters.test.ts` |
| .28 roll icons | `feedIcon`: reaction roll, damage roll, attack roll (a `combat` row's action roll); others keep their kind. Manual rule notes (`rule`, GM visibility) reach only the GM and keep their pen icon. Social rolls: open question (the roll stores no trait or social mark). | `convex/journalLog.ts`, `log/model.ts` | `journal-log.test.ts` |
| .29 milestone | 'Milestone' line in After the session: 'Reached 2 Nov' + 'Open Party to level up', or 'Not yet' + 'Call milestone' (confirm step, `sessionWrap.callMilestone`, optimistic). | `recap/` | `recap.test.tsx` |
| .30 scene type first | '+ Add scene' opens Exploration / Social / Combat / Downtime / Cancel (Escape closes); picking adds the scene with that type. | `plan/scenes.tsx`, `plan.css` | `plan-scenes.test.tsx` |
| .31 dates | `shortSessionDate` 'Sun 2 Nov', `fullSessionDate` 'Sun 2 Nov 2025' (tooltips), `dayMonth` '2 Nov', `startTime` 'HH:MM': fixed English day-month, no locale. | `session-list/format.ts`, heading, list | `session-list.test.tsx` |
| .24 functions without UI | `sessionWrap.callMilestone` has a UI again (.29). Still without UI: `sessionPlay.spotlight`, `bumpSpotlight`, `tally`, `log`; `sessionPrep.createEncounter`, `linkEncounter`, `unlinkEncounter`; `sessionWrap.setThreads`. Not removed: their files and tests are outside JF1's owns (see the report). | - | - |
