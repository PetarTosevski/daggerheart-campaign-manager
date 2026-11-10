# TASK-PH-C1: party roster and character sheet

Tracer C1-party. Branch `phone/C1-party` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c1-party`,
branched from `phone/A1-on-master` at `9b522dc`. Not committed.

## What changed

The Party tab lists the campaign's characters and opens a character sheet in
place. Editing follows the server's `canEdit`. A resource step sends
`{ characterId, resource, delta }` to `characters.adjustResource`.

The roster (`apps/mobile/src/features/party/`) subscribes to
`characters.listByCampaign` and `members.roster`. Each card shows class,
heritage, subclass and level, owner, Hit Points, evasion, and Hope. A player
who can edit can kill or send the character away. The GM can also assign an
owner, delete (after a confirm), revive a fallen character, and mark the party
for level-up. That button calls `levelUp.partyLevelUp` with
`{ campaignId, idempotencyKey }` from `expo-crypto`'s `randomUUID`. It renders
nothing for a player, so the player tree never calls it. Create character is
a stub in `features/party/create/` and does not call `characters.create`.

The sheet (`apps/mobile/src/features/sheet/`) subscribes to `characters.get`.
`characterExtras.get` runs only for a Motherboard campaign, and `rests.current`
only when `canEdit` is true, so each query name is mounted once. Three pages
match the website: Character Sheet, Story & Advancement, and Domains. The
sheet covers identity (including a GM-only trait correction), Hope, Hit
Points, Stress, Armor, Scars, evasion and thresholds, status, equipment,
domain cards, heritage, wealth, inventory, experiences, background,
connections, and notes. A second tap on a stepper sends a second delta, and
the shown value moves before the query updates. Text fields keep a draft
while focused and save that field on end editing.

Six slots stay stubs for later tracers: dice, level-up, death, incoming hit,
rest, and features. Each mounts once with `{ campaignId, isGm, hopeAndFear,
character, canEdit }` and does not subscribe. The party level-up control is
the roster button, not the sheet's level-up slot.

The downtime section lists the short-rest and long-rest move names from
`src/lib/domain/rest/moves.ts` and the line "Choose two moves, or the same
move twice." It does not copy the rulebook's move paragraphs. A move this
character already picked on the open rest is marked.

`apps/mobile/app/campaign/[campaignId]/party/[characterId].tsx` and
`party/new.tsx` are still `NotBuiltYet`. Those files were outside this
tracer's ownership. The roster opens the sheet in `PartyScreen`; a deep link
to a character, or the create route, still shows "Not built yet."

A thrown query inside `CampaignProvider` makes the harness subscribe to
`campaigns.get` again before the first watch is released. The error tests
therefore mount the same `QueryBoundary` the screens use around the failing
`characters.listByCampaign` or `characters.get` call, without a second
campaign subscription.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone worktree. `node_modules` was
the sibling worktree's install at the same commit.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 31 suites, 91 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 tests passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. The character route and the create route still
show "Not built yet." Dice, level-up, death, incoming hit, rest, and features
are stubs. The roster's evasion is base defense; motherboard augments apply on
the open sheet only. The portrait control asks for an upload URL and then the
library, and shows a letter until a later tracer draws the image.
