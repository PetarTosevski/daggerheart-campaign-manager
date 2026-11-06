# TASK-CONFIG-L1: Lorekeeper campaign settings

Plan `.omc/plans/config.yaml`, tracer L1 (Part A, wave 3), bead dcm-jh6d.14. Depends on S0 (`tableSettings.lorekeeperAsk`,
`tableSettings.lorekeeperWeb`, `LOREKEEPER_GM_ONLY`).

## What changed

`convex/lorekeeper.ts`:

- **Who can ask.** `ask` and `editQuestion` take `enough: "owner"` so `ctx.permission` is exact, and their first step
  is `assertCanAsk`: with `lorekeeperAsk: "gm"` a caller below `owner` (a player, or a member with only a campaign edit
  grant) gets `LOREKEEPER_GM_ONLY`. The GM and every co-GM hold `owner` and always ask. The decision reads the
  wrapper's permission (rule 2), never a role.
- **A refusal spends nothing.** The check runs before validation, the reservation, any insert and the scheduler. The
  wrapper takes its `lorekeeperAsk` rate-limit token before the handler, but the refusal throws, so the whole
  transaction rolls back, the token included (the test makes 12 refused asks, past the burst of 10, and the next ask
  after switching back still goes through).
- **Internet search.** With `lorekeeperWeb: false`, `ask` stores the conversation's `webSearch` as false whatever the
  client sends (new conversation or an existing one), `editQuestion` turns the conversation's toggle off before it asks
  again, and `setWebSearch` stores false. The run reads `conversation.webSearch`, so it never makes its internet pass.
  Turning the setting back on does not flip conversations back; their toggle is theirs again.
- **`lorekeeper.access`** (new `campaignQuery`, `need: "view"`, `enough: "owner"`): `{ available, canAsk, webAllowed }`.
  Reactive, so a settings change reaches every open composer.

## Decisions

- **A new query instead of widening `available`.** The acceptance asked `available` to return `canAsk` and `webAllowed`
  "besides today's fields", but `available` returns a bare boolean read by the app bar, the drawer and the chat
  (`available !== true`) and by two unit tests. Turning it into an object would break those callers, none in L1's owns.
  `access` carries all three; U4 (the composer) switches to it and `available` can go once nothing reads it.
- **The client is not changed here.** The composer hiding the internet toggle and showing "Only the GM can ask the
  Lorekeeper in this campaign." (`configMessages.LOREKEEPER_GM_ONLY` in `src/lib/errors/config.ts`) is U4's work, reading `lorekeeper.access`.
  No test here needs the client.
- **A run already scheduled.** The web decision is made when the question is asked. A GM switching the internet off in
  the milliseconds between an ask and its run start would not stop that one run's internet pass; closing that would
  need `lorekeeperRun.ts` (not owned) to read the setting too. Noted, not done.

## Tests

- `tests/convex/lorekeeper-campaign-settings.test.ts`: player, other player, grantee, co-GM and GM against both
  switches through `access`; GMs-only refusals of `ask` and `editQuestion` with no conversations, messages, usage rows,
  fetch calls or rate-limit tokens spent; GM and co-GM still ask and edit; internet off stores false for player, co-GM
  and GM (new and existing conversations), `setWebSearch` and `editQuestion` store false, and no Messages API request
  carries the web search tool; internet on (default) still runs the internet pass.
- `tests/convex/authz/config-lorekeeper.entries.ts` + `.test.ts`: the matrix entry for `lorekeeper.access`.

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (541 files) pass.

## Questions used

Q21 (limit requests) and Q24 (GM books) are Part B, not L1. No new question.
