# TASK-JOURNAL-JD5: recap, hours at the table, after the session, campaign summary

Plan `.omc/plans/journal.yaml`, tracer JD5 (bead dcm-z9rz.8). Server only; no UI.

## Scope change from the plan (user Q4)

The user's Q4 answer is "everyone can write the recap; it is always visible to the table". So this tracer does not
build `shareRecap`, `recapSharedAt`, the recap gating or the `convex/migrations/journalRecap.ts` migration. J0 did not
add the field. `convex/migrations/run.ts` is unchanged. `sessionRecords.list` and `sessionWrap.dashboard` already give
every member the recap of live and played sessions, so their shapes are unchanged. The combat-hud
`hud/scene/index.tsx` reads `sessionWrap.dashboard`, and that shape stays the same too.

## What landed

**`sessionWrap.setRecap`**: changed from `gmMutation` to `campaignMutation({ need: "view", enough: "owner" })`.

- The GM writes any session's recap, as before.
- A non-GM caller must also be in the campaign: `campaignRole(...) === "player"`.
  - `campaignRole` is the role half of `permissionFor` in `convex/lib/permissions.ts`.
  - `notesRole` in `convex/lib/notes.ts` uses the same pattern to keep grant-only callers out of Notes.
  - A caller who reaches the campaign only through a grant gets `FORBIDDEN`. They can still read the recap.
- A player can write the recap of a live or played session.
- On a planned session, a player gets `SESSION_NOT_FOUND`, as if it did not exist. Players never see planned
  sessions in `sessionRecords.list`.
- Text rules are unchanged: the text is trimmed, at most 6000 characters (`INVALID` past it), and empty clears it.
- No rate limit. The GM's writes had none, and adding a limit name means editing the rate-limit config, which is
  outside this tracer's owns.

**`sessionWrap.after({ sessionId })`** (`gmQuery`; Q5: players don't see it) returns
`{ sessionId, levelUps: { characterId, summary, at }[], milestoneAt: number | null, loot: string | null, truncated }`
or `null` for a stale id.

- `levelUps` has one entry per character: its latest `levelUp` feed row that is not undone, inside the session's
  `liveWindows`. Entries are sorted oldest first.
- Each window reads at most `MAX_TALLY_ROWS` rows through `actionLog.by_campaign_at`.
- `truncated` means a window held more than `MAX_TALLY_ROWS` rows.

**`sessionRecords.summary()`** (`campaignQuery`, `need: "view"`; every member) returns
`{ sessionsPlayed, hoursAtTable, asOf, live, partyLevel }`.

- `sessionsPlayed`: sessions with status `played`.
- `hoursAtTable`: J0's `hoursAtTable`, unrounded. It counts the live session's running window up to `asOf`; while
  `live` is true the UI may add `Date.now() - asOf`.
- `partyLevel`: the highest sheet level among the active characters (`partyOf`, bounded). With no active character
  it falls back to `campaign.level`. `campaign.level` is only the starting level and never changes, so it can't be
  the main source.

## Tests

- `tests/convex/journal-recap.test.ts`:
  - The player writes and clears a recap, and the GM and the dashboard read it.
  - Refusals: planned session `SESSION_NOT_FOUND`, grant-only caller `FORBIDDEN`, outsider `NOT_FOUND`, too long
    `INVALID`.
  - `summary`: legacy hours, `playedMs`, the live window, and `partyLevel` ignoring a retired character.
  - `after`: rows in the windows, undone rows, rows outside the windows and other kinds; milestone, loot, a planned
    session, a stale id and refusals.
- `tests/convex/authz/journal-recap.entries.ts` and `.test.ts` (area `journal-recap`):
  - `setRecap`: view on a live session, every member ok.
  - `after`: GM only, grantee `FORBIDDEN`.
  - `summary`: view.
- `tests/convex/session-wrap.test.ts`: `setRecap` left the GM-only loop and has its own Q4 test.
- `tests/convex/authz/sessions.test.ts`: players write a live recap; a planned recap gives `SESSION_NOT_FOUND`.

## Out-of-owns edit (approved by the orchestrator)

`tests/convex/authz/sessions.entries.ts`: removed the `sessionWrap.setRecap` GM entry. The function's access class
changed to `view`, and the inventory guard wants each function listed once, so it is now in `journal-recap.entries.ts`.

## Questions (defaults taken)

1. Player recap writes: `need: "view"` plus membership (`campaignRole`). Grant-only callers can't write. Invitees
   whose invite is still pending count as players under `campaignRole`, as they do everywhere else.
2. A player writing a planned session's recap gets `SESSION_NOT_FOUND`, not `FORBIDDEN`, so planned sessions stay
   hidden.
3. Level-ups count only inside the live windows, as the acceptance says. A level-up taken after End, such as after
   the milestone, doesn't show. Alternative: count up to the next session's start.
4. `sessionsPlayed` leaves out the live session.
5. `partyLevel` is the highest active character level. The alternative is the most common level.
6. `summary` reads character sheets, so it re-runs on every sheet write. The read is bounded, but if that turns out
   too chatty during play, store a party level instead.

## Merge-time actions

- Add `tests/convex/authz/sessions.entries.ts` to JD5's owns (the orchestrator said it would).
- No codegen needed for new modules: the new functions are in existing modules. Regenerate as usual anyway.
- JR / JS: there is no share gate; `after` and `summary` are the APIs above.
