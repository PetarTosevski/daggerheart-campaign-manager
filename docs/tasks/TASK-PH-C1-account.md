# TASK-PH-C1: account screens

Tracer C1-account. Branch `phone/C1-account` in worktree
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c1-account`, from
`phone/A1-on-master` (`9b522dc`). Not committed.

## Settings

`apps/mobile/app/campaign/[campaignId]/settings.tsx` already renders
`SettingsScreen`. That screen now follows `src/app/(gm)/settings-dialog.tsx`.

It reads `settings.get` and `users.viewer`. Table name, GM name, accent, Hope &
Fear, and the new-map style each send one `settings.update` field. The map
style uses the same optimistic patch as the website when the mutation function
provides it. Show backup writes `settingsBackupText` into the field. Restore
checks `readSettingsBackup` and then calls `settings.restore`. Reset asks in
the screen, then calls `settings.reset`. Sign out calls `signOut` and replaces
to `/sign-in`. While offline, writes stay off and Show backup still fills the
field. A player render subscribes only to `settings:get` and `users:viewer`.

The stored accent is not painted onto the rest of the app. The website does
that in `src/app/(gm)/accent-sync.tsx`, and this tracer cannot edit the shell.

## Stopped: no route renders these screens

These screens were not built. Nothing under `apps/mobile/app` renders them, and
this tracer cannot edit that tree.

| Screen | Route file |
| --- | --- |
| Home | No home route. `apps/mobile/app/index.tsx` renders the signed-out screen. A signed-in visitor is sent to `/campaign`. |
| Campaign list, deleted campaigns, restore, purge, leave | `apps/mobile/app/(auth)/campaign.tsx` renders `CampaignFear`. Switch campaign goes to `/campaign`, which is that file. |
| New campaign | No route file. |
| Custom frame | No route file. |
| Frame intro | No route file. |
| Join by code and by link | No route file. |

`CampaignFear` and `apps/mobile/test/features/account/fear-proof.test.tsx` are unchanged.

## Commands

Node v24.22.1 and pnpm 10.8.0, from this worktree.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile up to date. Added 1338 packages. |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 29 suites, 89 tests. |
| `pnpm vitest run tests/convex/codex.test.ts` | Exit 0. 1 file passed, 24 tests passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. Home, the campaign list, deleted campaigns, new
campaign, custom frame, frame intro, and join stay unbuilt until a route file
renders each screen.
