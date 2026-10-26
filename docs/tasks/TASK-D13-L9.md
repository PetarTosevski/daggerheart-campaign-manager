# TASK-D13-L9: D13 end to end - fake model on the e2e backend, GM and player flows, privacy, a11y, visual pass, docs, follow-up beads

Status: Review. Plan: `.omc/plans/d13-lorekeeper.yaml`, tracer L9 (wave 5; run after L10-L12 were merged). Bead
dcm-bxp.82.3, including its orchestrator note: also cover L10-L12 (the web pass on unclear answers, the visible phases
books -> stronger model -> internet, text that only grows, the early-Stop note).

## Files

| File | Role |
|---|---|
| `scripts/e2e-setup.mjs` | Sets `LOREKEEPER_FAKE_MODEL=true` and `LOREKEEPER_DAILY_QUESTIONS=1000` on the e2e backend, then ingests `tests/fixtures/lorekeeper/mini-book.txt` as the core book (`scripts/lorekeeper-ingest.mjs core … --e2e`). The script only ever targets the local e2e deployment, and `convex/lib/claude.ts` honours the flag nowhere else. |
| `tests/e2e/lorekeeper-flow.spec.ts` | 3 tests: the four board samples and the drawer pin (two browsers), the caps message, axe and keyboard. |
| `tests/e2e/lorekeeper-privacy.spec.ts` | 1 test (GM, player, second player): private conversations, no key on the wire, the GM canary. |
| `tests/e2e/visual/D13-L9.spec.ts` | The 1440 / 390 shots of the page, drawer, empty, error and cap states, with the board's page and drawer. |
| `docs/lorekeeper.md` | For the server owner: books per deployment, ingest, env vars, costs and caps, retention, privacy. |
| `docs/data-model.md` | The D13 tables (books, chunks, library, conversations, rulings, asks, usage, next to L11/L12's messages row) and the Lorekeeper retention jobs. |

`LOREKEEPER_DAILY_QUESTIONS=1000`: the test accounts ask many more than 40 questions a day across repeated runs, and
the per-person counter would close the composer in unrelated specs. The cap itself is tested with a lowered campaign
budget, which is per campaign and restored by the test.

After pulling this, run `pnpm e2e:setup` once per checkout. The L0/L6/L7 specs still set the flag and ingest in their
own `beforeAll` (harmless; bead dcm-bxp.82.8 removes it).

## e2e lorekeeper-flow (fake model)

1. **Four board samples, an early Stop and the drawer pin** (GM and player in two browsers). A `MutationObserver` on the
   player's page records each new phase text and the first text an in-flight card shows, in order, and any card text
   that does not extend the text shown before (a swap). Every step asserts no swaps and the exact event order.
   - From the rules ('Critical hits'): `books`, then the text streams; a '📖 Daggerheart Core Rulebook · p.N' chip.
   - Rules unclear ('Do Hexes stack?', search on): `books` -> `retry` -> `web`, and only then text (L11/L12). The card
     has 'Checked again with a stronger model', the Suggested GM call, the internet block with 'From the internet ·
     unofficial.' (L10: an unclear answer is searched online too) and 'Ask the GM'.
   - Internet block (an off-book question, search on): `books` -> `retry` -> `web` -> text. The card has 'Not in your
     books', the disclaimer, result cards with the site ('example.com'), and links with
     `rel="noopener nofollow"`.
   - Books-only miss (the same question, 'Books only' pressed): `books` -> `retry` and no live text (the stronger
     model's 'none' is replaced by the miss, so it stays hidden). The card shows the board's miss text, only 'Ask the
     GM', no Copy and no internet block.
   - Early Stop (L12): Stop during the hidden first pass shows 'Stopped.' and "Stopped before an answer was ready. Ask
     again to get one.", with no buttons.
   - The GM, on the Party page, opens the drawer from the pill, asks 'Do Hexes stack?' there and pins the unclear
     answer ('Pin as table ruling', prefilled with the GM call). The player's open Lorekeeper page shows 'Hexes don’t
     stack', its text, '1 pinned' and 'Pinned by the GM' with no reload. ✕ returns focus to the pill.
   - The pin comes last on purpose: the fake model answers 'rules' whenever any document is in the request, and the
     rulings document would turn the miss samples into book answers.
2. **Caps message.** The campaign budget (`LOREKEEPER_CAMPAIGN_MONTHLY_USD`) is set to one Sonnet worst-case
   reservation plus half the fake answer's real cost (computed with `src/lib/lorekeeper/pricing.ts`). The GM's first
   question fits. Once it settles, the composer of both the GM and the player shows "This campaign has used this
   month’s Lorekeeper budget." and is disabled. `lorekeeper.ask` from the player then fails with
   `LOREKEEPER_CAP_CAMPAIGN`. The env var is removed in `finally`.
3. **axe and keyboard.**
   - axe finds zero serious or critical violations on the page with an answer, and inside the open drawer
     (`.lk-drawerdlg`).
   - Tabbing from the top of the page reaches every stop with an accessible name. The stops include the four chips,
     'Your question', 'Search the internet too', 'Books only', 'Open in the book', 'Pin as table ruling' and 'Copy'.
   - In the drawer, Tab reaches 'Close the Lorekeeper', the chips, the box, the toggle and Copy.
   - ✕ by keyboard closes the drawer with focus back on the pill; Enter reopens it; Escape closes it with focus back
     on the pill.

## e2e lorekeeper-privacy

The test plays the GM, the player and the second player (`e2e-player2@example.test`, joined by code). For all three
browsers it records every HTTP response body, every WebSocket frame received (Convex query results) and the final
page source.

- **GM canary:** a hidden (secret) codex entry has the canary in its name, role, players' text and GM notes; a known
  entry has it in its GM notes. The control: the GM's own `codex.list` and `codex.entryText` contain it.
- **Private conversation:** the player presses 'Private' and asks.
  - By id, the second player and the GM get `LOREKEEPER_NOT_FOUND` from `getConversation` and `listMessages`.
  - The second player's `ask` into it gets `LOREKEEPER_NOT_FOUND`, and `listConversations.shared` leaves it out.
  - In the browser it is not in the second player's Conversations menu.
  - By URL: the Lorekeeper has no conversation URLs; `/lorekeeper?conversation=<id>` and `/lorekeeper/<id>` show
    none of its text.
- **Not-found card:** the second player opens the player's public conversation from 'Shared in the campaign'. The
  player then presses 'Private', and the second player's view turns into "That conversation isn't there anymore."
  at once.
- **The wire:** across everything the three browsers received (the GM's page and drawer included), nothing matches
  'ANTHROPIC' or 'sk-ant', and nothing either player received contains the canary. The control: the player's wire
  does hold their own answers.

## Privacy findings

None. No key name or key reached any browser, and no GM canary reached a player. No other user's private
conversation was readable by id, menu or URL; the GM's reads were refused too (Q3). Notes:

- There is no per-conversation URL to probe; the "by URL" check covers the two plausible shapes.
- The e2e check proves what reaches the browser. That no GM data reaches the model's prompt is proven by L4's canary
  tests on `buildContext` (`tests/convex/lorekeeper-context.test.ts`), because the fake model never echoes the
  campaign-data block.

## Visual pass (test-results/visual/D13-L9)

Shots: app `page`, `drawer` (viewport), `empty`, `error-gone`, `error-unavailable`, `cap` (whole page), each at 1440x900
and 390x844; the board's `board-page` and `board-drawer` at both sizes.

| Shot | Region | Verdict | Notes |
|---|---|---|---|
| page-1440 vs board-page-1440 | Sidebar (Library, How I answer, Table rulings) | Match | Two library rows on the e2e backend (core + house rules) where the board has four. The GM sees '＋ Add PDF'. |
| | Chat header | Match with addition | '1 book indexed' pill as the board; the 'Conversations' menu is added (L6). |
| | Bubbles, parchment cards, pills, quotes, chips | Match | The chip carries '· p.N' (plan). The fake model's quotes are 200 characters of the page, so they end mid-word. 'Checked again with a stronger model' sits under the unclear pill (Q2). |
| | Campaign header | Deviation (app shell) | The app's banner and nav are taller than the board's one-line nav. They are the campaign shell's, not the Lorekeeper's. |
| page-390 vs board-page-390 | Column | Match with deviation | One column with no sideways scroll. The shell's nav (wrapping to 4 rows) and the 'Library & rulings' fold (Q12) push the first message to about y=600; the board starts the chat at the top. The composer is below the fold until the page scrolls. |
| drawer-1440 vs board-drawer-1440 | Panel | Match | 440 px panel, header with sigil and ✕, stream, composer and 'The Lorekeeper is open' pill as the board. ✕ is 44 px (board 32: touch-target rule). Added: 'Private' and its line (Q3). The page under the backdrop is the real Party page. |
| drawer-390 vs board-drawer-390 | Panel | Match | Full width; header, stream and composer as the board; the decorative pill is hidden. |
| empty-1440 / -390 | Empty conversation | Match (board has no empty state) | Sigil and 'Ask me anything about the rules in your books.' centred, chips above the box. |
| error-gone-1440 / -390 | Conversation no longer readable | Pass, with a note | A red banner "That conversation isn't there anymore." with 'New conversation'. The composer is gone until 'New conversation' is pressed, leaving an empty column (board: no such state). |
| error-unavailable-1440 / -390 | Not set up | Pass, with a note | The intro and the composer notice both say "The Lorekeeper isn't set up on this server.". The composer is dimmed and disabled. The text is repeated. |
| cap-1440 / -390 | Campaign cap | Pass, with a note | Amber notice "This campaign has used this month’s Lorekeeper budget." under the toggles; composer disabled. At 1440x900 and 390x844 the notice is below the first screen (the page has to scroll). |

The answer error card ('couldn't answer just now' + Try again) is not shot: the fake model always answers (bead
dcm-bxp.82.9).

## Checks

- `pnpm lint` and `pnpm typecheck` clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 261 files, 6,354 passed, 1 expected fail.
- e2e: backend and `scripts/e2e-next.mjs` were started by hand on ports 3134 / 3380 and run with
  `E2E_REUSE_SERVERS=1`. `lorekeeper-flow` (3 tests), `lorekeeper-privacy` (1) and `visual/D13-L9`
  (`E2E_VISUAL=1`) passed together (5 passed, 3.0 min, load about 20).
- The earlier L0/L6/L7 specs in the same run, at load about 40:
  - lorekeeper-chat: 1 of 2 failed;
  - lorekeeper-side: 1 of 3 failed;
  - lorekeeper-shell: 1 of 2 failed.
  All three failures are timeouts: those specs' `expect.configure` leaves the 5 s default in place, and the shell
  spec keeps the 30 s test timeout. Bead dcm-bxp.82.8 covers both.
- My specs wait for hydration before key presses and pill clicks: the roster (Convex data) on the Party page, or an
  enabled question box. Without it, an Enter pressed under load was lost.
- `pnpm tracer:guard .omc/plans/d13-lorekeeper.yaml L9` passes.

## Follow-up beads (parent dcm-bxp.82)

- dcm-bxp.82.6: move `convex/combatMapGenerate.ts` and `convex/photoImport.ts` onto `convex/lib/claude.ts`
  (acceptance).
- dcm-bxp.82.7: measured token and cost numbers from real, fake-free runs, recorded by the user and not run by agents
  (acceptance).
- dcm-bxp.82.8: the L0/L6/L7 Lorekeeper specs: a real `expect` timeout, a longer shell timeout, and no per-spec
  fake-model setup.
- dcm-bxp.82.9: a canned fake-model failure so e2e can reach the answer error card.

## QUESTIONS

1. At 1440x900 and at 390 px, the composer's disabled notices (cap, not set up) sit below the first screen. Should
   the notice move above the box (or the column fit the viewport) so a capped player sees why at once?
2. When an open conversation becomes unreadable, the column shows only the banner and 'New conversation', with no
   composer. Keep it, or show the composer for a new conversation under the banner?
3. 'Not set up' is said twice (intro and notice). Drop one?
4. There is no command to remove an ingested book (re-ingest replaces). Is one needed?
