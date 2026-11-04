# TASK-CONFIG-AD13: The owner's read-only view of any campaign

Plan `.omc/plans/config.yaml`, tracer AD13 (bead dcm-jh6d.53), Part B. Server only; AU7 / AU1 build the Overview's
Open and the read-only campaign page. Answers: Q27 (b) the owner gets a read-only view of any campaign; **N1
(changed 2026-11-04): the view shows everything**, players' private notes and private Lorekeeper chats included; the
owner still can't change anything, and every visit is logged.

## The one branch (`convex/lib/permissions.ts`)

- `permissionFor(ctx, user, resource, need, { ownerView: true })` and `campaignAccess(..., enough, { ownerView: true })`:
  only with the option, only when the caller has no role (creator, member row, invite) and no grant, and only when
  `isAppOwner` says so, the answer is `owner` (never `creator`) and `campaignAccess` returns `ownerView: true`.
  Without the option nothing changes. The option in a mutation ctx (one with a `scheduler`) throws
  `OWNER_VIEW_READ_ONLY` once the caller is known to be the owner (defence in depth: no mutation passes it).
- A campaign query wrapper that granted the view puts `ownerView: true` on its ctx beside `user` and `campaign`.
  `ownerViewing(ctx, user, campaign)` reads that mark (never in a mutation ctx, only for that user and campaign), so
  the checks the same query makes after its wrapper honour it:
  - `permissionFor` on the campaign's characters, codex entries and maps answers `owner`;
  - `campaignRole` answers `coGm` (the GM's view without the creator's identity), so Notes read as the GM;
  - every journal page of the campaign is `view` (`journalPagePermission`), private and torn-out ones too, never
    `owner`, so no page action flag opens for the owner;
  - `lorekeeper.ts` (`readableConversation`, `listConversations`) shows other members' private conversations.

## Wrappers (`convex/lib/functions.ts`)

| Builder | Owner view | Owner outside the campaign |
|---|---|---|
| `campaignQuery`, `gmQuery` | yes (`ctx.permission` "owner", `ctx.ownerView` true) | reads as the GM |
| `creatorQuery` | no (the view never answers `creator`) | NOT_FOUND |
| every campaign mutation (`campaign*`, `gm*`, `creator*`, keyed or not) | no; `OWNER_VIEW_READ_ONLY` if one met it | NOT_FOUND |
| `user*`, `maybeUserQuery` handlers calling `permissionFor` / `campaignAccess` directly | no (default) | as an outsider |

So character sheets read by `characterId` through user wrappers (`own` class) stay NOT_FOUND for the owner; the
campaign-scoped reads (party, HUD, combat, Notes, Lorekeeper, Journal) work.

## API

| Function | Wrapper | Args | Returns |
|---|---|---|---|
| `campaigns.get` | `maybeUserQuery` | `{ campaignId }` | adds `ownerView: boolean`; for the owner's view `role: "gm"`, `isCreator: false`, `lastOpenedAt` = the campaign's creation |
| `appAdmin.openCampaign` | `appOwnerMutation` | `{ campaignId }` | `{ logged }`: one `campaign.view` audit row (actor the owner, target the campaign) per campaign per UTC day; NOT_FOUND for a missing or deleted campaign |

`campaigns.markOpened` and presence are unchanged (NOT_FOUND for the owner), so the owner never shows in Last seen or
member lists. A query can't write, so the Overview's Open calls `appAdmin.openCampaign` before it navigates. The day's
dedupe reads today's audit rows (`by_at`, at most 500); past that it logs again rather than miss a visit.

## Tests

- `tests/convex/owner-view.test.ts`: `campaigns.get` marks the view; the owner reads Fear, players' private pages and
  entries and private Lorekeeper conversations (the GM does not); Fear, notes, a Lorekeeper question and deletion,
  character edits and `markOpened` are NOT_FOUND and change nothing; `campaignAccess` with the option in a write throws
  `OWNER_VIEW_READ_ONLY`; an owner who joined reads as a player; `openCampaign` logs once a day, refuses everyone else.
- Authz matrix: every entry now runs the app owner (`appOwnerOutcome` in `tests/convex/authz/harness.ts`). Writes:
  the outsider's row, always. Queries: the GM's row for `gm` / `view` / `edit`, the outsider's for the rest, and
  `APP_OWNER_QUERY_ROWS` for what N1 lets the owner read beyond the GM. The guard (`ownerWriteProblems`) fails when a
  write states an appOwner row or a campaign-class write expects anything but NOT_FOUND / FORBIDDEN for the owner.
