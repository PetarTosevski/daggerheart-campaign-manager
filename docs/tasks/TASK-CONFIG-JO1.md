# TASK-CONFIG-JO1: A new session opens on the Journal or the Combat Map

Plan `.omc/plans/config.yaml`, tracer JO1 (bead dcm-jh6d.27). Client only. The setting is `tableSettings.sessionOpensOn`
("journal", the default, or "combatMap"; S0). U5 draws its row in Campaign settings, Sessions.

## What changed

- `src/components/journal/header/index.tsx`: after `sessions.start` resolves with a `sessionId`, the click handler
  (`run`) reads `useCampaign().settings.sessionOpensOn`:
  - **Journal**: as before, `onOpenSession(sessionId, "log")` opens the session's Log & recap on the Journal page the
    GM is already on (`/campaigns/<id>/journal?s=<session>&sv=log`, the Sessions tab).
  - **Combat Map**: `router.push("/campaigns/<id>/combat-map")`.
  - `alreadyStarted` (no `sessionId`) moves no one.
- `sessionOpensOnHref(campaignId, opensOn)` returns the path to move to, or `null` to stay on the Journal.
- The navigation runs in the event handler after the mutation, never from an effect (rule 13).
- Only the GM sees Start, so only the GM's client moves. Players are not moved: the move is a local navigation, not a
  broadcast.

## Not changed

- `src/components/combat-map/hud/pick/session.tsx` is the HUD's target pick session (`PickProvider`), not a game-session
  picker. The Combat Map has no Start-session control today, so nothing there calls `sessions.start`.
- The dashboard hero's Start Session (`campaign-shell.tsx`, outside JO1's owns) still opens the Journal Log & recap.

## Tests

- `tests/unit/journal/header.test.tsx`: Journal stays on the page (no router push). Combat Map pushes
  `/campaigns/c1/combat-map`. `alreadyStarted` moves no one.
- `tests/e2e/session-opens-on.spec.ts`: both values from the Journal header. The player stays on the Journal in both
  runs.
