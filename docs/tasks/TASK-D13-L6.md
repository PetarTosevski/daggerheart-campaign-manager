# TASK-D13-L6: Chat column UI - stream, answer cards, composer, actions, empty / loading / error / cap states

Plan `.omc/plans/d13-lorekeeper.yaml`, tracer L6 (wave 3). Bead dcm-bxp.82. Board: `reference/designs/project/Lorekeeper.dc.html`
(page variant, chat panel). Binding user answers: Q2 (retry note), Q3 (public / private conversations), Q5 (Open in the
book = page text dialog), Q8 (Ask the GM), Q10 (the asker deletes their own conversation), Q11 (Stop), Q14 (GM pins).

Status: Review (implemented and tested in the worktree; the orchestrator merges).

## Files

| File | Role |
|---|---|
| `src/components/lorekeeper/chat/index.tsx` | The slot exports `LorekeeperChat` and `ConversationsMenu` (names and props of `slots.ts` kept). |
| `chat/chat.tsx` | `ChatView`: the column's queries (available, listConversations, library list, usage.mine, asks.mine, GM: asks.listOpen, roster), the pending question, ask failures; `ConversationPane` (getConversation, paginated listMessages, stop / toggles) and the stream (role=log, aria-live=polite). |
| `chat/selection.ts` | The conversation shown, shared by the menu, the body and the drawer in one tab (`useSyncExternalStore`). Default: the caller's most recent conversation, so a reload keeps the history. |
| `chat/boundary.tsx` | `ChatBoundary` (CL1) around the conversation pane (keyed on the conversation) and the book page; shows the code's message and an action. |
| `chat/chat.css` | Column height (the stream scrolls above a fixed composer), the board's inline styles, and the looks the board lacks (retry note, counter, notices, dialogs, the menu). |
| `answer/answer-card.tsx` | Thinking row; parchment card (verdict pill, retry note, prose, quotes with chips, Suggested GM call, internet block, actions); error card with Try again; stopped note. |
| `answer/model.ts` | Pure: board actions per answer and role, chips, copy text, range check, books-only miss, safe links, `errorCode`, pin draft. |
| `answer/book-dialog.tsx`, `answer/pin-dialog.tsx` | Open in the book (`lorekeeperLibrary.pageText`); Pin as table ruling (`lorekeeperRulings.pin`, prefilled). Both on the brand `Modal`. |
| `composer/composer.tsx`, `composer/model.ts` | Chips, question box, Ask / Stop, internet toggle, Private toggle (Q3), notices (caps, rate limit, not set up, conversation full). |
| `conversations/menu.tsx`, `conversations/names.ts` | The 'Conversations' menu: New conversation, own conversations with Delete (confirm dialog), others' public ones ('Asked by <name>' from the roster). |
| `src/lib/optimistic/lorekeeper.ts` | ask (question + pending answer on top), stop, setWebSearch, setVisibility, removeConversation, asks.send. |
| `tests/unit/lorekeeper-ui/*` | 43 tests: model helpers, answer card and composer (RTL, convex/react stubbed), optimistic updaters. |
| `tests/e2e/lorekeeper-chat.spec.ts` | 2 tests (fake model). |
| `tests/e2e/visual/D13-L6.spec.ts` | App and board shots at 1440x900 and 390x844. |

## Behaviour

- **Stream:** question bubbles right, 'You' (others' names from the roster in shared conversations); a pending or
  empty streaming answer is the thinking row ('Searching your books…', dots static under reduced motion, from L0's
  CSS); the card fills as `appendAnswer` patches arrive (`aria-busy` while in flight); actions only once `done`. All
  model / book / user text is rendered as React text (no HTML, no Markdown; a unit test renders `<img …>` as text).
  History is paginated newest first and reversed; 'Show earlier messages' loads 40 more. The stream follows new
  text while the reader is at the bottom.
- **Quotes:** at most 3 (server cap); a book quote's chip is a button '📖 <book title> · p.<page>' (title from
  `lorekeeperLibrary.list`) that opens that page; ruling quotes show '📌 Table ruling' and the ruling title.
- **Actions (board order):** rules → Open in the book (with a book quote), Pin as table ruling (GM), Copy; rules citing
  a range section (`/\branges?\b/` in the section) → Show on Combat Map (link to `/campaigns/<id>/combat-map`), Copy;
  unclear / internet → Ask the GM (the asking player), Pin (GM), Copy; books-only miss → only Ask the GM. Ask the GM
  turns into a disabled 'Sent to the GM' (asks.mine, optimistic). The GM may pin their own answers and answers a
  player sent them (asks.listOpen; `lorekeeperRulings.pin` accepts both). Copy uses L1's `copyText`.
- **Composer:** the board's chips and placeholder; Enter sends, Shift+Enter is a new line; `maxLength` 1,000 with
  '<n> / 1,000' from 900; Ask becomes Stop while the caller's answer streams (Stop waits, disabled, until the server
  has written the answer row); the toggle has aria-pressed and is stored on the conversation (`setWebSearch`), local
  for a new one (default 'Search the internet too' as the board). The draft is cleared on send and comes back if
  the ask fails.
- **States:** empty conversation (sigil, 'Ask me anything about the rules in your books.', chips in the composer);
  loading ('Loading…', role=status); error card with the code's message and 'Try again' (re-asks the same question
  in the same conversation); not set up (`available` false: intro and composer notice 'The Lorekeeper isn't set up on
  this server.', composer disabled); caps from `usage.mine` (disabled with CAP_USER / CAP_CAMPAIGN / CAP_DEPLOYMENT
  text; '<n> questions left today' from 10 down); RATE_LIMITED, BUSY and the caps from `ask` show as a notice;
  LOREKEEPER_CONVERSATION_FULL offers 'Start a new conversation'; stopped answers keep their text with 'Stopped.'.
- **Conversations (Q3, Q10):** a new conversation is public unless 'Private' is pressed before the first question;
  the asker toggles it later (`setVisibility`). Another member's public conversation opens read only; asking from
  it starts a conversation of the caller's own. A conversation made private or deleted meanwhile shows
  'That conversation isn't there anymore.' with 'New conversation'.

## Strings not in copy.ts (UI chrome; L1 owns copy.ts)

'Loading…', 'Stopped.', 'Copied', 'Show earlier messages', 'Start a new conversation', 'Private', 'Your conversations',
'Shared in the campaign', 'No conversations yet.', 'Asked by <name>', 'Shared with the campaign', '🔒 Private',
'Delete this conversation?' (+ body, Delete, Cancel), pin dialog 'Title' / 'Ruling' / 'Pin ruling', "Couldn't copy.
Select the text instead.". Candidates to move into copy.ts later.

## Checks

- `pnpm lint` clean, `pnpm typecheck` clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 225 files, 5,468 passed, 1 expected fail, 1 skipped.
- e2e (backend and `scripts/e2e-next.mjs` started by hand, ports 3180 / 3472, `E2E_REUSE_SERVERS=1`):
  `lorekeeper-chat.spec.ts` 2 passed, `lorekeeper-shell.spec.ts` 2 passed, `visual/D13-L6.spec.ts` (E2E_VISUAL=1) passed.
- **e2e setup note:** until L9 adds it to `scripts/e2e-setup.mjs`, both L6 specs set `LOREKEEPER_FAKE_MODEL=true` on the
  e2e backend and ingest `tests/fixtures/lorekeeper/mini-book.txt` as the core book in `beforeAll` (through
  `scripts/convex-e2e.mjs env set` and `scripts/lorekeeper-ingest.mjs --e2e`). L9 can remove those lines.

### e2e lorekeeper-chat

1. Player: 'Critical hits' chip → bubble 'You' → streamed 'From the rules' card with '📖 Daggerheart Core Rulebook · p.3',
   Open in the book shows the page in a dialog.
2. 'Do Hexes stack?' → 'Rules unclear', 'Suggested GM call', 'Checked again with a stronger model'.
3. Typed question + Enter → Stop → 'Stopped.', Ask back.
4. Reload → the three questions and the unclear answer are still there.
5. Player: Ask the GM → 'Sent to the GM' (disabled). GM: Conversations → Shared in the campaign → the player's
   conversation → Pin as table ruling (prefilled with the question and the GM call) → the ruling is in `rulings.list`.
6. At 390: no sideways scroll, Books only pressed, New conversation shows the intro, Delete with the confirm dialog
   empties 'Your conversations'.

## Visual comparison (test-results/visual/D13-L6: chat-1440/390 vs board-chat-1440/390)

| Region | Verdict | Notes |
|---|---|---|
| Chat header | Match (L0) | The board's '3 books indexed' pill is L7's `IndexPill` (stub here); 'Conversations' button added (plan). At 390 the name wraps to two lines next to the button. |
| Question bubbles | Match | 'You' for the caller (board shows sample character names). |
| Parchment card, verdict pill | Match | Colours, radius, serif prose, pill icons and labels identical. |
| Quotes and chips | Match with deviation | Chip shows '· p.<page>' (plan acceptance; the board has the book only) and is a button opening the page. Quote text is what the citation cites (the fake model cites 200 characters, so it ends mid-word). |
| Suggested GM call | Match | |
| Internet block | Match (unit-tested) | The fake model's web pass needs L8; the block's markup and disclaimer follow the board, links `rel="noopener nofollow"`. |
| Actions | Match with role rules | The board shows every action to everyone; here Pin is the GM's and Ask the GM the asking player's (plan). |
| Retry note | Added (Q2) | 'Checked again with a stronger model' under the pill, small italic. |
| Composer | Match with additions | Chips, box, gold Ask, toggle as the board; added the 'Private' toggle and its line (Q3), counter and notices. At 390 the placeholder wraps in the one-row box, as on the board. |

## QUESTIONS

1. The strings listed above are not in `copy.ts`; should L1's module gain them (a later tracer), or stay local?
2. The specs set the fake model and ingest the fixture themselves until L9 changes `scripts/e2e-setup.mjs`; fine?
3. Pinning from the chat does not resolve the player's Ask-the-GM request (L7's Rulings card does 'Pin a ruling' and
   resolves). Should Pin in the chat also call `lorekeeperAsks.resolve` when the answer was asked?
