# TASK-PH-C3: Players screen and campaign tome

Tracer C3-players. Branch `phone/C3-players` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c3-players`,
branched from `phone/A1-on-master` at `21b9441`. Not committed.

## What changed

The **Players** More screen (`apps/mobile/src/features/players/`) matches
`src/app/(gm)/campaigns/[campaignId]/players-dialog.tsx`. Everyone sees
**At the table** from `members.roster`. The GM also subscribes to
`members.access`, can copy the join link, rotate the code, invite and revoke
email invites, and remove players (`members.invite`, `members.revokeInvite`,
`members.rotateJoinCode`, `members.removePlayer`). A missing join code triggers
one `members.rotateJoinCode` on first load, like the website dialog. Players
never subscribe to `members.access`.

The **Tome** screen (`apps/mobile/src/features/tome/`) matches
`campaign-tome-book.tsx` and `components/tome/tome-book.tsx`. Published frames
read frame lore from `src/lib/frames/tomes.ts` via `campaigns.get`. Custom
campaigns show GM setup notes and chapter text from `campaigns.get`; the GM
saves edits with `campaigns.updateTome` (debounced, same behaviour as the web
book). Players read only.

Harness role tests live in
`apps/mobile/test/features/players/` and `apps/mobile/test/features/tome/`.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone worktree (`pnpm install` once in
that checkout).

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 tests passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. Join-link copy uses the clipboard when the
runtime exposes it (web); native copy may need a later clipboard dependency if
product wants silent copy on device.
