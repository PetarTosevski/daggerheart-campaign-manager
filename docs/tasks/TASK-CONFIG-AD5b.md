# TASK-CONFIG-AD5b: Player and character caps

Plan `.omc/plans/config.yaml`, tracer AD5b (bead dcm-jh6d.40), Part B, Q19 a. Server only: enforces the
`playersPerCampaign` and `charactersPerPlayer` caps that AD0 reads (`readAppConfig`) and AD3 sets (`setCap`).
Defaults: 8 players per campaign, 5 characters per player per campaign. The caps apply to the app owner too.

## Players per campaign (`convex/members.ts`, `refuseAtPlayersCap`)

- Counts the campaign's `campaignMembers` rows with one bounded read (`by_campaign_user`, `take(cap + 1)`). Co-GMs are
  member rows, so they count; the creator has no row, so they don't; pending invites don't count until accepted.
- Refuses with `CAP_PLAYERS` when the count is already at the cap, before:
  - `members.joinByCode` for a caller who isn't a member yet (joining again stays harmless; the creator is never
    refused);
  - `members.invite` inserting a new invite (re-inviting a pending address returns or re-roles that invite);
  - `campaigns.markOpened` accepting a pending invite (the invite stays pending; the creator's and members' opens are
    never refused).
- A lowered cap removes nobody.

## Characters per player (`convex/lib/characterSheet.ts`, `assertCharacterCap`)

- `characters.create` (via `assertRoom`) counts the new owner's characters in the campaign with one bounded read
  (`characters.by_owner_campaign`, `take(cap + 1)`); every status counts (retired, dead, away included).
- Refuses with `CAP_CHARACTERS_PER_PLAYER` at the cap, whether the player creates it or the GM assigns it to them.
- Characters owned by the GM or a co-GM (NPC-owned, secret frame characters) are exempt, by the same `permissionFor`
  role rank `assertOneActive` uses.
- XC1's "Allow extra characters this session" lifts only the one-active rule, never this cap.
- `MAX_CHARACTERS_CREATED_PER_CAMPAIGN` (50) stays as the campaign-wide abuse bound (dcm-cd8 closes with this cap).

## Decisions (recommended defaults)

- Pending invites are not counted toward the players cap; acceptance re-checks the cap.
- `photoImport.create` (GM only) and `characters.assignOwner` (hand-over) are not counted: the acceptance names
  character create only, and both are GM actions.
- `joinByCode` throws `CAP_PLAYERS` (a valid code): its rate-limit token is undone with the throw, as for any other
  refusal after the code check.

## Tests

`tests/convex/player-caps.test.ts`: join, invite and invite acceptance at the cap; co-GMs count; a lowered cap removes
nobody; the per-player cap with retired characters, GM assignment, GM / co-GM exemption, the extra-characters switch,
per-campaign counting and the default of 5.
