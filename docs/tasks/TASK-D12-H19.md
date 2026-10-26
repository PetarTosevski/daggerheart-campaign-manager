# TASK-D12-H19: Live-update e2e - combat map, sessions and notes (two browsers)

Plan `.omc/plans/d12-hardening.yaml`, tracer H19 (wave 2, depends on H1). Built on `gmAndPlayer` from
`tests/e2e/live.ts` (TASK-D12-H1): the GM and the player each have their own browser context, both open the page
once, and every later change is expected on the other screen with no `page.reload()` and no `waitForTimeout`.
User answer Q12 (2026-10-21): the listed live-update checks of analysis section 4.

## Specs

| Analysis section 4 row (H19) | Spec and test | What is proven without a reload |
|---|---|---|
| GM sets the live map | `live-combat.spec.ts` | The GM presses 'Set live' on 'Cellar': the player's headline changes and their token goes; 'Old road' again: it comes back. |
| GM moves an adversary token | `live-combat.spec.ts` | The GM selects the Bandit and presses ArrowDown: `data-square` 20,8 -> 20,9 on both boards. |
| GM reveals fog | `live-combat.spec.ts` | The GM's Hide brush (size 3) over the Bandit removes it from the player's board; Erase brings it back. |
| Explored areas | `live-combat.spec.ts` | The GM previews Liriel's view. A square behind her is unseen fog (alpha > 250); the player steps west (she turns west, `data-face` 180 on the GM's board) and it clears on the GM's preview (alpha < 10); she steps back east and it stays as explored fog (10 < alpha < 250), synced by the player's client. |
| GM toggles a door | `live-combat.spec.ts` | Closed, the door hides the Ghoul. The GM opens it from the Doors card: the player's door switch reads 'Close door 1' (pressed) and the Ghoul appears. The player closes it on the map: the GM's card reads 'Open door 1' again and the Ghoul goes. |
| Player moves their own token | `live-combat.spec.ts` | ArrowLeft / ArrowRight on the player's page: the GM's token follows (square and facing). The GM steps the player's token north: the player's token follows. |
| Blocked move | `live-combat.spec.ts` | ArrowDown into the short wall: 'Blocked' on the player's board, Liriel stays on 15,10 on both boards and on the server. |
| GM starts / ends a session | `live-sessions.spec.ts` | The player keeps the dashboard and their Seraph's sheet open (two tabs). The GM starts Session 1 from the dashboard hero: the player's 'Session 1 in progress' chip (not a link) and two Prayer d4 under 'Held dice' appear. The GM ends it from the live card: the chip and the dice go, and Last Session says it was played. |
| Player shares a page with the GM | `live-notes.spec.ts` (1440, 390) | The player hides 'Session 1' from everyone, then picks 'Everyone': the row appears in the GM's open 'Shared by players' tab (under 'Liriel'). Hiding it again shows 'This page isn't shared with you.' on the GM's open copy. |
| GM adds an entry | `live-notes.spec.ts` (1440, 390) | On the player's shared page the player's entry reaches the GM and the GM's entry ('- GM') reaches the player. The GM shares their own page with everyone: it appears in the player's open 'Shared by GM' tab, and the GM's next entry shows on the player's copy. |

At 390 the notes spec opens the index through the 'Pages' disclosure (`openIndex`, TASK-D11-N9) before each Shared
tab and the GM's own pages.

## Robustness on a loaded machine

- Each file uses `expect.configure({ timeout: 15_000 })`: with a load average of 30-46 on 16 cores a live update
  took longer than the default 5 s. Assertions stay web-first; nothing waits on a timer.
- Notes writes are optimistic on the writer's screen, so each entry is confirmed on the server
  (`notesEntries.entries` with `{ template: 0 }`) before the other screen is checked.
- The local backend sometimes times out a Convex function under that load ("Function execution timed out
  (maximum duration: 1s)"), rolling it back. The combat seeding calls and the `gmAndPlayer` setup are retried on
  that error only (up to 4 attempts); any other error fails at once.

## Bugs found

None. Every live update listed above reached the other screen; no step is `test.fixme`.

## Verification

Backend and `scripts/e2e-next.mjs` started by hand on E2E_PORT 3540 / E2E_CONVEX_PORT 3772, Playwright with
`E2E_REUSE_SERVERS=1`, load average 30-46:

- `playwright test tests/e2e/live-combat.spec.ts tests/e2e/live-sessions.spec.ts tests/e2e/live-notes.spec.ts`:
  4 passed (2.3 min), then 4 passed again (1.6 min).
- `grep -n "reload()\|waitForTimeout"` over the three specs: no match.
- `pnpm lint`, `pnpm typecheck` pass; `pnpm tracer:guard .omc/plans/d12-hardening.yaml H19` passes.
