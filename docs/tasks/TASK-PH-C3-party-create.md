# TASK-PH-C3: character creation and photo import

Tracer C3-party-create. Branch `phone/C3-party-create` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c3-party-create`,
from `phone/A1-on-master` at `21b9441`. Not committed.

## What changed

The party create stub is replaced with the website’s nine-step character wizard
and GM photo import. Pure wizard rules re-use
`src/app/(gm)/campaigns/[campaignId]/party/new/wizard-logic.ts`. Drafts persist
per device in Secure Store (`dh.characterWizard.<campaignId>`).

`CharacterWizard` calls `characters.create` through the shared `useIntent`
wrapper (idempotency key per tap). It subscribes to `members.roster` only for
the GM (owner picker) and `characters.listByCampaign` for the one-active-
character blocker. Players get the same steps without the owner control.

`CreateCharacterSlot` links to `/campaign/[campaignId]/party/new` and mounts
`PhotoImportButton` only when `campaign.role === "gm"`. The button subtree
subscribes to `photoImport.available`; players never mount it. The import sheet
uses `photoImport.uploadUrl`, `claim`, `discard`, `read`, and `photoImport.create`.

`apps/mobile/app/campaign/[campaignId]/party/new.tsx` renders `CharacterWizard`
inside `CampaignProvider`.

## Commands

Node 24, from the worktree (`pnpm install` if `node_modules` is missing).

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. Node v24.22.1. ESLint, `tsc --noEmit`, Jest: 51 suites, 193 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge.
