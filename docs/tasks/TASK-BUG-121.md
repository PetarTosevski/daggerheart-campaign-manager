# TASK-BUG-121: Closing a door no longer freezes the player's map page (dcm-bxp.121)

Status: Review. Plan: `.omc/plans/d12-bugs.yaml`, tracer B2. Bead: `dcm-bxp.121`.

## The symptom
`tests/e2e/combat-movement.spec.ts:48` sometimes timed out at 300 s, at 1440 and at 390. The player's token Ash walks
through the open door to (10, 16). Then the click on the Battle map button "Close door 1" logs "element is not stable",
then "element was detached from the DOM, retrying", and nothing more. The player's screencast stops about 0.6 s after
the click. It looked like a render loop or a main-thread hang.

## Root cause: the page did not freeze; the door left the player's door list
The player's page was idle and kept rendering. The "Close door 1" button was no longer on the page. The server stopped
sending the door, so the click had nothing to wait for. The screencast stopped only because nothing on screen changed
any more.

How the door gets lost:
1. `combatVision.doors` and `toggleDoor` (D8) list a door for a player only when one of their characters **sees the door
   now or has explored it** (`doorSeen`: any sample of the door's `objectSampleBox`).
2. The explored area is written only by the client's throttled sync (`useExploredSync`, at most one `markExplored` per
   `EXPLORED_THROTTLE_MS` = 500 ms). `markExplored` keeps only the samples the character sees **when the write arrives**.
   A view that lasts less than the throttle window is never stored. This limit is known and documented (dcm-bxp.55).
3. The spec looks at the closed door from (8, 16) for about 0.35 s, opens it, and steps to (9, 16) and (10, 16), still
   facing east, within about 0.15 s. The door is now behind Ash, outside the 70-degree cone. If no explored write landed
   while Ash faced the door, the door was never stored. As soon as Ash's view no longer includes it, `doors` drops it,
   and React removes the button, which Playwright reported as detached. The player cannot close a door they have just
   opened.

Whether it fails depends on where the 500 ms throttle and the write already in flight fall relative to the test's quick
steps. That is why the failure was intermittent and not tied to the viewport.

## Evidence
- Debug run with `--repeat-each 15 --max-failures 1`. The instrumented spec is not committed; its changes are listed
  below.
- **The main thread was not hung.** `Debugger.pause` taken three times after the click timed out always stopped in the
  Convex client's `WebSocket.onmessage` (`27l_k8xovjs1i.js:1:20264`). The thread was idle and still handling socket
  messages. A probe `requestAnimationFrame` fired at once (`"raf fired vis=visible"`). A Chrome performance trace (15 s
  around the steps) showed no long task apart from the debugger pause itself.
- **The button was gone, and so was the server's door.** State dumped after the timeout:
  - player's DOM: only `["Close gate 1|board"]`, no door button;
  - `combatVision.doors` as the player: only the gate (`solid: false`, at 21.5, 9.5);
  - the explored row decoded: only the cone seen from (10, 16), plus two tiny blobs from (5, 10) and (12, 4). The door's
    samples (x 18..19, y 32..33) were missing.
- **The write timing.** A WebSocket log of the player's mutations in the failing run, in ms from the start:
  ```
  8025 ---- place 7,16
  8107 SENT markExplored (in flight)
  8190 ---- press d                 -> Ash on (8, 16) facing the closed door
  8243 RECV markExplored {grew:false}
  8547 SENT toggleDoor open         (Ash at 8,16; the door is seen now, so it is allowed)
  8700 ---- press d   8703 SENT move -> (9, 16)
  8708 ---- press d   8712 SENT move -> (10, 16)
  8745 SENT markExplored            (the throttled write: 8243 + 500 ms)
  8847 RECV move (10, 16)
  8907 RECV markExplored {grew:true} (executed after the move to 10,16, so only the view facing away is kept)
  ```
  No explored write ran while Ash faced the door. The next write ran after Ash had already turned its back on it.

## The fix
`convex/combatVision.ts`, player path of `toggleDoor`: once `doorSeen` allows the switch, `exploreDoor` stores as
explored the door samples each of the player's viewers sees now (`sampleLevel > 0`). It uses the same merge-and-write as
`markExplored`, now factored into `addExplored`. A character who switched a door has seen it, so under D8 ("sees it now
or has explored it") the door stays theirs to switch. That no longer depends on the client's throttle. Only samples the
character really sees are stored, so the M2 secrecy rule still holds.

The fix changes no timeout, retry or test step. The spec is unchanged.

## Tests
- `tests/convex/combat-doors.test.ts`:
  - New: "a door the player opened stays theirs to close after they walk through and turn their back on it". Ash looks
    at the closed door with nothing explored, opens it, walks through to (12, 10) facing away, and the door is still
    listed and can be closed. Only the door's samples were stored (at most 16 samples). It reproduces the bug: with the
    `exploreDoor` call commented out it fails with `expected [] to deeply equal [<door id>]`, and it passes with the fix.
  - Changed: the M2 walk-through test asserted that after opening the door, walking back west made it
    `COMBAT_OBJECT_NOT_FOUND`. It relied on nothing being explored because the convex test never calls `markExplored`.
    With the fix, switching a door explores it, so Ash can close it from there. Never-seen doors are still refused, as
    the "hasn't seen a door" test checks.
- e2e on the worktree backend, after the fix: the whole `combat-movement.spec.ts --repeat-each 5` passed 15 of 15 (both
  widths plus the doors drawing test), and the movement test alone with `--repeat-each 15` passed 30 of 30. Before the
  fix, each `--repeat-each 12..15` run failed within 4 to 16 runs.

## Debug instrumentation (temporary, not committed)
`browser.newContext().newCDPSession(player)` with `Debugger.pause` sampling and a `requestAnimationFrame` probe, a
`browser.startTracing` capture, a dump of the player's door buttons with `combatVision.doors` and `explored`, and a
`page.on("websocket")` log of `markExplored` / `move` / `toggleDoor` frames.

## Follow-up (not in this tracer)
Map light switches (`toggleLight` / `hasSeen`) follow the same "seen now or explored" rule and could lose a switch in the
same way after a short look. They were left unchanged.
