# TASK-PH-C1: account routes

Follow-up on `phone/A1-on-master`. Wires account screens to Expo routes, mounts dashboard trackers and the character sheet route, and leaves `(auth)/campaign.tsx` on `CampaignFear` for the fear proof test.

## Routes

| Screen | Route |
| --- | --- |
| Home (signed in) | `apps/mobile/app/home.tsx` → `HomeScreen` (session gate sends authed `/` to `/home`) |
| Signed out | `apps/mobile/app/index.tsx` |
| Campaign list, deleted, restore, purge, leave | `apps/mobile/app/campaigns/index.tsx` |
| New campaign / frame pick | `apps/mobile/app/new/index.tsx` |
| Custom frame | `apps/mobile/app/new/custom.tsx` |
| Frame intro | `apps/mobile/app/frames/[frameId].tsx` |
| Join by code | `apps/mobile/app/join/index.tsx` |
| Join by link | `apps/mobile/app/join/[code].tsx` |
| Settings (from home) | `apps/mobile/app/settings.tsx` |
| Fear proof (unchanged) | `apps/mobile/app/(auth)/campaign.tsx` |

Session gate in `apps/mobile/app/_layout.tsx` sends signed-out visitors to sign-in except index and auth routes; signed-in visitors on sign-in go home.

## Dashboard and sheet

- `CampaignFramePanels` (frame trackers + Witherwild panel) mount on the live dashboard in `apps/mobile/src/features/dashboard/live.tsx` after countdowns.
- `apps/mobile/app/campaign/[campaignId]/party/[characterId].tsx` renders `CharacterSheet` with `CampaignScreen`.

## Commands

Node 24, from this worktree:

```bash
pnpm --filter @dualityheart/mobile run check
pnpm vitest run tests/convex/codex.test.ts
```

No commit, push, or merge.
